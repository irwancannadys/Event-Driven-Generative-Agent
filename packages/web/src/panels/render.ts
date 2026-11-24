import type { LogLabel } from '@cafe/core';
import { t, type TextKey } from '../i18n';
import type { ApiResult, TimeRequest } from '../net/api';
import type { ConnectionStatus } from '../net/connection';
import type { WorldState } from '../state/world';
import type { ViewChoice } from '../view-mode';
import { browserStore, loadFolded, saveFolded, type KeyValueStore } from './collapse';
import { changeDetector, el } from './dom';
import {
  JUMPS,
  LOG_FILTERS,
  SPEEDS,
  adminView,
  agentRows,
  agentsSummary,
  bossDeskView,
  complaintsView,
  formatNumber,
  logRows,
  ordersView,
  statusView,
  stockRows,
  stockSummary,
  type ReportRowView,
} from './view-models';

// The cards of the page: the orders, the complaints, the characters and the stock admin under the picture; the
// boss desk, the stock and the event log in the sidebar (the stock and the log can be folded away); and the clock
// with the time controls in a menu that opens from the top of the page. What each shows comes from
// `view-models.ts`; this file only puts it on the screen and passes the boss's clicks on. It makes no decisions.

export interface PanelActions {
  decide(reportId: number, decision: 'approved' | 'rejected'): Promise<ApiResult>;
  changeTime(request: TimeRequest): Promise<ApiResult>;
}

export interface PanelInput {
  state: WorldState | undefined;
  status: ConnectionStatus;
  nowMs: number;
}

export interface Panels {
  update(input: PanelInput): void;
  /** An empty place between the strip and the panels, for the 3D picture. */
  sceneSlot: HTMLElement;
}

const NOTICE_MS = 5000;

interface Card {
  root: HTMLElement;
  body: HTMLElement;
  /** The corner at the right of the title: a count, a few chips, a filter. */
  aside: HTMLElement;
}

/** A card: the title, a corner, and the body. */
function section(title: TextKey, className: string): Card {
  const body = el('div', 'panel-body');
  const aside = el('div', 'panel-aside');
  const head = el('header', 'panel-head', el('h2', '', t(title)), aside);
  return { root: el('section', `panel ${className}`, head, body), body, aside };
}

const OPEN_MARK = '\u25be';
const FOLDED_MARK = '\u25b8';

export function createPanels(
  root: HTMLElement,
  actions: PanelActions,
  options: { view?: ViewChoice; store?: KeyValueStore } = {},
): Panels {
  const view: ViewChoice = options.view ?? { mode: 'scene', reason: 'default' };
  const store = 'store' in options ? options.store : browserStore();
  const folded = loadFolded(store);
  const changed = changeDetector();
  const pending = new Set<number>();
  let latest: PanelInput | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  // --- the top of the page: the name of the cafe, and the clock with the time controls ---
  const dot = el('span', 'dot');
  const connection = el('span', 'conn');
  const clock = el('strong', 'clock');
  const pace = el('span', 'pace');
  const controls = el('div', 'controls');
  const notice = el('div', 'notice');
  // The way to switch between the picture and the panels only, or the reason there is no picture.
  const viewControl = el('span', 'view-control');
  if (view.reason === 'no-webgl') {
    viewControl.append(el('span', 'muted', t('view.noWebgl')));
  } else {
    const link = el('a', 'view-link', t(view.mode === 'scene' ? 'view.panelOnly' : 'view.scene'));
    link.href = view.mode === 'scene' ? '?view=panel' : '?view=3d';
    viewControl.append(link);
  }
  // The clock is a button: it opens a menu with the connection, the speed and the time controls, which are only
  // needed now and then. A click anywhere else (or Escape) puts them away again.
  const menuMark = el('span', 'fold-mark');
  const menuButton = el('button', 'menu-button', dot, clock, menuMark);
  menuButton.type = 'button';
  menuButton.setAttribute('aria-label', t('panel.time'));
  const menuPanel = el(
    'div',
    'menu-panel',
    el('div', 'menu-title', t('panel.time')),
    el('div', 'menu-status', connection, pace),
    controls,
    viewControl,
  );
  const menuBackdrop = el('div', 'menu-backdrop');
  const menu = el('div', 'menu', menuBackdrop, menuButton, menuPanel);
  let menuOpen = false;
  const showMenu = (): void => {
    menuMark.textContent = menuOpen ? OPEN_MARK : FOLDED_MARK;
    menuButton.setAttribute('aria-expanded', String(menuOpen));
    menuPanel.style.display = menuOpen ? '' : 'none';
    menuBackdrop.style.display = menuOpen ? '' : 'none';
  };
  const setMenu = (open: boolean): void => {
    menuOpen = open;
    showMenu();
  };
  menuButton.addEventListener('click', () => setMenu(!menuOpen));
  menuBackdrop.addEventListener('click', () => setMenu(false));
  root.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') setMenu(false);
  });
  showMenu();

  const showNotice = (message: string): void => {
    notice.textContent = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.textContent = ''), NOTICE_MS);
  };
  const run = async (request: Promise<ApiResult>): Promise<void> => {
    const result = await request;
    if (!result.ok) showNotice(result.message);
  };

  // --- the panels ---
  // A card of the sidebar has a title that folds it away and opens it again; what was folded is kept.
  const foldable = (id: string, title: TextKey, className: string): Card => {
    const body = el('div', 'panel-body');
    const aside = el('div', 'panel-aside');
    const mark = el('span', 'fold-mark');
    const toggle = el('button', 'panel-toggle', t(title), mark);
    toggle.type = 'button';
    const head = el('header', 'panel-head', el('h2', '', toggle), aside);
    const root = el('section', `panel ${className}`, head, body);
    const show = (): void => {
      const open = !folded.has(id);
      mark.textContent = open ? OPEN_MARK : FOLDED_MARK;
      toggle.setAttribute('aria-expanded', String(open));
      body.style.display = open ? '' : 'none';
      root.className = open ? `panel ${className}` : `panel ${className} folded`;
    };
    toggle.addEventListener('click', () => {
      if (!folded.delete(id)) folded.add(id);
      saveFolded(store, folded);
      show();
    });
    show();
    return { root, body, aside };
  };

  const orders = section('panel.orders', 'orders');
  const complaints = section('panel.complaints', 'complaints');
  const agents = section('panel.agents', 'agents');
  const admin = section('panel.admin', 'admin');
  const boss = section('panel.boss', 'boss');
  const stock = foldable('stock', 'panel.stock', 'stock');
  const log = foldable('log', 'panel.log', 'log');
  // The log can be narrowed to the events of one kind; this is only about what the page shows.
  let logFilter: LogLabel | undefined;
  const filterButtons = new Map<LogLabel | 'all', HTMLButtonElement>();
  const chooseFilter = (next: LogLabel | undefined): void => {
    logFilter = next;
    for (const [key, node] of filterButtons)
      node.className = `seg${(next ?? 'all') === key ? ' on' : ''}`;
    if (latest) panels.update({ ...latest });
  };
  for (const key of ['all', ...LOG_FILTERS] as const) {
    const node = el(
      'button',
      'seg',
      t(key === 'all' ? 'log.filter.all' : (`log.${key}` as TextKey)),
    );
    node.type = 'button';
    node.addEventListener('click', () => chooseFilter(key === 'all' ? undefined : key));
    filterButtons.set(key, node);
    log.aside.append(node);
  }
  log.aside.className = 'panel-aside segmented';
  chooseFilter(undefined);
  const sceneSlot = el('section', 'scene-slot');
  const banner = el('div', 'scene-banner', t('status.closed'));
  banner.style.display = 'none';
  sceneSlot.append(banner);
  if (view.mode === 'panel') sceneSlot.style.display = 'none';
  // Like a video page: the picture big on the left with the orders, the complaints, the characters and the stock
  // admin under it, and a column on the right with the boss desk, the stock and the log (it scrolls).
  const brand = el(
    'h1',
    'brand',
    el('span', 'brand-mark'),
    el(
      'span',
      'brand-name',
      t('app.title.first'),
      ' ',
      el('span', 'brand-accent', t('app.title.second')),
    ),
  );
  const topbar = el('header', 'topbar', brand, menu);
  const main = el(
    'div',
    'main',
    sceneSlot,
    // two columns of their own, so a long card does not leave a hole under its neighbour
    el(
      'div',
      'info',
      el('div', 'info-col', orders.root, agents.root),
      el('div', 'info-col', admin.root, complaints.root),
    ),
  );
  const side = el('aside', 'side', boss.root, stock.root, log.root);
  root.replaceChildren(topbar, notice, el('main', 'watch', main, side));

  const drawControls = (paused: boolean, speed: number, enabled: boolean): void => {
    const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
      const node = el('button', className, label);
      node.type = 'button';
      node.disabled = !enabled;
      node.addEventListener('click', onClick);
      return node;
    };
    const speeds = SPEEDS.map((value) =>
      button(
        `${value}x`,
        value === speed ? 'on' : '',
        () => void run(actions.changeTime({ speed: value })),
      ),
    );
    const jumps = JUMPS.map((seconds) =>
      button(
        t(`time.advance.${seconds}` as TextKey),
        '',
        () => void run(actions.changeTime({ advance_seconds: seconds })),
      ),
    );
    controls.replaceChildren(
      button(
        paused ? t('time.resume') : t('time.pause'),
        paused ? 'on' : '',
        () => void run(actions.changeTime({ paused: !paused })),
      ),
      el('span', 'group', t('time.speed'), ...speeds),
      el('span', 'group', t('time.advance'), ...jumps),
    );
  };

  const chip = (className: string, text: string): HTMLElement =>
    el('span', `chip ${className}`, text);

  const reportCard = (report: ReportRowView, waiting: boolean): HTMLElement => {
    const card = el(
      'article',
      'report',
      el(
        'div',
        'report-meta',
        el('span', 'report-id', `#${report.id}`),
        chip('chip-type', report.typeLabel),
        ...(report.urgency ? [chip('chip-urgency', report.urgency)] : []),
      ),
      el('div', 'report-title', report.title),
      ...report.items.map((item) =>
        el(
          'div',
          'report-item',
          el(
            'div',
            'report-item-main',
            el('strong', '', item.name),
            el('span', 'report-sub', item.stock),
          ),
          el('span', 'report-qty', item.order),
        ),
      ),
      ...report.lines.map((line) => el('div', 'report-line', line)),
    );
    if (!waiting) {
      card.append(el('div', 'report-sub', t('boss.onTheWay')));
      return card;
    }
    const decide = (decision: 'approved' | 'rejected'): HTMLButtonElement => {
      const node = el(
        'button',
        decision === 'approved' ? 'approve' : 'reject',
        t(decision === 'approved' ? 'boss.approve' : 'boss.reject'),
      );
      node.type = 'button';
      node.disabled = pending.has(report.id);
      node.addEventListener('click', () => {
        pending.add(report.id);
        if (latest) panels.update({ ...latest });
        void run(actions.decide(report.id, decision)).finally(() => {
          pending.delete(report.id);
          if (latest) panels.update({ ...latest });
        });
      });
      return node;
    };
    card.append(el('div', 'report-actions', decide('approved'), decide('rejected')));
    return card;
  };

  const panels: Panels = {
    sceneSlot,
    update(input) {
      latest = input;
      const { state, status, nowMs } = input;
      changed('conn', status, () => {
        dot.className = `dot ${status}`;
        connection.textContent = t(`status.${status}`);
      });
      changed('banner', status, () => {
        banner.style.display = status === 'closed' ? '' : 'none';
      });
      if (!state) {
        changed('clock', 'none', () => {
          clock.textContent = '--:--';
          pace.textContent = t('waiting.world');
          controls.replaceChildren();
        });
        return;
      }

      const time = statusView(state, nowMs);
      clock.textContent = `${t('clock.day')} ${time.day}, ${time.clock}`;
      pace.textContent =
        status === 'closed'
          ? t('clock.disconnected')
          : time.paused
            ? t('clock.paused')
            : `${t('clock.speed')} ${time.speed}x`;
      changed('controls', [time.paused, time.speed, status], () =>
        drawControls(time.paused, time.speed, status === 'open'),
      );

      const agentView = agentRows(state);
      const summary = agentsSummary(state);
      changed('agents', [agentView, summary], () => {
        agents.aside.textContent = `${summary.busy} ${t('agents.outOf')} ${summary.total} ${t('agents.summary')}`;
        agents.body.replaceChildren(
          ...agentView.map((row) =>
            el(
              'div',
              'agent-row',
              el('span', `avatar avatar-${row.id}`, row.initials),
              el('div', 'agent-main', el('strong', '', row.name), el('span', 'muted', row.detail)),
              el('span', `pill${row.busy ? ' pill-on' : ''}`, row.statusLabel),
            ),
          ),
        );
      });

      const orderSummary = ordersView(state);
      changed('orders', orderSummary, () => {
        orders.aside.textContent = `${orderSummary.done} ${t('orders.doneTotal')}`;
        const bar = el('div', 'order-bar');
        for (const key of ['placed', 'cooking', 'held'] as const) {
          const part = el('span', `order-seg seg-${key}`);
          part.style.width = `${orderSummary.bar[key]}%`;
          bar.append(part);
        }
        const tile = (key: 'placed' | 'cooking' | 'held') =>
          el(
            'div',
            `order-tile tile-${key}`,
            el('strong', '', String(orderSummary[key])),
            el('span', '', t(`orders.tile.${key}` as TextKey)),
          );
        orders.body.replaceChildren(
          el(
            'div',
            'orders-hero',
            el('strong', 'hero-number', String(orderSummary.placed)),
            el('span', 'muted', t('orders.waitingBig')),
          ),
          bar,
          el('div', 'order-tiles', tile('placed'), tile('cooking'), tile('held')),
        );
      });

      const stockView = stockRows(state);
      const stockCounts = stockSummary(state);
      changed('stock', [stockView, stockCounts], () => {
        stock.aside.replaceChildren(
          ...(stockCounts.out > 0
            ? [chip('chip-danger', `${stockCounts.out} ${t('stock.summary.out')}`)]
            : []),
          ...(stockCounts.low > 0
            ? [chip('chip-warn', `${stockCounts.low} ${t('stock.summary.low')}`)]
            : []),
        );
        stock.body.replaceChildren(
          ...stockView.map((row) => {
            const bar = el('div', 'bar');
            const fill = el('div', `fill ${row.level}`);
            fill.style.width = `${row.percent}%`;
            bar.append(fill);
            const flag =
              row.level === 'out' ? 'stock.out' : row.level === 'low' ? 'stock.low' : 'stock.ok';
            return el(
              'div',
              'stock-row',
              el('strong', 'stock-name', row.name),
              bar,
              el(
                'span',
                'stock-qty',
                `${formatNumber(row.qty)} / ${formatNumber(row.capacity)} ${row.unit}`,
              ),
              chip(`chip-${row.level}`, t(flag)),
            );
          }),
        );
      });

      const bossView = bossDeskView(state);
      changed('boss', [bossView, [...pending]], () => {
        boss.aside.replaceChildren(
          ...(bossView.waiting.length > 0
            ? [chip('chip-amber', `${bossView.waiting.length} ${t('boss.waitingPill')}`)]
            : []),
        );
        const cards = [
          ...bossView.waiting.map((report) => reportCard(report, true)),
          ...bossView.onTheWay.map((report) => reportCard(report, false)),
        ];
        boss.body.replaceChildren(
          ...(cards.length > 0 ? cards : [el('div', 'report-sub', t('boss.empty'))]),
        );
      });

      const complaintList = complaintsView(state, nowMs);
      changed('complaints', complaintList, () => {
        const stat = (count: number, key: TextKey) =>
          el('div', 'stat-box', el('strong', '', String(count)), el('span', 'muted', t(key)));
        complaints.body.replaceChildren(
          el(
            'div',
            'stat-boxes',
            stat(complaintList.open, 'complaints.summary.open'),
            stat(complaintList.answered, 'complaints.summary.answered'),
          ),
          ...(complaintList.rows.length > 0
            ? complaintList.rows.map((row) =>
                el(
                  'article',
                  'complaint-row',
                  el(
                    'div',
                    'complaint-head',
                    el('strong', '', row.order),
                    chip(`chip-complaint-${row.status}`, row.statusLabel),
                  ),
                  el('div', 'complaint-cause', row.cause),
                  el('div', 'muted', row.offer ? `${row.span} \u00b7 ${row.offer}` : row.span),
                ),
              )
            : [el('div', 'muted', t('complaints.empty'))]),
        );
      });

      const adminCard = adminView(state);
      changed('admin', adminCard, () => {
        admin.aside.textContent = adminCard.review
          ? `${t('admin.review')} ${adminCard.review.day}`
          : '';
        if (!adminCard.review && adminCard.notes.length === 0) {
          admin.body.replaceChildren(el('div', 'muted', t('admin.empty')));
          return;
        }
        admin.body.replaceChildren(
          ...(adminCard.review
            ? [
                el(
                  'div',
                  'admin-review',
                  el(
                    'div',
                    'admin-origin',
                    chip(`chip-origin-${adminCard.review.originKey}`, adminCard.review.origin),
                  ),
                  el('p', 'admin-summary', adminCard.review.summary),
                ),
              ]
            : []),
          el(
            'div',
            'admin-section',
            el('h3', '', t('admin.policy')),
            ...(adminCard.changes.length > 0
              ? adminCard.changes.map((change) =>
                  el(
                    'div',
                    'admin-change',
                    el('strong', '', change.name),
                    el(
                      'span',
                      'muted',
                      `${formatNumber(change.from)} \u2192 ${formatNumber(change.to)} ${change.unit}`,
                    ),
                  ),
                )
              : [el('div', 'muted', t('admin.noPolicy'))]),
          ),
          ...(adminCard.notes.length > 0
            ? [
                el(
                  'div',
                  'admin-section',
                  el('h3', '', t('admin.notes')),
                  ...adminCard.notes.map((note) =>
                    el(
                      'div',
                      'admin-note',
                      chip(`chip-note-${note.kind}`, note.kindLabel),
                      el('span', 'admin-note-text', note.text),
                    ),
                  ),
                ),
              ]
            : []),
        );
      });

      const rows = logRows(state, 60, logFilter);
      changed('log', [rows.map((row) => row.id), logFilter ?? 'all'], () =>
        log.body.replaceChildren(
          ...(rows.length > 0
            ? rows.map((row) =>
                el(
                  'div',
                  'log-row',
                  el('span', 'time', row.showTime ? row.clock : ''),
                  el('span', `chip chip-log-${row.label}`, t(`log.${row.label}` as TextKey)),
                  el('span', 'sentence', row.sentence),
                ),
              )
            : [el('div', 'muted', t('log.empty'))]),
        ),
      );
    },
  };
  return panels;
}
