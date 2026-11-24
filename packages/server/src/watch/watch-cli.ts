import { loadConfig } from '../config';
import { runWatch } from './watch';

// npm run watch            the live board, redrawn every second (Ctrl+C to stop)
// npm run watch -- --once  print the board one time and stop

const once = process.argv.includes('--once');
const apiUrl = process.env.CAFE_API_URL ?? `http://127.0.0.1:${loadConfig().port}`;

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());

process.exitCode = await runWatch({
  apiUrl,
  once,
  clear: !once && process.stdout.isTTY,
  write: (text) => process.stdout.write(text),
  signal: stop.signal,
});
