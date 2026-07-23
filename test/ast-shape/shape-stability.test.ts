import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse as parseLess } from '@jesscss/less-parser';
import { parse as parseScss } from '@jesscss/scss-parser';
import { parse as parseJess } from '@jesscss/jess-parser';
import { collectShapes, formatShapeReport, SHAPE_DEBT_ALLOWLIST, type CorpusSource } from './shape-probe.js';

/**
 * V8 shape-stability gate (mechanical detector for megamorphic keyed-store cost).
 *
 * Every AST node `type` should be constructed with exactly ONE own-property key
 * SHAPE (ordered key list). When a single `type` is built with two different key
 * orders / key sets, V8 keeps distinct hidden classes for it and every keyed
 * store into that node goes megamorphic. Byte-identity and wall-time are BLIND to
 * this, so we assert it structurally: parse a broad corpus into the canonical AST
 * and require one shape per type.
 *
 * This is pure test-side instrumentation — it walks freshly PARSED trees (no
 * serialize pass, so lazy serializer memos on selectors stay unset) and reads
 * `Object.keys` order. Zero production code path, zero production overhead. Source
 * spans and value layouts are held in out-of-band WeakMaps (see provenance.ts),
 * so they never perturb node shape.
 *
 * Known-current polymorphism is captured in SHAPE_DEBT_ALLOWLIST (see
 * shape-probe.ts): the test passes on today's debt but FAILS on any NEW
 * divergence, or when an allowlisted type gains a shape beyond its recorded set.
 */

const here = dirname(fileURLToPath(import.meta.url));
// test/ast-shape -> repo root is two levels up.
const repoRoot = resolve(here, '../..');
const readSource = (label: string, rel: string): CorpusSource => ({ label, text: readFileSync(resolve(repoRoot, rel), 'utf8') });
const s = (label: string, text: string): CorpusSource => ({ label, text });

/**
 * Broad Less corpus. benchmark.less is the widest single-file node surface (it
 * is the perf feature-exercise workload); the small snippets fill node types the
 * benchmark does not reach. Each snippet is granular so a parse failure isolates.
 */
const lessSources: CorpusSource[] = [
  readSource('benchmark.less', 'packages/jess/benchmark/benchmark.less'),
  s('extend', '.a:extend(.b all) { color: red; } .c { &:extend(.d); width: 10px; }'),
  s('guard', '.guard(@x) when (@x > 0) and (iscolor(@x)) { x: @x; }'),
  s('detached-ruleset', '@dr: { prop: val; }; .use { @dr(); }'),
  s('map-lookup', '@map: { primary: blue; }; .m { color: @map[primary]; }'),
  s('media-math', '@media (min-width: 100px) { .r { top: (1px + 2px) * 3; } }'),
  s('interp-selector', '.sel-@{name} { color: red; }'),
  s('interp-value', '.q { content: "a@{b}c"; background: ~"raw"; }'),
  s('fn-and-negation', '.call { width: percentage(0.5); margin: -@x; }'),
  s('import-reference', '@import (reference) "file.less";'),
  s('slash-and-important', '.x { font: 12px/1.5 sans-serif; color: red !important; }'),
  s('comma-list', '.list { transition: color 1s, background 2s; }'),
  s('leading-comment', '/* leading */\n.x { a: 1; }'),
  s('var-indirect', '.vi { color: @@name; }'),
  s('url', '.u { background: url(foo.png); }'),
  s('mixin-call', '.mx() { a: 1; } .use { .mx(); }'),
  s('at-statement', '@charset "utf-8";')
];

/** Broad SCSS corpus (Sass+ dialect). Granular so a rejection isolates. */
const scssSources: CorpusSource[] = [
  s('var-decl', '$primary: #333;'),
  s('mixin-include', '@mixin box($p: 10px) { padding: $p; } .card { @include box(20px); }'),
  s('nesting-parent', '.card { color: red; &:hover { color: blue; } }'),
  s('supports', '@supports (display: grid) { .g { width: 5px; } }'),
  s('placeholder-extend', '%placeholder { border: 1px solid; } .use { @extend %placeholder; }'),
  s('if-else', '@if true { .a { x: 1; } } @else { .b { y: 2; } }'),
  s('each', '@each $i in 1, 2, 3 { .col { width: $i; } }'),
  s('for', '@for $j from 1 through 3 { .row { top: $j; } }'),
  s('nesting-combinator', '.nesting { a: 1; .child { b: 2; & + & { c: 3; } } }'),
  s('media', '@media screen and (min-width: 100px) { .r { d: 4; } }'),
  s('interp-value', '.interp { content: "pre#{$x}post"; }'),
  s('interp-selector', '.col-#{$i} { width: 1px; }')
];

/**
 * Jess corpus: snippets proven to parse through the public AST route (drawn from
 * jess-parser/test/ast-grammar.test.ts). The `.jess` test-data files exercise
 * CST-only features the AST `parse()` intentionally trails on, so they are not
 * used here.
 */
const jessSources: CorpusSource[] = [
  s('if-else-chain', '$theme: "dark"; $if ($theme = "light") { .card { color: black; } } $else if ($theme = "dark") { .card { color: white; } } $else { .card { color: gray; } }'),
  s('guarded-numeric', '$size: 6; $if ($size>5) { .card { color: green; } } $else { .card { color: red; } }'),
  s('nearest-outer-assign', '$tone: gray; $if (true) { $tone := blue; $$tone := navy; } .after { live: $tone; }'),
  s('mixin-activate', '$if (true) { paint() { color: blue; } .after { $ > paint(); } }'),
  s('apply-and-for', 'paint() { color: red; } $held: { background: blue; }; $items: one, two; .host { $ > paint(); $held(); $apply paint; $for ($item of $items) { .item-$[item] { order: $item; } } }'),
  s('apply-selectors', '$apply .rounded, #theme, button[data-x]:hover;'),
  s('mixin-params', 'outer($tone) { .inside { color: $tone; } } .one { $ > outer(red); }')
];

interface DialectCorpus {
  readonly name: string;
  readonly parse: (input: string) => object;
  readonly sources: readonly CorpusSource[];
}

const corpora: DialectCorpus[] = [
  { name: 'less', parse: parseLess as (s: string) => object, sources: lessSources },
  { name: 'scss', parse: parseScss as (s: string) => object, sources: scssSources },
  { name: 'jess', parse: parseJess as (s: string) => object, sources: jessSources }
];

const DISCOVER = process.env.SHAPE_DISCOVER === 'true';

describe('AST v2 shape stability', () => {
  if (DISCOVER) {
    it('reports the full per-type shape inventory', () => {
      const result = collectShapes(corpora, true);
      console.log(formatShapeReport(result));
      expect(result.shapes.size).toBeGreaterThan(0);
    });
    return;
  }

  const { shapes } = collectShapes(corpora, false);

  it('parses the whole corpus into typed nodes (coverage floor)', () => {
    // Guards against a silently-empty corpus masking the assertion below.
    expect(shapes.size).toBeGreaterThanOrEqual(25);
  });

  it('constructs every node type with exactly one key shape', () => {
    const violations: string[] = [];
    for (const [type, signatures] of shapes) {
      if (signatures.size <= 1) {
        continue;
      }
      const allowed = SHAPE_DEBT_ALLOWLIST[type];
      if (allowed !== undefined) {
        const unexpected = [...signatures].filter(s => !allowed.includes(s));
        if (unexpected.length > 0) {
          violations.push(
            `  ${type}: allowlisted but gained NEW shape(s):\n`
            + unexpected.map(s => `      + [${s}]`).join('\n')
          );
        }
        continue;
      }
      violations.push(
        `  ${type}: ${signatures.size} distinct shapes (unlisted polymorphism):\n`
        + [...signatures].map(s => `      [${s}]`).join('\n')
      );
    }
    expect(
      violations.join('\n'),
      violations.length === 0
        ? undefined
        : `Megamorphic AST node shapes detected. Either monomorphize the node `
          + `(Phase B) or, if intentional, add the shapes to SHAPE_DEBT_ALLOWLIST:\n`
          + violations.join('\n')
    ).toBe('');
  });

  it('does not regress the recorded shape-debt allowlist', () => {
    // Any allowlisted type that is now monomorphic (or absent) should be pruned
    // from the ledger so the debt inventory stays honest.
    const stale: string[] = [];
    for (const type of Object.keys(SHAPE_DEBT_ALLOWLIST)) {
      const signatures = shapes.get(type);
      if (signatures === undefined || signatures.size <= 1) {
        stale.push(type);
      }
    }
    expect(
      stale.join(', '),
      stale.length === 0 ? undefined : `Allowlist entries no longer polymorphic — prune them: ${stale.join(', ')}`
    ).toBe('');
  });
});
