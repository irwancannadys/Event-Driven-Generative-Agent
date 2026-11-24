import { afterEach, describe, expect, it } from 'vitest';
import { completeCooking, startCooking } from '../usecases/cooking';
import { createTestWorld, countRows } from '../test-support/world';
import { startApiServer, type RunningApi } from './api';

let api: RunningApi | undefined;

afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function boot() {
  const world = createTestWorld();
  api = await startApiServer(world.ctx);
  return { world, url: api.url };
}

function postOrder(url: string, body: unknown) {
  return fetch(`${url}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('GET /menu', () => {
  it('lists the menu with the recipe of each item', async () => {
    const { url } = await boot();
    const response = await fetch(`${url}/menu`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const menu = (await response.json()) as { id: string; recipe: unknown[] }[];
    expect(menu).toHaveLength(6);
    expect(menu.find((item) => item.id === 'kopi_susu')).toEqual({
      id: 'kopi_susu',
      name: 'Kopi Susu',
      price: 18000,
      cook_time_sec: 180,
      recipe: [
        { ingredient_id: 'gula', qty_per_portion: 10 },
        { ingredient_id: 'kopi', qty_per_portion: 18 },
        { ingredient_id: 'susu', qty_per_portion: 150 },
      ],
    });
  });
});

describe('GET /stock', () => {
  it('lists the stock levels', async () => {
    const { url } = await boot();
    const stock = (await (await fetch(`${url}/stock`)).json()) as { ingredient_id: string }[];
    expect(stock).toHaveLength(8);
    expect(stock.find((row) => row.ingredient_id === 'susu')).toEqual({
      ingredient_id: 'susu',
      name: 'Susu',
      unit: 'ml',
      qty: 2500,
      min_qty: 1000,
      base_min_qty: 1000,
      capacity_qty: 6000,
      low: false,
      out: false,
    });
  });

  it('shows what cooking did to the stock', async () => {
    const { world, url } = await boot();
    for (let cup = 1; cup <= 10; cup += 1) {
      const response = await postOrder(url, { items: [{ menu_item_id: 'kopi_susu', qty: 1 }] });
      const { order_id } = (await response.json()) as { order_id: number };
      startCooking(world.ctx, order_id);
      completeCooking(world.ctx, order_id);
    }
    const stock = (await (await fetch(`${url}/stock`)).json()) as {
      ingredient_id: string;
      qty: number;
      low: boolean;
    }[];
    expect(stock.find((row) => row.ingredient_id === 'susu')).toMatchObject({
      qty: 1000,
      low: true,
    });
    expect(stock.find((row) => row.ingredient_id === 'kopi')).toMatchObject({
      qty: 1020,
      low: false,
    });
  });
});

describe('POST /orders', () => {
  it('creates an order and writes the event as the generator', async () => {
    const { world, url } = await boot();
    world.clock.advance(60);
    world.published.length = 0;

    const response = await postOrder(url, {
      items: [
        { menu_item_id: 'kopi_susu', qty: 2 },
        { menu_item_id: 'roti_bakar', qty: 1 },
      ],
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ order_id: 1 });
    expect(world.published).toHaveLength(1);
    expect(world.published[0]).toMatchObject({
      type: 'order_created',
      actor: 'world',
      origin: 'generator',
      sim_time: world.clock.now(),
    });
    expect(countRows(world.db, 'orders')).toBe(1);
  });

  it('answers 400 for broken JSON and for the wrong shape', async () => {
    const { world, url } = await boot();
    const broken = await postOrder(url, '{not json');
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ error: 'invalid_json' });

    for (const body of [
      {},
      { items: [] },
      { items: [{ menu_item_id: 'kopi_susu', qty: 0 }] },
      [],
    ]) {
      const response = await postOrder(url, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      const json = (await response.json()) as { error: string; issues: string[] };
      expect(json.error).toBe('invalid_body');
      expect(json.issues.length).toBeGreaterThan(0);
    }
    expect(countRows(world.db, 'orders')).toBe(0);
  });

  it('answers 422 for a menu item that does not exist', async () => {
    const { world, url } = await boot();
    const response = await postOrder(url, { items: [{ menu_item_id: 'sate', qty: 1 }] });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'unknown_menu_item' });
    expect(countRows(world.db, 'orders')).toBe(0);
  });

  it('answers 413 when the body is too large', async () => {
    const { world, url } = await boot();
    const response = await postOrder(url, {
      items: [{ menu_item_id: 'kopi_susu', qty: 1 }],
      note: 'x'.repeat(70 * 1024),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: 'body_too_large' });
    expect(countRows(world.db, 'orders')).toBe(0);
  });
});

describe('routing', () => {
  it('answers 404 for an unknown path', async () => {
    const { url } = await boot();
    const response = await fetch(`${url}/coffee`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('answers 405 with the allowed methods for a wrong method', async () => {
    const { url } = await boot();
    const wrongOnMenu = await fetch(`${url}/menu`, { method: 'DELETE' });
    expect(wrongOnMenu.status).toBe(405);
    expect(wrongOnMenu.headers.get('allow')).toBe('GET');
    const wrongOnOrders = await fetch(`${url}/orders`, { method: 'DELETE' });
    expect(wrongOnOrders.status).toBe(405);
    expect(wrongOnOrders.headers.get('allow')).toBe('GET, POST');
    const wrongOnStock = await fetch(`${url}/stock`, { method: 'POST' });
    expect(wrongOnStock.status).toBe(405);
  });

  it('listens on localhost only', async () => {
    const { url } = await boot();
    expect(url.startsWith('http://127.0.0.1:')).toBe(true);
  });
});
