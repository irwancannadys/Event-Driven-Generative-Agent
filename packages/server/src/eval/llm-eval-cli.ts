import { fileURLToPath } from 'node:url';
import { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL } from '../config';
import { OllamaLLM } from '../llm/ollama-llm';
import { evaluateSituation, formatReport, summarize, type SituationResult } from './run-eval';
import { loadSituations } from './situations';

// npm run eval:llm -- --model qwen3:4b [--runs 3] [--only stock_proposal|policy_review] [--verbose]
//                     [--url http://127.0.0.1:11434] [--timeout 120]
// Puts the situations of eval/llm-situations.json to a model that runs in Ollama and prints how it did.

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const model = option('model') ?? DEFAULT_OLLAMA_MODEL;
const url = option('url') ?? process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
const runs = Number(option('runs') ?? 1);
const timeoutSec = Number(option('timeout') ?? 120);
const only = option('only');
const verbose = process.argv.includes('--verbose');
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a whole number from 1');

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const situations = loadSituations(repoRoot).filter((s) => only === undefined || s.purpose === only);
if (situations.length === 0) throw new Error(`no situation for --only ${only}`);

async function main(): Promise<void> {
  try {
    const tags = (await (await fetch(`${url}/api/tags`)).json()) as { models?: { name: string }[] };
    const installed = (tags.models ?? []).map((entry) => entry.name);
    if (!installed.some((name) => name === model || name === `${model}:latest`)) {
      console.error(
        `Model "${model}" belum terpasang. Pasang dulu: ollama pull ${model}\nTerpasang: ${installed.join(', ') || '(belum ada)'}`,
      );
      process.exit(1);
    }
  } catch {
    console.error(
      `Ollama tidak menjawab di ${url}. Jalankan dulu: ollama serve (atau buka aplikasinya).`,
    );
    process.exit(1);
  }

  const client = new OllamaLLM({ baseUrl: url, model, timeoutMs: timeoutSec * 1000 });
  const now = () => performance.now();

  // The first call has to load the model into memory: it is not counted, so that the latency is the latency of a model that is ready.
  console.error(`Memanaskan ${model} (memuat ke memori)...`);
  const first = situations[0];
  if (first) await evaluateSituation(client, first, now).catch(() => undefined);

  const results: SituationResult[] = [];
  for (let run = 1; run <= runs; run += 1) {
    for (const situation of situations) {
      const result = await evaluateSituation(client, situation, now);
      results.push(result);
      const mark = result.correct ? 'benar' : `fallback (${result.fallbackReason})`;
      console.error(
        `  [putaran ${run}] ${situation.id.padEnd(16)} ${mark}, ${result.attempts}x coba, ${(Math.max(...result.latenciesMs) / 1000).toFixed(1)} dtk`,
      );
      if (verbose) console.error(`      ${situation.note}`);
    }
  }
  const groups: Record<string, ReturnType<typeof summarize>> = {};
  for (const purpose of ['stock_proposal', 'policy_review'] as const) {
    const ofPurpose = results.filter((result) => result.purpose === purpose);
    if (ofPurpose.length > 0) groups[purpose] = summarize(ofPurpose);
  }
  groups.semua = summarize(results);
  console.log(formatReport(model, runs, groups));
}

void main();
