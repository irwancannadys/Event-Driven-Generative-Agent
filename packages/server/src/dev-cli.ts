import { loadConfig } from './config';
import { startDevServer } from './dev';

const server = await startDevServer({ config: loadConfig() });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal}: mematikan server...`);
  await server.stop();
  console.log('Jam virtual disimpan. Sampai jumpa.');
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
