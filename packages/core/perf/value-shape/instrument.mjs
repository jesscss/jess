/**
 * TEMPORARY counter instrumentation for `packages/core/src/ast/value-factory.ts`.
 *
 * Adds a `globalThis.__VF__` census to the six value factories so `census.mjs`
 * can report, per value-node type: how many objects a real compile constructs,
 * and which CONDITIONAL-field combination each one used — i.e. how many V8 maps
 * the conditional spelling actually produces on that workload, as opposed to the
 * combinatorial maximum.
 *
 * This is a measurement tool, never a committed state of the source file.
 *
 *   node packages/core/perf/value-shape/instrument.mjs   # apply
 *   pnpm --filter @jesscss/core build
 *   node packages/core/perf/value-shape/census.mjs <workload> <out.json>
 *   git checkout -- packages/core/src/ast/value-factory.ts   # remove
 *
 * Idempotent, and asserts it patched all six sites rather than silently
 * under-instrumenting when the factory source drifts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const F = resolve(here, '../../src/ast/value-factory.ts');
let s = readFileSync(F, 'utf8');
if (s.includes('__VF__')) {
  console.log('already instrumented');
  process.exit(0);
}

s = s.replace(
  'type Mutable<T> = { -readonly [P in keyof T]: T[P] };',
  `type Mutable<T> = { -readonly [P in keyof T]: T[P] };

/* TEMPORARY MEASUREMENT INSTRUMENTATION - NOT FOR COMMIT */
interface VfEntry { total: number; combos: Record<string, number> }
const VF_STORE: Record<string, VfEntry> =
  ((globalThis as unknown as { __VF__?: Record<string, VfEntry> }).__VF__ ??= {});
function vf(name: string, combo: string): void {
  const e = (VF_STORE[name] ??= { total: 0, combos: {} });
  e.total++;
  e.combos[combo] = (e.combos[combo] ?? 0) + 1;
}`
);

s = s.replace(
  '  const n: Mutable<Dimension> = { type: \'Dimension\', number, unit, bytes: \'\' };',
  '  vf(\'makeDimension\', \'plain\');\n  const n: Mutable<Dimension> = { type: \'Dimension\', number, unit, bytes: \'\' };'
);
s = s.replace(
  '  const n: Mutable<Dimension> = {\n    type: \'Dimension\', number, unit, numerator, denominator, backupUnit, bytes: \'\'',
  '  vf(\'makeCompoundDimension\', backupUnit !== undefined ? \'backupUnit\' : \'-\');\n  const n: Mutable<Dimension> = {\n    type: \'Dimension\', number, unit, numerator, denominator, backupUnit, bytes: \'\''
);
s = s.replace(
  '  const c: Mutable<Color> = {\n    type: \'Color\', rgb, alpha, hsl: undefined, format,',
  `  vf('makeColorRgb', [
    opts?.modernSyntax ? 'modernSyntax' : '',
    opts?.node !== undefined ? 'node' : '',
    opts?.rgbPct !== undefined ? 'rgbPct' : '',
    opts?.alphaPct !== undefined ? 'alphaPct' : ''
  ].filter(Boolean).join('+') || '-');
  const c: Mutable<Color> = {
    type: 'Color', rgb, alpha, hsl: undefined, format,`
);
s = s.replace(
  '  const c: Mutable<Color> = {\n    type: \'Color\', rgb: [0, 0, 0], alpha, hsl, format,',
  `  vf('makeColorHsl', [
    modernSyntax ? 'modernSyntax' : '',
    opts?.hueUnit ? 'hueUnit' : '',
    opts?.alphaPct !== undefined ? 'alphaPct' : ''
  ].filter(Boolean).join('+') || '-');
  const c: Mutable<Color> = {
    type: 'Color', rgb: [0, 0, 0], alpha, hsl, format,`
);
s = s.replace(
  '  const c: Mutable<Collection> = { type: \'Collection\', entries, base, bytes: \'\' };',
  '  vf(\'makeCollection\', base !== undefined ? \'base\' : \'-\');\n  const c: Mutable<Collection> = { type: \'Collection\', entries, base, bytes: \'\' };'
);
s = s.replace(
  '  const block: Mutable<Block> = { type: \'Block\', inner, delimiter, escaped, bytes: \'\' };',
  '  vf(\'makeBlock\', escaped ? \'escaped\' : \'-\');\n  const block: Mutable<Block> = { type: \'Block\', inner, delimiter, escaped, bytes: \'\' };'
);

const n = (s.match(/vf\('/g) ?? []).length;
if (n !== 6) {
  console.error(`EXPECTED 6 counter sites, patched ${n} — the factory source has drifted; fix the anchors.`);
  process.exit(1);
}
writeFileSync(F, s);
console.log('instrumented,', n, 'counter sites');
