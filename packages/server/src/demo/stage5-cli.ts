import { runStage5Demo } from './stage5';

// npm run demo:stage5            4 days, the stock admin learns
// npm run demo:stage5 -- --off   the same days without learning, to compare
const result = runStage5Demo({ learning: !process.argv.includes('--off') });
process.exitCode = result.replayOk && result.restartOk ? 0 : 1;
