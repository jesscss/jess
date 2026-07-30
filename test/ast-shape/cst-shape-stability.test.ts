import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseCssCst, parseCssDiagnosticCst } from '@jesscss/css-parser/cst';
import { parseLessCst, parseLessDiagnosticCst } from '@jesscss/less-parser/cst';
import { parseScssCst } from '@jesscss/scss-parser/cst';
import { parseJessCst } from '@jesscss/jess-parser/cst';
import { collectCstShapes, formatCstShapeReport, type CstCorpusEntry } from './cst-shape-probe.js';

/**
 * V8 shape-stability gate, CST half. See cst-shape-probe.ts for why this asserts
 * per-KIND signature sets instead of per-`type` ones.
 *
 * All four dialects route their CST through the SAME `buildCssCstNode`, so this
 * has a four-dialect blast radius and is asserted on all four.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const read = (rel: string): string => readFileSync(resolve(repoRoot, rel), 'utf8');

const BENCH_CSS = 'packages/jess/benchmark/benchmark.css';
const BENCH_LESS = 'packages/jess/benchmark/benchmark.less';
const BENCH_JESS = 'packages/jess/benchmark/benchmark.jess';

/*
 * No cast: each dialect's CST result is structurally assignable to the two
 * fields the probe reads (`tree`, `ok`), so the parsers pass through as-is.
 */
const entry = (label: string, parse: CstCorpusEntry['parse'], text: string): CstCorpusEntry =>
  ({ label, parse, text });

/**
 * Every fixture is a real stylesheet, plus targeted sources for the two
 * conditional-span builders (`shiftedSpan` via a `~` Quoted, `joinedSpan` via a
 * Url). The DIAGNOSTIC artifact is included deliberately: it is the only mode
 * that populates startLine/startColumn/endLine/endColumn, so it is the only mode
 * in which those two builders' line-carrying branch executes at all. A CST gate
 * that omitted it would be structurally blind to the exact code path the
 * `cst.ts` span fix addresses.
 */
/**
 * Jess CST sources are INLINE, not `benchmark.jess`, and jess is deliberately
 * absent from the on-CSS row. Two measured reasons, both of which had this gate
 * counting jess as covered while it contributed nothing:
 *   - `benchmark.jess` is a 124-byte stub -> 1 node, 0 leaves.
 *   - `parseJessCst(benchmark.css)` returns ok:false and a 1-node
 *     `emptyStyleSheet()` for 123KB of input. The `.jess` parser trails the
 *     others on full CSS; that is a known gap, not something to hide inside a
 *     shape gate.
 * The snippets below are verified to parse (see the yield assertion).
 */
const JESS_SOURCES = [
  ['jess:if-else', '$theme: "dark"; $if ($theme = "light") { .card { color: black; } } $else { .card { color: white; } }'],
  ['jess:mixin-apply-for', 'paint() { color: red; } $held: { background: blue; }; $items: one, two; .host { $ > paint(); $held(); $apply .paint; $for ($item of $items) { .item-${item} { order: $item; } } }'],
  ['jess:plain-css', '.a { color: red; }\n@media screen { .b { top: 0; } }'],
  ['jess:url-quoted', '.u { background: url(foo.png); }\n.q { content: "abc"; }']
] as const;

function corpus(): CstCorpusEntry[] {
  const sources: CstCorpusEntry[] = [];
  const css = existsSync(resolve(repoRoot, BENCH_CSS)) ? read(BENCH_CSS) : null;
  if (css !== null) {
    // Valid CSS is valid in css/less/scss, so the shared builder is exercised
    // through those three front ends on identical bytes.
    sources.push(
      entry('css:benchmark', parseCssCst, css),
      entry('less-on-css:benchmark', parseLessCst, css),
      entry('scss-on-css:benchmark', parseScssCst, css),
      entry('css-diagnostic:benchmark', parseCssDiagnosticCst, css)
    );
  }
  if (existsSync(resolve(repoRoot, BENCH_LESS))) {
    sources.push(entry('less:benchmark', parseLessCst, read(BENCH_LESS)));
  }
  for (const [label, text] of JESS_SOURCES) {
    sources.push(entry(label, parseJessCst, text));
  }

  const spanSources = '.u {\n  background: url(foo.png);\n}\n.q {\n  content: "abc";\n}\n';
  sources.push(
    entry('css:span-builders', parseCssCst, spanSources),
    entry('css-diagnostic:span-builders', parseCssDiagnosticCst, spanSources),
    /*
     * `~"raw"` is the shiftedSpan trigger (a Quoted whose first leaf starts
     * `~`). The second entry MUST use the diagnostic parser: `shiftedSpan` is
     * reachable only through this Less/SCSS/Jess form, and the only other
     * line-tracked sources here are CSS, which has no `~"…"` syntax. Parsing
     * this one without line tracking left `shiftedSpan`'s LINED arm at zero
     * executions across the whole corpus — the arm was rewritten by the same
     * commit that added this gate and was not covered by it.
     */
    entry('less:escaped-quoted', parseLessCst, '.e { filter: ~"progid:x"; }'),
    entry('less-diagnostic:escaped-quoted', parseLessDiagnosticCst, '.e {\n  filter: ~"progid:x";\n}')
  );
  return sources;
}

/**
 * NAMED signatures, never counts. "2 node shapes" cannot distinguish "still the
 * tags/no-tags pair" from "one arm gained a field and another lost one".
 *
 * node: the two `buildCssCstNode` arms — identical field-for-field except for
 * `tags`, in the same order. `emptyStyleSheet()` is a third construction site
 * and deliberately matches the no-tags arm exactly.
 *
 * span: the two families parseman realizes. Line/column tracking is a whole-parse
 * mode, so a span carries all four line/column fields or none. The bare
 * `[start,end]` signature also occurs WITHIN a diagnostic parse (some parseman
 * leaf tokens carry no line info), which is why both are listed rather than
 * partitioned by mode.
 */
const EXPECTED_NODE_SIGNATURES: readonly string[] = [
  '_tag,type,grammarType,span,state,rules,children',
  '_tag,type,grammarType,tags,span,state,rules,children'
];
const EXPECTED_LEAF_SIGNATURES: readonly string[] = ['_tag,value,span'];
const EXPECTED_SPAN_SIGNATURES: readonly string[] = [
  'start,end',
  'start,end,startLine,startColumn,endLine,endColumn'
];

describe('CST shape stability', () => {
  const shapes = collectCstShapes(corpus());

  if (process.env.SHAPE_DISCOVER === 'true') {
    it('reports the full CST signature inventory', () => {
      console.log(formatCstShapeReport(shapes));
      expect(shapes.node.size).toBeGreaterThan(0);
    });
    return;
  }

  it('builds every CST node with one of the two recorded arm signatures', () => {
    expect([...shapes.node.keys()].sort()).toEqual([...EXPECTED_NODE_SIGNATURES].sort());
  });

  it('builds every CST leaf with one signature', () => {
    expect([...shapes.leaf.keys()].sort()).toEqual([...EXPECTED_LEAF_SIGNATURES].sort());
  });

  it('builds every span in one of the two recorded families', () => {
    // The guard that `shiftedSpan`/`joinedSpan` cannot mint a span shape
    // matching NEITHER input family — the old `joinedSpan` could emit
    // `{start,end,endLine,endColumn}` by adding `second`'s line fields onto a
    // lineless `first`.
    expect([...shapes.span.keys()].sort()).toEqual([...EXPECTED_SPAN_SIGNATURES].sort());
  });

  it('parses the whole CST corpus without producing error nodes', () => {
    // An error node would mean a fixture stopped parsing, which silently shrinks
    // the surface every assertion above is drawn from.
    expect([...shapes.error.keys()]).toEqual([]);
  });

  it('draws every signature from a source that actually yielded a tree', () => {
    // NAMED per-source yield, not a total. A total is exactly what let
    // `jess-on-css` (ok:false, 1 node from 123KB) sit in the inventory looking
    // like coverage. Floors are deliberately loose — they catch "this source
    // collapsed to an empty stylesheet", not normal fixture churn.
    const failed = shapes.yields.filter(y => !y.ok || y.nodes < 10 || y.leaves < 5);
    expect(
      failed.map(y => `${y.label} (ok=${String(y.ok)} nodes=${y.nodes} leaves=${y.leaves})`).join('\n'),
      failed.length === 0
        ? undefined
        : 'CST corpus sources produced no usable tree — they contribute nothing to the '
          + `signature assertions above:\n${failed.map(y => `  ${y.label}: ok=${String(y.ok)} nodes=${y.nodes} leaves=${y.leaves}`).join('\n')}`
    ).toBe('');
  });
});
