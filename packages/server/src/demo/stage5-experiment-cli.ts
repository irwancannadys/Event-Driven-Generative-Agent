import { measureDays, type Variant } from './stage5';

// npm run experiment:stage5                  the four variants over 12 seeds, 7 days, normal crowd
// npm run experiment:stage5 -- 150 7 12      the crowd (percent), the days, the number of seeds
const crowdPct = Number(process.argv[2] ?? 100);
const days = Number(process.argv[3] ?? 7);
const seeds = Number(process.argv[4] ?? 12);
const VARIANTS: readonly Variant[] = ['baseline', 'forecast', 'policy', 'both'];
const NAMES: Record<Variant, string> = {
  baseline: 'tanpa belajar',
  forecast: 'hanya prakiraan',
  policy: 'hanya kebijakan',
  both: 'keduanya',
};

const total = Object.fromEntries(
  VARIANTS.map((v) => [v, { held: 0, out: 0, complaints: 0, fewer: 0 }]),
) as Record<Variant, { held: number; out: number; complaints: number; fewer: number }>;
for (let seed = 1; seed <= seeds; seed += 1) {
  const results = Object.fromEntries(
    VARIANTS.map((variant) => [variant, measureDays({ seed, days, variant, crowdPct })]),
  ) as Record<Variant, ReturnType<typeof measureDays>>;
  for (const variant of VARIANTS) {
    total[variant].held += results[variant].held;
    total[variant].out += results[variant].stockoutSec;
    total[variant].complaints += results[variant].complaints;
    if (results[variant].held < results.baseline.held) total[variant].fewer += 1;
  }
}
console.log(`=== Eksperimen Tahap 5: ${days} hari, keramaian ${crowdPct}%, ${seeds} seed ===`);
console.log(
  'variant            ditahan  habis(mnt)  komplain  lebih sedikit ditahan dari tanpa belajar',
);
for (const variant of VARIANTS) {
  const row = total[variant];
  console.log(
    `${NAMES[variant].padEnd(17)} ${(row.held / seeds).toFixed(1).padStart(8)} ${(row.out / 60 / seeds).toFixed(1).padStart(11)} ${(row.complaints / seeds).toFixed(1).padStart(9)}  ` +
      (variant === 'baseline' ? '-' : `${row.fewer} dari ${seeds} seed`),
  );
}
console.log('(rata-rata per seed)');
