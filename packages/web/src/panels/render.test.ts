import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agent, apply, event, snapshot, stockRow } from '../state/test-fixtures';
import { applySnapshot } from '../state/world';
import { asElement, FakeNode, installFakeDom } from './fake-dom';
import type { ViewChoice } from '../view-mode';
import type { KeyValueStore } from './collapse';
import { createPanels, type PanelActions } from './render';

beforeEach(() => installFakeDom());
afterEach(() => vi.unstubAllGlobals());

function setup(overrides: Partial<PanelActions> = {}, view?: ViewChoice, store?: KeyValueStore) {
  const root = new FakeNode('div');
  const calls = { decide: [] as unknown[][], time: [] as unknown[] };
  const actions: PanelActions = {
    decide: (id, decision) => {
      calls.decide.push([id, decision]);
      return Promise.resolve({ ok: true });
    },
    changeTime: (request) => {
      calls.time.push(request);
      return Promise.resolve({ ok: true });
    },
    ...overrides,
  };
  const panels = createPanels(asElement(root), actions, { view, store });
  return { root, panels, calls };
}

const report = {
  id: 1,
  type: 'restock' as const,
  status: 'submitted' as const,
  title: 'Usul belanja: Susu',
  body: 'Urgensi: normal.\nSusu: pesan 5000 ml.',
  subject: {},
  created_at_sim: 30_000,
  submitted_at_sim: 30_300,
  decided_at_sim: null,
};

const world = () =>
  apply(
    applySnapshot(
      snapshot({
        agents: [agent('cashier', 'cashier'), agent('cook', 'kitchen')],
        stock: [{ ...stockRow('susu', 1000, 1000), name: 'Susu', capacity_qty: 6000, unit: 'ml' }],
        orders: { placed: 2, held: 1, cooking: 1, done: 4 },
        reports: [report],
      }),
      1000,
    ),
    event('day_opened', { day: 0 }, 28_800),
  );

describe('the panels', () => {
  it('say they are waiting for the world, and have no controls, before the first snapshot', () => {
    const { root, panels } = setup();
    panels.update({ state: undefined, status: 'connecting', nowMs: 0 });
    expect(root.textContent).toContain('Menunggu data dunia dari server');
    expect(root.textContent).toContain('Menyambung ke server');
    // only the titles that fold a section are left, no time control
    const buttons = root.findAll((node) => node.tag === 'button');
    expect(buttons.every((node) => node.className === 'panel-toggle')).toBe(true);
  });

  it('show the connection, the time, the characters, the orders, the stock, the log and the boss desk', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    const text = root.textContent;
    expect(text).toContain('Tersambung');
    expect(text).toContain('Hari 0, 08:20');
    expect(text).toContain('kecepatan 60x');
    expect(text).toContain('Kasir');
    expect(text).toContain('menganggur');
    expect(text).toContain('Susu');
    expect(text).toContain('1000 / 6000 ml RENDAH');
    expect(text).toContain('Kafe buka (hari 0)');
    expect(text).toContain('Usul belanja: Susu');
    expect(text).toContain('Susu: pesan 5000 ml.');
    expect(text).toContain('ditahan (bahan kurang)');
  });

  it('let the boss approve or reject a report on the desk, and not twice while it is being sent', async () => {
    const { root, panels, calls } = setup();
    const input = { state: world(), status: 'open' as const, nowMs: 1000 };
    panels.update(input);
    root.button('Setujui').click();
    expect(calls.decide).toEqual([[1, 'approved']]);
    expect(root.button('Setujui').disabled).toBe(true); // the page was redrawn with the button off
    root.button('Setujui').click();
    expect(calls.decide).toHaveLength(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(root.button('Setujui').disabled).toBe(false);
    root.button('Tolak').click();
    expect(calls.decide[1]).toEqual([1, 'rejected']);
  });

  it('show a report that is still on its way without buttons', () => {
    const { root, panels } = setup();
    const state = applySnapshot(
      snapshot({ reports: [{ ...report, status: 'drafted', submitted_at_sim: null }] }),
      0,
    );
    panels.update({ state, status: 'open', nowMs: 0 });
    expect(root.textContent).toContain('dibawa ke meja bos');
    expect(
      root.findAll((node) => node.tag === 'button' && node.textContent === 'Setujui'),
    ).toHaveLength(0);
  });

  it('tell the boss why the server refused a decision', async () => {
    const { root, panels } = setup({
      decide: () =>
        Promise.resolve({ ok: false, status: 409, message: 'Laporan itu sudah diputuskan.' }),
    });
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    root.button('Setujui').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('Laporan itu sudah diputuskan.');
  });

  it('send the time controls: pause, a speed and a jump, and mark the speed that is on', () => {
    const { root, panels, calls } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    root.button('Jeda').click();
    root.button('600x').click();
    root.button('+30 menit').click();
    expect(calls.time).toEqual([{ paused: true }, { speed: 600 }, { advance_seconds: 1800 }]);
    expect(root.button('60x').className).toBe('on');
    expect(root.button('600x').className).toBe('');
  });

  it('offer "Lanjut" while paused, and switch the controls off while the connection is down', () => {
    const { root, panels } = setup();
    const paused = applySnapshot(
      snapshot({ time: { sim_time: 30_000, clock: '08:20', day: 0, speed: 60, paused: true } }),
      0,
    );
    panels.update({ state: paused, status: 'open', nowMs: 0 });
    expect(root.button('Lanjut').className).toBe('on');
    expect(root.textContent).toContain('JEDA');
    panels.update({ state: paused, status: 'closed', nowMs: 0 });
    expect(root.button('Lanjut').disabled).toBe(true);
    expect(root.textContent).toContain('Terputus');
  });

  it('keep the time running on screen between messages from the server', () => {
    const { root, panels } = setup();
    const state = world();
    panels.update({ state, status: 'open', nowMs: 1000 });
    expect(root.textContent).toContain('08:20');
    panels.update({ state, status: 'open', nowMs: 61_000 }); // a real minute later, at 60x
    expect(root.textContent).toContain('09:20');
  });

  it('say that the connection is lost over the picture and in the clock, and take it away again', () => {
    const { root, panels } = setup();
    const banner = () => root.findAll((node) => node.className === 'scene-banner')[0];
    const state = world();
    panels.update({ state, status: 'open', nowMs: 1000 });
    expect(banner()?.style.display).toBe('none');
    panels.update({ state, status: 'closed', nowMs: 1000 });
    expect(banner()?.style.display).toBe('');
    expect(banner()?.textContent).toContain('Terputus');
    expect(root.textContent).toContain('berhenti (terputus)');
    expect(root.textContent).not.toContain('kecepatan 60x');
    panels.update({ state, status: 'open', nowMs: 2000 });
    expect(banner()?.style.display).toBe('none');
    expect(root.textContent).toContain('kecepatan 60x');
  });
});

describe('the choice between the picture and the panels', () => {
  const link = (root: FakeNode) =>
    root.findAll((node) => node.tag === 'a')[0] as unknown as { textContent: string; href: string };
  const slot = (root: FakeNode) =>
    root.findAll((node) => node.className === 'scene-slot')[0] as FakeNode;

  it('offers "panels only" next to the picture', () => {
    const { root } = setup({}, { mode: 'scene', reason: 'default' });
    expect(link(root).textContent).toBe('Panel saja');
    expect(link(root).href).toBe('?view=panel');
    expect(slot(root).style.display).toBeUndefined();
  });

  it('hides the place of the picture in panels-only mode, and offers the picture', () => {
    const { root } = setup({}, { mode: 'panel', reason: 'asked' });
    expect(slot(root).style.display).toBe('none');
    expect(link(root).textContent).toBe('Tampilan 3D');
    expect(link(root).href).toBe('?view=3d');
  });

  it('says why there is no picture when the browser has no WebGL, with no link to a picture it cannot show', () => {
    const { root } = setup({}, { mode: 'panel', reason: 'no-webgl' });
    expect(root.textContent).toContain('tidak mendukung 3D');
    expect(root.findAll((node) => node.tag === 'a')).toHaveLength(0);
  });

  it('still shows all the panels in panels-only mode', () => {
    const { root, panels } = setup({}, { mode: 'panel', reason: 'asked' });
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    for (const text of [
      'Karakter',
      'Pesanan',
      'Stok',
      'Kejadian',
      'Meja Bos',
      'Usul belanja: Susu',
    ]) {
      expect(root.textContent).toContain(text);
    }
  });
});

describe('the sidebar', () => {
  const side = (root: FakeNode) =>
    root.findAll((node) => node.tag === 'aside' && node.className === 'side')[0] as FakeNode;
  const body = (root: FakeNode, title: string) => {
    const section = side(root).findAll(
      (node) => node.tag === 'section' && node.textContent.startsWith(title),
    )[0] as FakeNode;
    return section.findAll((node) => node.className === 'panel-body')[0] as FakeNode;
  };
  const memoryStore = (initial: string | null = null) => {
    const store = {
      value: initial,
      getItem: () => store.value,
      setItem: (_key: string, value: string) => void (store.value = value),
    };
    return store;
  };

  it('holds the time controls, the log and the stock, and the top of the page only the status', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    const sidebar = side(root).textContent;
    for (const text of [
      'Kontrol waktu',
      'Jeda',
      '600x',
      '+1 jam',
      'Kejadian',
      'Stok',
      'Panel saja',
    ])
      expect(sidebar).toContain(text);
    const topbar = root.findAll((node) => node.tag === 'header' && node.className === 'topbar')[0];
    expect(topbar?.textContent).toContain('Hari 0, 08:20');
    expect(topbar?.textContent).not.toContain('Jeda');
    expect(topbar?.textContent).not.toContain('Panel saja');
  });

  it('folds a section away and opens it again, with the title as the button', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    const toggle = side(root).findAll((node) => node.className === 'panel-toggle');
    expect(toggle.map((node) => node.attributes['aria-expanded'])).toEqual([
      'true',
      'true',
      'true',
    ]);
    root.button('Kontrol waktu\u25be').click();
    expect(body(root, 'Kontrol waktu').style.display).toBe('none');
    expect(body(root, 'Kejadian').style.display).toBe('');
    expect(root.button('Kontrol waktu\u25b8').attributes['aria-expanded']).toBe('false');
    root.button('Kontrol waktu\u25b8').click();
    expect(body(root, 'Kontrol waktu').style.display).toBe('');
  });

  it('keeps the time controls working inside a section that was folded and opened again', () => {
    const { root, panels, calls } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    root.button('Kontrol waktu\u25be').click();
    root.button('Kontrol waktu\u25b8').click();
    root.button('600x').click();
    expect(calls.time).toEqual([{ speed: 600 }]);
  });

  it('remembers what was folded, for the next visit', () => {
    const store = memoryStore();
    const first = setup({}, undefined, store);
    first.panels.update({ state: world(), status: 'open', nowMs: 1000 });
    first.root.button('Kejadian\u25be').click();
    expect(JSON.parse(store.value ?? '[]')).toEqual(['log']);

    const second = setup({}, undefined, store);
    second.panels.update({ state: world(), status: 'open', nowMs: 1000 });
    expect(body(second.root, 'Kejadian').style.display).toBe('none');
    expect(body(second.root, 'Stok').style.display).toBe('');
  });
});
