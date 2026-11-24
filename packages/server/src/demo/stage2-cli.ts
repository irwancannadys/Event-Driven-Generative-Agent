import { runStage2Demo } from './stage2';

const result = runStage2Demo();
process.exitCode = result.replayOk && result.restartOk ? 0 : 1;
