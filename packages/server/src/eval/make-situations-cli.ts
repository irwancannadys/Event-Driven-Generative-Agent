import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITUATIONS_FILE } from './situations';
import { makeSituations } from './make-situations';

// npm run eval:situations   makes eval/llm-situations.json again from simulated days (same seeds, same file)
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const situations = makeSituations();
const file = {
  version: 1,
  generated_by: 'npm run eval:situations (packages/server/src/eval/make-situations.ts)',
  situations,
};
writeFileSync(path.join(repoRoot, SITUATIONS_FILE), `${JSON.stringify(file, null, 2)}\n`);
const count = (purpose: string) => situations.filter((s) => s.purpose === purpose).length;
console.log(
  `${SITUATIONS_FILE}: ${situations.length} situations (${count('stock_proposal')} stock_proposal, ${count('policy_review')} policy_review)`,
);
