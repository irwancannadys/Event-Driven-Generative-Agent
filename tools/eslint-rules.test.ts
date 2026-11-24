import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Proves the "core must be deterministic" lint rules really fire, and only inside core.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function lintRuleIds(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  if (!result) throw new Error('ESLint returned no result');
  return result.messages.map((message) => message.ruleId);
}

const inCore = 'packages/core/src/example.ts';
const inServer = 'packages/server/src/example.ts';

describe('core determinism lint rules', () => {
  it('rejects Date.now() in core', async () => {
    const ids = await lintRuleIds('export const t = Date.now();\n', inCore);
    expect(ids).toContain('no-restricted-properties');
  });

  it('rejects Math.random() in core', async () => {
    const ids = await lintRuleIds('export const r = Math.random();\n', inCore);
    expect(ids).toContain('no-restricted-properties');
  });

  it('rejects new Date() without arguments in core', async () => {
    const ids = await lintRuleIds('export const d = new Date();\n', inCore);
    expect(ids).toContain('no-restricted-syntax');
  });

  it('allows new Date(explicitTime) in core', async () => {
    const ids = await lintRuleIds('export const d = new Date(0);\n', inCore);
    expect(ids).toEqual([]);
  });

  it('does not apply the rules outside core', async () => {
    const ids = await lintRuleIds('export const t = Date.now();\n', inServer);
    expect(ids).toEqual([]);
  });
});
