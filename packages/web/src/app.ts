import { changeTime, decideReport } from './net/api';
import { connect, type ConnectionStatus } from './net/connection';
import { socketUrl } from './net/url';
import { t } from './i18n';
import { createPanels } from './panels/render';
import { createScene } from './scene';
import { applyMessage, freezeClock, type WorldState } from './state/world';
import { chooseView, hasWebGL } from './view-mode';

/** How often the panels are redrawn, which keeps the virtual clock ticking between server messages. */
const REDRAW_MS = 250;

/** Connects to the server, keeps the state of the world and shows it. */
export function startApp(root: HTMLElement): void {
  let state: WorldState | undefined;
  let status: ConnectionStatus = 'connecting';
  const view = chooseView(
    window.location.search,
    hasWebGL(() => document.createElement('canvas')),
  );
  const panels = createPanels(
    root,
    {
      decide: (reportId, decision) => decideReport(reportId, decision),
      changeTime: (request) => changeTime(request),
    },
    { view },
  );
  const draw = (): void => panels.update({ state, status, nowMs: performance.now() });

  if (view.mode === 'scene') {
    try {
      createScene(panels.sceneSlot, () => state);
    } catch (error) {
      console.error('3D scene could not be made:', error);
      panels.sceneSlot.textContent = t('scene.unavailable');
    }
  }

  connect(socketUrl(window.location), {
    onMessage(message) {
      state = applyMessage(state, message, performance.now());
      draw();
    },
    onStatus(next) {
      status = next;
      // Without the server nobody knows the time: the picture stops until the snapshot of the reconnect.
      if (next === 'closed' && state) state = freezeClock(state, performance.now());
      draw();
    },
  });
  setInterval(draw, REDRAW_MS);
  draw();
}
