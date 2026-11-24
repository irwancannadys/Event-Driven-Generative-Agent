import { runStage1Demo } from './stage1';

const result = await runStage1Demo();
process.exitCode = result.replayOk ? 0 : 1;
