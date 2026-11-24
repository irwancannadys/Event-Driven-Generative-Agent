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
    // only the titles that fold a section and the button of the menu are left, no time control
    const buttons = root.findAll((node) => node.tag === 'button');
    expect(
      buttons.every(
        (node) =>
          ['panel-toggle', 'menu-button'].includes(node.className) ||
          node.className.startsWith('seg'),
      ),
    ).toBe(true);
  });

  it('show the connection, the time, the characters, the orders, the stock, the log and the boss desk', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    const text = root.textContent;
    expect(text).toContain('Tersambung');
    expect(text).toContain('Hari 0, 08:20');
    expect(text).toContain('kecepatan 60x');
    expect(text).toContain('Kasir');
    expect(text).toContain('Idle');
    expect(text).toContain('Susu');
    expect(text).toContain('1.000 / 6.000 ml');
    expect(text).toContain('Rendah');
    expect(text).toContain('Kafe buka (hari 0)');
    expect(text).toContain('Usul belanja: Susu');
    expect(text).toContain('Susu: pesan 5000 ml.');
    expect(text).toContain('Ditahan');
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
      'Meja bos',
      'Admin Stok',
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

  it('holds the log and the stock, and none of the time controls or the complaints', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    const sidebar = side(root).textContent;
    for (const text of ['Kejadian', 'Stok']) expect(sidebar).toContain(text);
    expect(sidebar).not.toContain('Komplain');
    for (const text of ['Jeda', '600x', '+1 jam', 'Panel saja', 'Kontrol waktu'])
      expect(sidebar).not.toContain(text);
  });

  it('folds a section away and opens it again, with the title as the button', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    const toggle = side(root).findAll((node) => node.className === 'panel-toggle');
    expect(toggle.map((node) => node.attributes['aria-expanded'])).toEqual(['true', 'true']);
    root.button('Kejadian\u25be').click();
    expect(body(root, 'Kejadian').style.display).toBe('none');
    expect(body(root, 'Stok').style.display).toBe('');
    expect(root.button('Kejadian\u25b8').attributes['aria-expanded']).toBe('false');
    root.button('Kejadian\u25b8').click();
    expect(body(root, 'Kejadian').style.display).toBe('');
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

describe('the complaints panel', () => {
  const complaintsPanel = (root: FakeNode) =>
    root.findAll(
      (node) => node.tag === 'section' && node.className.startsWith('panel complaints'),
    )[0];

  it('has a card of its own, which says so when nobody complained', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    expect(complaintsPanel(root)?.textContent).toContain('Komplain');
    expect(complaintsPanel(root)?.textContent).toContain('Belum ada komplain.');
    expect(complaintsPanel(root)?.parent?.parent?.className).toBe('info');
  });

  it('shows each complaint with its order, its cause, where it stands and what is offered', () => {
    const { root, panels } = setup();
    const state = apply(
      world(),
      event('complaint_received', { complaint_id: 1, order_id: 7, cause: 'quality' }, 30_000),
      event(
        'complaint_triaged',
        {
          complaint_id: 1,
          category: 'quality',
          severity: 2,
          suggested_compensation: 'free_item',
          draft_reply: 'maaf',
          needs_boss_decision: true,
        },
        30_060,
      ),
    );
    panels.update({ state, status: 'open', nowMs: 1000 });
    const text = complaintsPanel(root)?.textContent ?? '';
    for (const part of [
      'Pesanan #7',
      'Kualitas',
      'menunggu keputusan bos',
      'usul: item gratis',
      'terbuka',
    ])
      expect(text).toContain(part);
  });
});

describe('the time menu', () => {
  const toggle = (root: FakeNode) =>
    root.findAll((node) => node.className === 'menu-button')[0] as FakeNode;
  const part = (root: FakeNode, className: string) =>
    root.findAll((node) => node.className === className)[0] as FakeNode;
  const topbar = (root: FakeNode) =>
    root.findAll((node) => node.tag === 'header' && node.className === 'topbar')[0] as FakeNode;
  const shown = (root: FakeNode) => part(root, 'menu-panel').style.display === '';

  it('is the clock at the top of the page, and the name of the cafe beside it, with no card of status', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    expect(topbar(root).textContent).toContain("Cand's Coffee");
    expect(topbar(root).textContent).toContain('Hari 0, 08:20');
    expect(toggle(root).textContent).toContain('Hari 0, 08:20');
    expect(toggle(root).attributes['aria-label']).toBe('Kontrol waktu');
    expect(root.findAll((node) => node.className === 'status-strip')).toHaveLength(0);
    expect(shown(root)).toBe(false); // the controls are not on the page until they are asked for
    expect(part(root, 'menu-backdrop').style.display).toBe('none');
  });

  it('opens with the button, with the controls and the link to the panels in it, and closes with it', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    toggle(root).click();
    expect(shown(root)).toBe(true);
    expect(toggle(root).attributes['aria-expanded']).toBe('true');
    const menu = part(root, 'menu-panel').textContent;
    for (const text of [
      'Kontrol waktu',
      'Tersambung',
      'kecepatan 60x',
      'Jeda',
      '1x',
      '600x',
      '+10 menit',
      '+1 jam',
      'Panel saja',
    ])
      expect(menu).toContain(text);
    toggle(root).click();
    expect(shown(root)).toBe(false);
  });

  it('stays open while the controls are used, so that several can be pressed one after another', () => {
    const { root, panels, calls } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    toggle(root).click();
    root.button('600x').click();
    root.button('+30 menit').click();
    expect(calls.time).toEqual([{ speed: 600 }, { advance_seconds: 1800 }]);
    expect(shown(root)).toBe(true);
  });

  it('is put away by a click anywhere else on the page, and by Escape', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    toggle(root).click();
    part(root, 'menu-backdrop').click();
    expect(shown(root)).toBe(false);
    toggle(root).click();
    root.fire('keydown', { key: 'Enter' });
    expect(shown(root)).toBe(true);
    root.fire('keydown', { key: 'Escape' });
    expect(shown(root)).toBe(false);
  });
});

describe('the cards of the page', () => {
  const card = (root: FakeNode, name: string) =>
    root.findAll(
      (node) => node.tag === 'section' && node.className.startsWith(`panel ${name}`),
    )[0] as FakeNode;

  it('puts the orders, the complaints, the characters and the stock admin under the picture, and the boss desk, the stock and the log beside it', () => {
    const { root } = setup();
    const under = root.findAll((node) => node.className === 'info')[0] as FakeNode;
    const beside = root.findAll((node) => node.className === 'side')[0] as FakeNode;
    const names = (node: FakeNode) =>
      node.children.map((child) =>
        typeof child === 'string' ? '' : child.className.split(' ')[1],
      );
    const columns = under.children.filter((child): child is FakeNode => typeof child !== 'string');
    expect(columns.map((column) => names(column))).toEqual([
      ['orders', 'agents'],
      ['admin', 'complaints'],
    ]);
    expect(names(beside)).toEqual(['boss', 'stock', 'log']);
  });

  it('shows the orders as a big number of those that wait, a bar, three tiles, and how many were done', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    const orders = card(root, 'orders');
    expect(orders.textContent).toContain('4 selesai');
    expect(orders.textContent).toContain('2menunggu'); // the big number and what it counts
    for (const label of ['Menunggu', 'Dimasak', 'Ditahan'])
      expect(orders.textContent).toContain(label);
    const parts = orders.findAll((node) => node.className.startsWith('order-seg'));
    expect(parts.map((node) => node.style.width)).toEqual(['50%', '25%', '25%']);
  });

  it('shows every character with the letters of the name and a pill for what they do, and how many are busy', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    const agents = card(root, 'agents');
    expect(agents.textContent).toContain('0 dari 2 bekerja');
    expect(
      agents.findAll((node) => node.className.startsWith('avatar')).map((node) => node.textContent),
    ).toEqual(['K', 'Ko']);
    expect(
      agents.findAll((node) => node.className === 'pill').map((node) => node.textContent),
    ).toEqual(['Idle', 'Idle']);
  });

  it('shows a report of stock as rows of ingredients with what to order, and the urgency as a chip', () => {
    const { root, panels } = setup();
    const state = apply(
      world(),
      event('restock_proposed', {
        report: {
          report_id: 9,
          title: 'Usul belanja: Nasi',
          body: 'Urgensi: normal.\nNasi: pesan 7000 g (stok 1000 dari 8000).',
        },
        items: [{ ingredient_id: 'nasi', qty: 7000 }],
        urgency: 'normal',
        rationale: 'x',
      }),
      event('report_submitted', { report_id: 9 }),
    );
    panels.update({ state, status: 'open', nowMs: 1000 });
    const boss = card(root, 'boss');
    expect(boss.textContent).toContain('2 menunggu');
    expect(boss.textContent).toContain('Urgensi: normal');
    expect(boss.textContent).toContain('Stok 1.000 / 8.000 g');
    expect(boss.textContent).toContain('+7.000 g');
  });

  it('shows the stock with a chip for each ingredient and how many are out or low in the corner', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    const stock = card(root, 'stock');
    expect(stock.textContent).toContain('1 rendah');
    expect(
      stock
        .findAll((node) => node.className.startsWith('chip chip-'))
        .map((node) => node.textContent),
    ).toContain('Rendah');
  });

  it('narrows the log to one kind of event with the buttons in its corner, and back to all', () => {
    const { root, panels } = setup();
    const state = apply(
      world(),
      event('stock_low', { ingredient_id: 'susu', qty: 900, min_qty: 1000 }, 28_830),
      event('day_opened', { day: 0 }, 28_840, { origin: 'scheduler' }),
    );
    panels.update({ state, status: 'open', nowMs: 1000 });
    const sentences = () =>
      card(root, 'log')
        .findAll((node) => node.className === 'sentence')
        .map((node) => node.textContent);
    // the log has three events: the opening of the world (a rule here), the stock that is low (a rule), and the
    // opening of the day (a trigger)
    expect(sentences()).toHaveLength(3);
    root.button('Aturan').click();
    expect(sentences()).toHaveLength(2);
    expect(sentences().some((text) => text.includes('Stok Susu menipis'))).toBe(true);
    root.button('Trigger').click();
    expect(sentences()).toEqual(['Kafe buka (hari 0)']);
    root.button('LLM').click();
    expect(sentences()).toEqual([]);
    root.button('Semua').click();
    expect(sentences()).toHaveLength(3);
  });

  it('shows the stock admin: before the first night what she does, afterwards her review, the policy and her notes', () => {
    const { root, panels } = setup();
    panels.update({ state: world(), status: 'open', nowMs: 1000 });
    expect(card(root, 'admin').textContent).toContain('Belum ada review');
    const state = apply(
      world(),
      event(
        'daily_review_created',
        {
          day: 0,
          summary: 'Hari 0: 75 pesanan.',
          metrics: {
            orders: 75,
            done: 75,
            held: 3,
            complaints: 4,
            held_by_ingredient: {},
            stockout_sec: {},
          },
        },
        72_180,
        { origin: 'llm', actor: 'stock_admin' },
      ),
      event(
        'memory_created',
        { agent_id: 'stock_admin', kind: 'observation', text: 'Hari 0 ramai.' },
        72_180,
      ),
    );
    panels.update({ state, status: 'open', nowMs: 1000 });
    const text = card(root, 'admin').textContent;
    for (const part of [
      'Review hari 0',
      'LLM',
      'Hari 0: 75 pesanan.',
      'Kebijakan berlaku',
      'Belum ada yang diubah dari awal.',
      'Pengamatan',
      'Hari 0 ramai.',
    ])
      expect(text).toContain(part);
  });
});
