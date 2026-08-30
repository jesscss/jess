#!/usr/bin/env node
/**
 * Can the four grammars share PRODUCTIONS via parseman `compose()`, instead of
 * sharing only token recognition via `composeLeaf()`?
 *
 * This is the re-runnable evidence behind
 * `docs/architecture/parser/PRODUCTION-COMPOSE-FEASIBILITY.md`. It is NOT a
 * gate: it is the instrument. Run it after any parseman bump to see whether the
 * blocker has cleared.
 *
 *   node scripts/probe/parseman-compose-feasibility.mjs
 *
 * It runs four synthetic CONTROL/TREATMENT pairs plus one real-grammar
 * treatment. The controls exist so a green treatment cannot be mistaken for a
 * probe that never looked: CONTROL-1 MUST fuse and TREAT-1 MUST fall back, on
 * the same parseman, or the instrument is not measuring what it claims.
 *
 * Findings at parseman 0.46.0 (see the doc for the full write-up):
 *   - `compose()` serializes EVERY piece to IR, including a piece defined
 *     inline in the calling module.
 *   - The IR carries a direct `node()` builder as SOURCE TEXT, and rejects it
 *     unless the callback is macro-static and self-contained.
 *   - Every grammar reducer in this repo calls `@jesscss/core/ast` factories or
 *     a module-scope helper, so essentially the whole production graph is
 *     rejected. Package boundaries are irrelevant to this — it fails with both
 *     pieces inline in one module.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* import.meta.resolve, not require.resolve: the CJS entry has no named
 * `transformMacro` export, and resolving it yields a probe that reports THREW
 * for every case — a uniformly red instrument that looks like a finding. */
const pluginPath = import.meta.resolve('parseman/plugin');
const { transformMacro } = await import(pluginPath);
if (typeof transformMacro !== 'function') {
  throw new Error(`parseman/plugin resolved to ${pluginPath} with no transformMacro export`);
}

/**
 * Run one module through the macro. A throw is an outcome, not a crash.
 *
 * The verdict keys on WARNINGS, which is what `warn()` raises for every
 * un-lowered declaration. It deliberately does NOT key on a surviving
 * `from 'parseman'` import: the real grammars import runtime entry points
 * (`parser`, `run`) from the same package, so that signature is present in a
 * perfectly healthy artifact and scores all four files as fallbacks.
 * `pnpm check:macro` remains the authority for the built artifacts.
 */
function attempt(file, code) {
  try {
    const out = transformMacro(code, file);
    return {
      outcome: out.warnings.length === 0 ? 'FUSED' : 'INTERPRETER FALLBACK',
      warnings: out.warnings,
      code: out.code
    };
  } catch (error) {
    return { outcome: 'THREW', warnings: [], detail: error.message };
  }
}

const dir = mkdtempSync(join(tmpdir(), 'pm-compose-probe-'));
const pkg = (name) => {
  const at = join(dir, name);
  mkdirSync(join(at, 'src'), { recursive: true });
  writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', version: '0.0.0' }));
  return at;
};
const write = (at, rel, source) => {
  const file = join(at, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
};

const pkgA = pkg('probe-a');
const pkgB = pkg('probe-b');

const MACRO = `import { rules, compose, regex, sequence, node, literal } from 'parseman' with { type: 'macro' };`;

/* A self-contained reducer: touches nothing but its own parameter. */
const selfContainedFactory = `
import { regex, sequence, node, literal } from 'parseman' with { type: 'macro' };
const ident = regex(/[a-z]+/);
export const baseFactory = (_g: unknown) => ({
  Thing: node('Thing', sequence(ident, literal(':'), ident), (c: string[]) => ({ k: c[0], v: c[2] }))
});
`;

/* The shape every real grammar reducer has: it calls an imported builder. */
const freeBindingFactory = `
import { regex, sequence, node, literal } from 'parseman' with { type: 'macro' };
import { makeThing } from './builders.js';
const ident = regex(/[a-z]+/);
export const baseFactory = (_g: unknown) => ({
  Thing: node('Thing', sequence(ident, literal(':'), ident), (c: string[]) => makeThing(c[0], c[2]))
});
`;

const builders = `export function makeThing(k: string, v: string) { return { type: 'Thing', k, v }; }\n`;

const consumer = specifier => `${MACRO}
import { baseFactory } from '${specifier}';
const ws = regex(/[ \\t]*/);
export const g = compose([
  rules({ trivia: ws }, baseFactory),
  rules({ trivia: ws }, (_g: unknown) => ({ Extra: regex(/x/) }))
]);
`;

/* Both pieces inline in ONE module — no import, no package boundary at all. */
const inlineConsumer = `${MACRO}
import { makeThing } from './builders.js';
const ws = regex(/[ \\t]*/);
const ident = regex(/[a-z]+/);
export const g = compose([
  rules({ trivia: ws }, (_g: unknown) => ({
    Thing: node('Thing', sequence(ident, literal(':'), ident), (c: string[]) => makeThing(c[0], c[2]))
  })),
  rules({ trivia: ws }, (_g: unknown) => ({ Extra: regex(/x/) }))
]);
`;

write(pkgA, 'src/builders.ts', builders);

const cases = [
  {
    id: 'CONTROL-1',
    expect: 'FUSED',
    what: 'compose() over a same-package imported factory, reducer self-contained',
    file: (() => {
      write(pkgA, 'src/base.ts', selfContainedFactory);
      return write(pkgA, 'src/c1.ts', consumer('./base.js'));
    })()
  },
  {
    id: 'TREAT-1',
    expect: 'INTERPRETER FALLBACK',
    what: 'same, but the factory lives in ANOTHER package (what less/scss/jess would need)',
    file: (() => {
      write(pkgB, 'src/base.ts', selfContainedFactory);
      return write(pkgB, 'src/c1.ts', consumer('../../probe-a/src/base.js'));
    })()
  },
  {
    id: 'TREAT-2',

    /* Falls back EARLIER than TREAT-3 throws: a factory module that imports
     * anything is already "not statically evaluable", so the IR builder check
     * is never reached. Different symptom, same wall. */
    expect: 'INTERPRETER FALLBACK',
    what: 'same-package imported factory whose reducer calls an IMPORTED builder',
    file: (() => {
      write(pkgA, 'src/base-free.ts', freeBindingFactory);
      return write(pkgA, 'src/c2.ts', consumer('./base-free.js'));
    })()
  },
  {
    id: 'TREAT-3',
    expect: 'THREW',
    what: 'compose() over two pieces inline in ONE module, reducer calls an imported builder',
    file: write(pkgA, 'src/c3.ts', inlineConsumer)
  }
];

let failures = 0;
console.log(`parseman plugin: ${pluginPath}\n`);
console.log('--- synthetic control/treatment pairs ---');
for (const c of cases) {
  const got = attempt(c.file, readFileSync(c.file, 'utf8'));
  const ok = got.outcome === c.expect;
  if (!ok) {
    failures++;
  }
  console.log(`${ok ? 'as expected' : 'CHANGED   '}  ${c.id.padEnd(9)} ${got.outcome.padEnd(21)} ${c.what}`);
  if (got.detail) {
    console.log(`${' '.repeat(14)}${got.detail}`);
  }
  for (const w of got.warnings) {
    console.log(`${' '.repeat(14)}${w.split(' — ').slice(1).join(' — ')}`);
  }
}

console.log('\n--- real grammars: the committed file with composeLeaf() swapped for compose() ---');
const grammars = [
  'packages/syntax/css/css-parser/src/grammar.ts',
  'packages/syntax/less/less-parser/src/grammar.ts',
  'packages/syntax/scss/scss-parser/src/grammar.ts',
  'packages/syntax/jess/jess-parser/src/grammar.ts'
];
for (const rel of grammars) {
  const file = join(root, rel);
  const src = readFileSync(file, 'utf8');
  const asCommitted = attempt(file, src);
  const swapped = src
    .replace(/^import \{ ([^}]*)\bcomposeLeaf\b/m, 'import { $1compose')
    .replace(/composeLeaf\(\[/g, 'compose([');
  const treated = attempt(file, swapped);
  console.log(`${rel}`);
  console.log(`   as committed (composeLeaf): ${asCommitted.outcome}`);
  console.log(`   swapped to compose():       ${treated.outcome}${treated.detail ? ` — ${treated.detail}` : ''}`);
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'Instrument behaved as recorded.' : `${failures} case(s) DIVERGED from the recorded 0.46.0 behaviour — re-read the doc before trusting either result.`}`);
