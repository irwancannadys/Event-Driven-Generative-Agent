import { ORDER_STATUS_NAME_ID, type OrderStatus } from '@cafe/core';
import { t, type TextKey } from '../i18n';
import type { ApiResult, TimeRequest } from '../net/api';
import type { ConnectionStatus } from '../net/connection';
import type { WorldState } from '../state/world';
import type { ViewChoice } from '../view-mode';
import { browserStore, loadFolded, saveFolded, type KeyValueStore } from './collapse';
import { changeDetector, el } from './dom';
import {
  JUMPS,
  SPEEDS,
  agentRows,
  bossDeskView,
  complaintsView,
  logRows,
  orderCounts,
  statusView,
  stockRows,
  type ReportRowView,
} from './view-models';

// The panels of the page: status, characters, orders, the boss desk, and in the sidebar the time
// controls, the event log and the stock (each can be folded away). What each shows comes from `view-models.ts`; this file only puts it on the screen and passes
// the boss's clicks on. It makes no decisions.

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
const ORDER_KEYS: OrderStatus[] = ['placed', 'cooking', 'held', 'done'];

function section(title: TextKey, className: string): { root: HTMLElement; body: HTMLElement } {
  const body = el('div', 'panel-body');
  return { root: el('section', `panel ${className}`, el('h2', '', t(title)), body), body };
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

  // --- the strip on top: connection, time and the time controls ---
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
  const strip = el('header', 'status-strip', dot, connection, clock, pace);

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
  // A section of the sidebar has a title that folds it away and opens it again; what was folded is kept.
  const foldable = (id: string, title: TextKey, className: string) => {
    const body = el('div', 'panel-body');
    const mark = el('span', 'fold-mark');
    const toggle = el('button', 'panel-toggle', t(title), mark);
    toggle.type = 'button';
    const root = el('section', `panel ${className}`, el('h2', '', toggle), body);
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
    return { root, body };
  };

  const agents = section('panel.agents', 'agents');
  const orders = section('panel.orders', 'orders');
  const boss = section('panel.boss', 'boss');
  const controlsPanel = foldable('time', 'panel.time', 'time');
  const log = foldable('log', 'panel.log', 'log');
  const complaints = foldable('complaints', 'panel.complaints', 'complaints');
  const stock = foldable('stock', 'panel.stock', 'stock');
  controlsPanel.body.append(controls, viewControl);
  const sceneSlot = el('section', 'scene-slot');
  const banner = el('div', 'scene-banner', t('status.closed'));
  banner.style.display = 'none';
  sceneSlot.append(banner);
  if (view.mode === 'panel') sceneSlot.style.display = 'none';
  // Like a video page: the picture big on the left with the characters, the orders and the boss desk under
  // it, and a column on the right with the log (it scrolls) and the stock below it.
  const topbar = el('header', 'topbar', el('h1', '', t('app.title')), strip);
  const main = el('div', 'main', sceneSlot, el('div', 'info', agents.root, orders.root, boss.root));
  const side = el('aside', 'side', controlsPanel.root, log.root, complaints.root, stock.root);
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

  const reportCard = (report: ReportRowView, waiting: boolean): HTMLElement => {
    const card = el(
      'article',
      'report',
      el(
        'div',
        'report-title',
        `#${report.id} `,
        el('span', 'tag', report.typeLabel),
        ` ${report.title}`,
      ),
      ...report.body.map((line) => el('div', 'report-line', line)),
    );
    if (!waiting) {
      card.append(el('div', 'muted', t('boss.onTheWay')));
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
          clock.textContent = t('waiting.world');
          pace.textContent = '';
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
      changed('agents', agentView, () =>
        agents.body.replaceChildren(
          ...agentView.map((row) =>
            el(
              'div',
              'row',
              el('strong', '', row.name),
              el('span', 'muted', ` ${row.where} · `),
              row.until ? `${row.doing} (${t('agent.until')} ${row.until})` : row.doing,
            ),
          ),
        ),
      );

      const counts = orderCounts(state);
      changed('orders', counts, () =>
        orders.body.replaceChildren(
          ...ORDER_KEYS.map((key) =>
            el(
              'div',
              'row',
              el('strong', '', String(counts[key])),
              ` ${key === 'held' ? ORDER_STATUS_NAME_ID.held : t(`orders.${key}`)}`,
            ),
          ),
        ),
      );

      const stockView = stockRows(state);
      changed('stock', stockView, () =>
        stock.body.replaceChildren(
          ...stockView.map((row) => {
            const flag =
              row.level === 'out' ? t('stock.out') : row.level === 'low' ? t('stock.low') : '';
            const bar = el('div', 'bar');
            const fill = el('div', `fill ${row.level}`);
            fill.style.width = `${row.percent}%`;
            bar.append(fill);
            return el(
              'div',
              'stock-row',
              el(
                'div',
                'stock-head',
                el('span', '', row.name),
                el(
                  'span',
                  `muted ${row.level}`,
                  `${row.qty} / ${row.capacity} ${row.unit} ${flag}`.trim(),
                ),
              ),
              bar,
            );
          }),
        ),
      );

      const bossView = bossDeskView(state);
      changed('boss', [bossView, [...pending]], () => {
        const cards = [
          ...bossView.waiting.map((report) => reportCard(report, true)),
          ...bossView.onTheWay.map((report) => reportCard(report, false)),
        ];
        boss.body.replaceChildren(
          ...(cards.length > 0 ? cards : [el('div', 'muted', t('boss.empty'))]),
        );
      });

      const complaintList = complaintsView(state, nowMs);
      changed('complaints', complaintList, () =>
        complaints.body.replaceChildren(
          ...(complaintList.rows.length > 0
            ? [
                el(
                  'div',
                  'muted complaint-summary',
                  `${complaintList.open} ${t('complaints.summary.open')} \u00b7 ${complaintList.answered} ${t('complaints.summary.answered')}`,
                ),
                ...complaintList.rows.map((row) =>
                  el(
                    'article',
                    'complaint-row',
                    el(
                      'div',
                      'complaint-head',
                      el('strong', '', row.title),
                      el('span', `tag tag-complaint-${row.status}`, row.statusLabel),
                    ),
                    el('div', 'muted', row.span),
                    ...(row.offer ? [el('div', 'muted', row.offer)] : []),
                  ),
                ),
              ]
            : [el('div', 'muted', t('complaints.empty'))]),
        ),
      );

      const rows = logRows(state);
      changed(
        'log',
        rows.map((row) => row.id),
        () =>
          log.body.replaceChildren(
            ...(rows.length > 0
              ? rows.map((row) =>
                  el(
                    'div',
                    'log-row',
                    el('span', 'muted time', row.clock),
                    el('span', `tag tag-${row.label}`, t(`log.${row.label}` as TextKey)),
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
