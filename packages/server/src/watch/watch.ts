import { fetchDashboard } from './fetch-dashboard';
import { formatDashboard } from './format-dashboard';

export interface WatchOptions {
  apiUrl: string;
  /** Print the board one time and stop. */
  once?: boolean;
  intervalMs?: number;
  write: (text: string) => void;
  /** Clear the screen before every board (a terminal), instead of printing boards under each other. */
  clear?: boolean;
  /** Stops the loop. */
  signal?: AbortSignal;
}

const CLEAR_SCREEN = '\x1b[2J\x1b[H';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * The live board: polls the API and redraws. Returns the exit code: 0 after a clean stop, 1 when
 * `once` was asked and the server could not be reached.
 */
export async function runWatch(options: WatchOptions): Promise<number> {
  const { apiUrl, write, signal } = options;
  const intervalMs = options.intervalMs ?? 1000;
  for (;;) {
    let ok = true;
    let text: string;
    try {
      text = formatDashboard(await fetchDashboard(apiUrl));
    } catch {
      ok = false;
      text = `Belum bisa menyambung ke server di ${apiUrl}.\nJalankan "npm run dev" di terminal lain, lalu board ini jalan sendiri.`;
    }
    write(options.clear ? `${CLEAR_SCREEN}${text}\n` : `${text}\n`);
    if (options.once) return ok ? 0 : 1;
    if (signal?.aborted) return 0;
    await sleep(intervalMs, signal);
    if (signal?.aborted) return 0;
  }
}
