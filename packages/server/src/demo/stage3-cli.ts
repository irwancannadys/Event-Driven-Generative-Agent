import { runStage3Demo } from './stage3';

const result = runStage3Demo();
process.exitCode = result.replayOk && result.restartOk ? 0 : 1;
