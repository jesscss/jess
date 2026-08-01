#!/usr/bin/env node
/**
 * Measure the complexity of the four jess grammars from the SAME spec model the
 * railroad pages are drawn from (`parseman/spec` → `buildSpecModel`).
 *
 * The railroad diagrams are the instrument; this is the readout. Nothing here
 * changes a grammar, and nothing here is a gate — it prints numbers against a
 * stated line.
 *
 * ── COUNTING RULE (state it, so the numbers can be re-derived) ───────────────
 *
 * SYMBOLS (primary) — the things a reader perceives as distinct objects in the
 * diagram, i.e. the drawn BOXES:
 *
 *   terminal    +1   (a literal, a regex, or one word of a `keywords([…])` list —
 *                     `keywords` draws ONE box per word, so a 148-word list is 148)
 *   ref         +1   (a non-terminal box)
 *   annotation  +1   (`…` from scanTo, adjacency notes)
 *   seq choice star plus opt sepBy not peek   +0
 *
 * Sequence, alternation, repetition and optionality are drawn as LINES, loops and
 * bypasses, not as boxes, so they score zero here. `not`/`peek` are drawn as a
 * label attached to their inner box, so they add nothing of their own.
 *
 * SYMBOLS+OPS (secondary) — the same, plus +1 for every repetition or bypass a
 * reader has to trace: `star`, `plus`, `opt`, `sepBy`. Reported alongside because
 * a rule that is 20 boxes threaded through 15 loops does not read like a rule
 * that is 20 boxes in a row, and a single number would hide that.
 *
 * References are NOT expanded: a `ref` counts 1 regardless of how large the rule
 * it names is. That is what the diagram shows.
 *
 * ── ROWS (the decomposition metric) ─────────────────────────────────────────
 *
 * Rows are the alternatives stacked vertically in a rule's OWN diagram — what
 * makes you scan down instead of across. A `Stylesheet` that spells every at-rule
 * out inline is many rows; one that says `AtRule` is one row, and `AtRule` gets
 * its own readable diagram. So:
 *
 *   rows = 1
 *        + Σ over every `choice` node of (arms − 1)
 *        + 1 for each bypass the renderer draws (`opt`, `star`, and `sepBy`
 *          with min 0 — all of which draw a skip line above/below the item)
 *
 * A straight sequence is 1 row. A twelve-arm alternation is 12 rows.
 *
 * CRITICALLY, a named reference is a LEAF here: it is one row no matter how big
 * the rule it names. That is checked, not assumed — `buildSpecModel` emits
 * `{ kind: 'ref' }` for any combinator carrying a rule name and gives that rule
 * its own production, so the metric measures how the GRAMMAR was factored and
 * not how the emitter lays it out. There is no reference-expansion option to
 * disable; expansion simply does not happen.
 *
 * Over ~10 rows the finding is concrete: these alternatives want to be named
 * sub-rules.
 *
 * ── CHAINS (distinct paths) ─────────────────────────────────────────────────
 *
 * Unique routes from entry to exit of the rule's own diagram:
 *
 *   terminal | ref | annotation | not | peek   1
 *   seq                                        product of its children
 *   choice                                     sum of its children
 *   opt                                        1 + chains(item)
 *   star, sepBy(min 0)                         1 + chains(item)
 *   plus, sepBy(min >= 1)                      chains(item)
 *
 * Two deliberate truncations, both to keep the number finite and re-derivable:
 * a LOOP counts as one path, not one per iteration count, and a REFERENCE is not
 * expanded. So this counts paths through THIS diagram, which is what a reader
 * traces. Products still explode: anything at or over `CHAINS_UNBOUNDED` is
 * reported as unbounded rather than as a precise fiction.
 *
 * ── OTHER MEASURES ──────────────────────────────────────────────────────────
 *
 *   depth     max nesting of the spec tree (refs are leaves)
 *   maxArms   the largest single alternation in the rule
 *   glue      the rule's whole body is one ref, or an alternation of nothing but
 *             refs — it introduces no syntax of its own, it only names a choice
 *   px        the width x height the railroad renderer actually produces, read
 *             off the static SVG. Kept SEPARATE from symbol count on purpose:
 *             a big px with a small symbol count is an EMITTER layout problem,
 *             not a grammar problem.
 *
 * Usage: node scripts/analyze-grammar-complexity.mjs [--out <dir>] [--json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Stated reporting lines. Neither is a gate; nothing fails on them. */
const UNREADABLE_AT = 30;      // symbols
const TOO_MANY_ROWS = 10;      // stacked alternatives in the rule's own diagram
const CHAINS_UNBOUNDED = 1e6;  // above this, report "unbounded" rather than a fiction

const LOADER_HOOK = `
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
const strip = (context) => {
  const attrs = context && context.importAttributes
  if (!attrs || attrs.type !== 'macro') return context
  const rest = { ...attrs }
  delete rest.type
  return { ...context, importAttributes: rest }
}
export async function resolve(specifier, context, nextResolve) {
  const ctx = strip(context)
  if (specifier.startsWith('.') && specifier.endsWith('.js') && ctx.parentURL) {
    const url = new URL(specifier, ctx.parentURL)
    const ts = fileURLToPath(url).slice(0, -3) + '.ts'
    if (existsSync(ts)) return { url: pathToFileURL(ts).href, shortCircuit: true }
  }
  return nextResolve(specifier, ctx)
}
export async function load(url, context, nextLoad) {
  return nextLoad(url, strip(context))
}
`;

/** Same pins the diagram generator uses — without them `buildSpecModel` does not
 *  terminate on a rule containing `balanced()`. See generate-railroad-diagrams.mjs. */
const BALANCED_PINS = {
  css: { AtRulePreludeGroup: 'balanced ( … ) or [ … ]' },
  less: {
    AtRulePrelude: 'at-rule prelude text, with balanced ( … ) / [ … ] groups',
    OpaqueAtPrelude: 'opaque at-rule prelude text, with balanced ( … ) / [ … ] groups'
  },
  scss: { AtRootFilterPrelude: 'balanced ( … )' },
  jess: {}
};

const DIALECTS = [
  { id: 'css', title: 'CSS', pkg: 'packages/syntax/css/css-parser', exportName: 'cssGrammar' },
  { id: 'less', title: 'Less', pkg: 'packages/syntax/less/less-parser', exportName: 'lessGrammar' },
  { id: 'scss', title: 'SCSS', pkg: 'packages/syntax/scss/scss-parser', exportName: 'scssGrammar' },
  { id: 'jess', title: 'Jess', pkg: 'packages/syntax/jess/jess-parser', exportName: 'jessGrammar' }
];

const ENTRY = 'Stylesheet';

const BOXES = new Set(['terminal', 'ref', 'annotation']);
const OPS = new Set(['star', 'plus', 'opt', 'sepBy']);

function kids(n) {
  if (n.items) {
    return n.items;
  }
  const out = [];
  if (n.item) {
    out.push(n.item);
  }
  if (n.sep) {
    out.push(n.sep);
  }
  return out;
}

/** True when the renderer draws a skip line around the node (a bypass row). */
function drawsBypass(n) {
  return n.kind === 'opt' || n.kind === 'star' || (n.kind === 'sepBy' && n.min === 0);
}

function chainsOf(n, authored = false) {
  switch (n.kind) {
    case 'seq': {
      let p = 1;
      for (const k of n.items) {
        p *= chainsOf(k, authored);
        if (p >= CHAINS_UNBOUNDED) {
          return CHAINS_UNBOUNDED;
        }
      }
      return p;
    }
    case 'choice': {
      if (authored && isKeywordSet(n)) {
        return 1;
      }
      let s = 0;
      for (const k of n.items) {
        s += chainsOf(k, authored);
        if (s >= CHAINS_UNBOUNDED) {
          return CHAINS_UNBOUNDED;
        }
      }
      return s;
    }
    case 'opt': return Math.min(CHAINS_UNBOUNDED, 1 + chainsOf(n.item, authored));
    case 'star': return Math.min(CHAINS_UNBOUNDED, 1 + chainsOf(n.item, authored));
    case 'plus': return chainsOf(n.item, authored);
    case 'sepBy': {
      const inner = Math.min(CHAINS_UNBOUNDED, chainsOf(n.item, authored) * chainsOf(n.sep, authored));
      return n.min === 0 ? Math.min(CHAINS_UNBOUNDED, 1 + inner) : inner;
    }
    default: return 1;
  }
}

/**
 * A `choice` every arm of which is a plain literal — i.e. what the author wrote
 * as ONE conceptual token: `word('@import')` (which lowers to a single-arm
 * choice) or `keywords(['@page', '@scope', …])`.
 *
 * The emitter does not collapse these, so the diagram draws an alternation frame
 * around a lone `@import`, and an 18-word keyword set as 18 stacked boxes. The
 * "authored" counts below treat each such node as the one terminal it represents,
 * so the two numbers together separate emitter noise from grammar complexity.
 */
function isKeywordSet(n) {
  return n.kind === 'choice' && n.items.length > 0 && n.items.every(i => i.kind === 'terminal' && i.literal);
}

function measure(expr) {
  let symbols = 0, ops = 0, maxArms = 0, terminals = 0, refs = 0, rows = 1;
  let symbolsAuthored = 0, rowsAuthored = 1, keywordSets = 0, wordWrappers = 0;
  const refNames = new Set();
  const walk = (n, d, authored) => {
    let depth = d;
    if (BOXES.has(n.kind)) {
      symbols++;
      if (authored) {
        symbolsAuthored++;
      }
      if (n.kind === 'terminal') {
        terminals++;
      }
      if (n.kind === 'ref') {
        refs++;
        refNames.add(n.name);
      }
    }
    if (OPS.has(n.kind)) {
      ops++;
    }
    if (drawsBypass(n)) {
      rows += 1;
      if (authored) {
        rowsAuthored += 1;
      }
    }
    if (n.kind === 'choice') {
      maxArms = Math.max(maxArms, n.items.length);
      rows += n.items.length - 1;
      if (isKeywordSet(n)) {
        // Counts as the ONE terminal the author wrote.
        if (n.items.length === 1) {
          wordWrappers++;
        } else {
          keywordSets++;
        }
        if (authored) {
          symbolsAuthored++;
        }
        for (const k of n.items) {
          depth = Math.max(depth, walk(k, d + 1, false));
        }
        return depth;
      }
      if (authored) {
        rowsAuthored += n.items.length - 1;
      }
    }
    for (const k of kids(n)) {
      depth = Math.max(depth, walk(k, d + 1, authored));
    }
    return depth;
  };
  const depth = walk(expr, 1, true);
  const chains = chainsOf(expr);
  const chainsAuthored = chainsOf(expr, true);
  return {
    symbols, symbolsOps: symbols + ops, ops, depth, maxArms, terminals, refs, refNames,
    rows, chains, chainsUnbounded: chains >= CHAINS_UNBOUNDED,
    symbolsAuthored, rowsAuthored, chainsAuthored, keywordSets, wordWrappers
  };
}

/** A rule that introduces no syntax of its own — one ref, or an alternation of
 *  nothing but refs. Pure naming/dispatch glue. */
function isGlue(expr) {
  if (expr.kind === 'ref') {
    return true;
  }
  if (expr.kind === 'choice') {
    return expr.items.every(i => i.kind === 'ref');
  }
  return false;
}

function svgDims(svg) {
  const w = /width="(\d+)"/.exec(svg);
  const h = /height="(\d+)"/.exec(svg);
  return { w: w ? +w[1] : 0, h: h ? +h[1] : 0 };
}

function quantiles(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const at = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { min: s[0], p50: at(0.5), p75: at(0.75), p90: at(0.9), p99: at(0.99), max: s[s.length - 1] };
}

async function collect() {
  register(`data:text/javascript,${encodeURIComponent(LOADER_HOOK)}`);
  const out = [];
  for (const d of DIALECTS) {
    const spec = await import(pathToFileURL(join(ROOT, d.pkg, 'node_modules/parseman/dist/spec/index.js')).href);
    const mod = await import(pathToFileURL(join(ROOT, d.pkg, 'src/grammar.ts')).href);
    const opts = { includeTrivia: true, terminals: BALANCED_PINS[d.id] };
    const model = spec.buildSpecModel(mod[d.exportName], opts);
    const svgByName = new Map(spec.toRailroadSvg(mod[d.exportName], opts).map(x => [x.name, x.svg]));
    const rules = model.productions.map((p) => {
      const m = measure(p.expr);
      const px = svgDims(svgByName.get(p.name) ?? '');
      return { name: p.name, ...m, refNames: [...m.refNames], glue: isGlue(p.expr), w: px.w, h: px.h };
    });
    out.push({ ...d, rules });
  }
  return out;
}

function summarise(d) {
  const rs = d.rules;
  const over = rs.filter(r => r.symbols > UNREADABLE_AT);
  return {
    id: d.id, title: d.title,
    count: rs.length,
    over: over.length,
    overPct: +(over.length / rs.length * 100).toFixed(1),
    overRows: rs.filter(r => r.rows > TOO_MANY_ROWS).length,
    overBoth: rs.filter(r => r.symbols > UNREADABLE_AT && r.rows > TOO_MANY_ROWS).length,
    unbounded: rs.filter(r => r.chainsUnbounded).length,
    glue: rs.filter(r => r.glue).length,
    overAuthored: rs.filter(r => r.symbolsAuthored > UNREADABLE_AT).length,
    overRowsAuthored: rs.filter(r => r.rowsAuthored > TOO_MANY_ROWS).length,
    wordWrappers: rs.reduce((a, r) => a + r.wordWrappers, 0),
    keywordSets: rs.reduce((a, r) => a + r.keywordSets, 0),
    symbols: quantiles(rs.map(r => r.symbols)),
    symbolsAuthored: quantiles(rs.map(r => r.symbolsAuthored)),
    symbolsOps: quantiles(rs.map(r => r.symbolsOps)),
    rows: quantiles(rs.map(r => r.rows)),
    rowsAuthored: quantiles(rs.map(r => r.rowsAuthored)),
    chains: quantiles(rs.map(r => r.chains)),
    depth: quantiles(rs.map(r => r.depth)),
    maxArms: quantiles(rs.map(r => r.maxArms)),
    totalSymbols: rs.reduce((a, r) => a + r.symbols, 0),
    top: [...rs].sort((a, b) => b.symbols - a.symbols).slice(0, 10),
    topAuthored: [...rs].sort((a, b) => b.symbolsAuthored - a.symbolsAuthored).slice(0, 10),
    topRows: [...rs].sort((a, b) => b.rows - a.rows).slice(0, 10),
    topChains: [...rs].sort((a, b) => b.chains - a.chains).slice(0, 10),

    /* Wide but small: the emitter laying a modest rule across a huge row. */
    emitterWide: [...rs].filter(r => r.w > 1600 && r.symbols <= UNREADABLE_AT).sort((a, b) => b.w - a.w).slice(0, 5)
  };
}

function fmtChains(r) {
  return r.chainsUnbounded ? 'unbounded' : String(r.chains);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function page(summaries, shared) {
  const q = o => `${o.min} / ${o.p50} / ${o.p75} / ${o.p90} / ${o.p99} / ${o.max}`;
  const overview = summaries.map(s => `<tr>
    <td><a href="./${s.id}.html">${esc(s.title)}</a></td>
    <td class="n">${s.count}</td>
    <td class="n ${s.overPct > 15 ? 'bad' : ''}">${s.over} (${s.overPct}%)</td>
    <td class="n ${s.overRows / s.count > 0.15 ? 'bad' : ''}">${s.overRows}</td>
    <td class="n">${s.overBoth}</td>
    <td class="n">${s.unbounded}</td>
    <td class="n">${s.glue}</td>
    <td class="q">${q(s.symbolsAuthored)}</td>
    <td class="q">${q(s.rows)}</td>
    <td class="q">${q(s.chains)}</td>
  </tr>`).join('\n');

  const ruleRow = r => `<tr>
      <td><code>${esc(r.name)}</code></td>
      <td class="n ${r.symbols > UNREADABLE_AT ? 'bad' : ''}">${r.symbols}</td>
      <td class="n ${r.symbolsAuthored > UNREADABLE_AT ? 'bad' : ''}">${r.symbolsAuthored}</td>
      <td class="n ${r.rows > TOO_MANY_ROWS ? 'bad' : ''}">${r.rows}</td>
      <td class="n">${fmtChains(r)}</td>
      <td class="n">${r.depth}</td>
      <td class="n">${r.maxArms}</td>
      <td class="n">${r.w}&times;${r.h}</td>
    </tr>`;
  const head = `<thead><tr><th>rule</th><th class="n">symbols<br>rendered</th><th class="n">symbols<br>authored</th><th class="n">rows</th><th class="n">chains</th><th class="n">depth</th><th class="n">max arms</th><th class="n">rendered px</th></tr></thead>`;

  const tops = summaries.map(s => `<h3>${esc(s.title)}</h3>
  <p class="note">Worst ten by <strong>symbols as rendered</strong> (wide):</p>
  <table>${head}<tbody>
${s.top.map(ruleRow).join('\n')}
  </tbody></table>
  <p class="note">Worst ten by <strong>symbols as authored</strong> — each
  <code>word()</code> / <code>keywords([…])</code> counted as the one terminal it
  represents. Where this ranking differs from the one above, this is the one that
  answers "is the grammar complex", and the one above is measuring the emitter.</p>
  <table>${head}<tbody>
${s.topAuthored.map(ruleRow).join('\n')}
  </tbody></table>
  <p class="note">Worst ten by <strong>rows</strong> (deep — alternatives stacked inline instead of named):</p>
  <table>${head}<tbody>
${s.topRows.map(ruleRow).join('\n')}
  </tbody></table>
  <p class="note">Worst ten by <strong>chains</strong> (branchy):</p>
  <table>${head}<tbody>
${s.topChains.map(ruleRow).join('\n')}
  </tbody></table>
  ${s.emitterWide.length === 0 ? '' : `<p class="note"><strong>Emitter, not grammar:</strong> ${s.emitterWide.map(r => `<code>${esc(r.name)}</code> (${r.symbols} symbols, ${r.w}px wide)`).join(', ')} — modest rules the renderer lays out in one very wide row. That is a parseman layout issue, not a complaint about these rules.</p>`}`).join('\n');

  const sharedRows = shared.map(r => `<tr>
    <td><code>${esc(r.name)}</code></td>
    ${['css', 'less', 'scss', 'jess'].map(id => `<td class="n ${r[id] === undefined ? 'absent' : r[id].symbols > UNREADABLE_AT ? 'bad' : ''}">${r[id] === undefined ? '—' : `${r[id].symbols} / ${r[id].rows}`}</td>`).join('')}
    <td class="n">${r.growth > 0 ? '+' : ''}${r.growth}</td>
    <td class="n">${r.rowGrowth > 0 ? '+' : ''}${r.rowGrowth}</td>
  </tr>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>jess grammar complexity</title>
<style>
  body { font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 62rem; margin: 3rem auto; padding: 0 1.25rem; color: #1b1b1b; }
  h1 { font-size: 1.6rem } h2 { font-size: 1.15rem; margin-top: 2.5rem } h3 { font-size: 1rem; margin-top: 1.8rem }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px }
  table { border-collapse: collapse; width: 100%; margin: 0.8rem 0; font-size: 0.92em; display: block; overflow-x: auto }
  th, td { border-bottom: 1px solid #e3e3e3; padding: 0.35rem 0.55rem; text-align: left; white-space: nowrap }
  th { font-weight: 600; color: #444 }
  .n { text-align: right; font-variant-numeric: tabular-nums }
  .q { font-variant-numeric: tabular-nums; color: #444 }
  .bad { color: #b3261e; font-weight: 600 }
  .absent { color: #aaa }
  .note { color: #555; font-size: 0.92em }
  a { color: #0a58ca }
  @media (prefers-color-scheme: dark) {
    body { background: #16181c; color: #e6e6e6 }
    code { background: #262a30 } th, td { border-color: #2e333a } th, .q { color: #b9b9b9 }
    .bad { color: #ff8a80 } .absent { color: #666 } .note { color: #a8a8a8 } a { color: #7fb2ff }
  }
</style>
</head>
<body>
<h1>jess grammar complexity</h1>
<p>Measured from the same spec model the <a href="./index.html">railroad pages</a>
are drawn from, so these numbers and those diagrams cannot disagree. Regenerate
with <code>node scripts/analyze-grammar-complexity.mjs</code>.</p>

<h2>The rendering is deliberately not optimised</h2>
<p>Nothing here smooths, collapses or prettifies a diagram. Every rule the
grammar defines is emitted, trivia rules included, in declaration order, and a
monster rule is left looking like a monster. The only rendering option used is
readable names for common terminals (<code>IDENT</code> instead of a 200-character
character class), which changes how faithfully you can read the shape, not what
the shape is. The one exception is forced: three rules must be pinned as opaque
terminals or the emitter does not terminate at all — see the
<a href="./index.html">index</a>.</p>

<h2>How a symbol is counted</h2>
<p><strong>Symbols</strong> are the boxes a reader sees: one per terminal, one per
non-terminal reference, one per annotation. One word of a
<code>keywords([…])</code> list is one box, so a 148-word list counts 148.
Sequence, alternation, repetition and optionality are drawn as lines, loops and
bypasses rather than boxes, so they count zero.
<strong>+ops</strong> adds one for each repetition or bypass
(<code>*</code>, <code>+</code>, <code>?</code>, <code>sepBy</code>) a reader has
to trace. References are not expanded — a reference counts one however big the
rule it names.</p>
<h2>How a row is counted</h2>
<p><strong>Rows</strong> are the alternatives stacked vertically in a rule's own
diagram — the thing that makes you scan down rather than across. One row for the
rule, plus (arms − 1) for every alternation, plus one for every bypass line
(<code>?</code>, <code>*</code>, a <code>sepBy</code> that admits zero items). A
straight sequence is 1 row; a twelve-arm alternation is 12.</p>
<p><strong>A named reference is one row, however big the rule it names.</strong>
That is the whole point of the metric, and it is a property of the model rather
than a setting: <code>buildSpecModel</code> emits a reference as a leaf and gives
the referenced rule its own production. There is no reference-expansion option to
turn off. So a high row count means the grammar spelled those alternatives out
inline instead of naming them.</p>

<h2>How a chain is counted</h2>
<p><strong>Chains</strong> are distinct routes from entry to exit of this
diagram: a sequence multiplies its children, an alternation sums them, an
optional or a repetition adds one bypass path. Two truncations keep the number
finite and re-derivable — a loop counts as one path rather than one per iteration
count, and a reference is not expanded. Products still explode; anything at or
over ${CHAINS_UNBOUNDED.toLocaleString('en-US')} is reported as
<em>unbounded</em> rather than as a precise fiction.</p>

<h2>The three lines</h2>
<p><strong>&gt;${UNREADABLE_AT} symbols</strong> — too wide.
<strong>&gt;${TOO_MANY_ROWS} rows</strong> — too deep; alternatives that want
names. <strong>Chains</strong> — branchiness, reported rather than thresholded.
They fail differently and a rule can be bad at exactly one; the rules over the
line on two of them are the ones worth naming loudest. Being under every line is
not a certificate: depth, loop count, and the emitter can each ruin a small
rule.</p>

<h2>Per dialect</h2>
<table>
  <thead><tr>
    <th>dialect</th><th class="n">rules</th><th class="n">&gt;${UNREADABLE_AT} sym</th>
    <th class="n">&gt;${TOO_MANY_ROWS} rows</th><th class="n">both</th>
    <th class="n">unbounded chains</th><th class="n">glue rules</th>
    <th>symbols (authored) min/p50/p75/p90/p99/max</th><th>rows</th><th>chains</th>
  </tr></thead>
  <tbody>
${overview}
  </tbody>
</table>
<p class="note"><em>glue rules</em> are rules whose entire body is one reference, or
an alternation of nothing but references — they name a choice without introducing
any syntax of their own.</p>

<h2>Worst offenders</h2>
${tops}

<h2>The same rule across dialects</h2>
<p>Rules that exist by the same name in more than one dialect, ordered by how much
the symbol count grows from its smallest dialect to its largest. This is the
direct read on whether a dialect inherits CSS's shape or re-spells it bigger.</p>
<table>
  <thead><tr><th>rule</th><th class="n">css<br>sym/rows</th><th class="n">less<br>sym/rows</th><th class="n">scss<br>sym/rows</th><th class="n">jess<br>sym/rows</th><th class="n">sym spread</th><th class="n">row spread</th></tr></thead>
  <tbody>
${sharedRows}
  </tbody>
</table>
</body>
</html>
`;
}

async function main() {
  const outArg = process.argv.indexOf('--out');
  const outDir = outArg !== -1 ? resolve(process.argv[outArg + 1]) : join(ROOT, 'docs/grammar/railroad');
  mkdirSync(outDir, { recursive: true });

  const data = await collect();
  const summaries = data.map(summarise);

  const IDS = ['css', 'less', 'scss', 'jess'];
  const byName = new Map();
  for (const d of data) {
    for (const r of d.rules) {
      if (!byName.has(r.name)) {
        byName.set(r.name, { name: r.name });
      }
      byName.get(r.name)[d.id] = { symbols: r.symbolsAuthored, rows: r.rows, chains: r.chains };
    }
  }
  const shared = [...byName.values()]
    .filter(r => IDS.filter(id => r[id] !== undefined).length > 1)
    .map((r) => {
      const present = IDS.map(id => r[id]).filter(v => v !== undefined);
      return {
        ...r,
        growth: Math.max(...present.map(v => v.symbols)) - Math.min(...present.map(v => v.symbols)),
        rowGrowth: Math.max(...present.map(v => v.rows)) - Math.min(...present.map(v => v.rows))
      };
    })
    .sort((a, b) => (b.growth + b.rowGrowth) - (a.growth + a.rowGrowth));

  const fmtQ = o => Object.values(o).join(' / ');
  for (const s of summaries) {
    console.log(`\n=== ${s.title}: ${s.count} rules`);
    console.log(`  over ${UNREADABLE_AT} symbols : ${s.over} rendered / ${s.overAuthored} authored`);
    console.log(`  over ${TOO_MANY_ROWS} rows    : ${s.overRows}   (over BOTH lines: ${s.overBoth})`);
    console.log(`  unbounded chains: ${s.unbounded}   glue rules: ${s.glue}`);
    console.log(`  word() 1-arm wrappers: ${s.wordWrappers}   keywords([…]) sets: ${s.keywordSets}`);
    console.log(`  symbols rendered  min/p50/p75/p90/p99/max = ${fmtQ(s.symbols)}`);
    console.log(`  symbols authored                          = ${fmtQ(s.symbolsAuthored)}`);
    console.log(`  rows                                      = ${fmtQ(s.rows)}`);
    console.log(`  chains                                    = ${fmtQ(s.chains)}`);
    console.log(`  depth                                     = ${fmtQ(s.depth)}`);
    const line = r => `${String(r.symbols).padStart(4)}/${String(r.symbolsAuthored).padStart(4)} sym  ${String(r.rows).padStart(4)} rows  ${fmtChains(r).padStart(10)} chains  d${String(r.depth).padStart(2)}  ${String(r.w).padStart(5)}x${String(r.h).padStart(5)}px  ${r.name}`;
    console.log('  -- worst ten by symbols (rendered/authored):');
    for (const r of s.top) {
      console.log(`     ${line(r)}`);
    }
    console.log('  -- worst ten by symbols AUTHORED:');
    for (const r of s.topAuthored) {
      console.log(`     ${line(r)}`);
    }
    console.log('  -- worst ten by ROWS:');
    for (const r of s.topRows) {
      console.log(`     ${line(r)}`);
    }
    console.log('  -- worst ten by CHAINS:');
    for (const r of s.topChains) {
      console.log(`     ${line(r)}`);
    }
    if (s.emitterWide.length) {
      console.log('  -- wide but small (EMITTER layout, not grammar):');
      for (const r of s.emitterWide) {
        console.log(`     ${String(r.symbols).padStart(4)} sym  ${String(r.w).padStart(5)}px wide  ${r.name}`);
      }
    }
  }

  console.log(`\n=== Shared rules, biggest growth across dialects (authored symbols / rows):`);
  for (const r of shared.slice(0, 25)) {
    const cell = id => r[id] === undefined ? '   -' : `${String(r[id].symbols).padStart(3)}/${String(r[id].rows).padStart(2)}`;
    console.log(`  +${String(r.growth).padStart(4)}sym +${String(r.rowGrowth).padStart(3)}row  css=${cell('css')} less=${cell('less')} scss=${cell('scss')} jess=${cell('jess')}  ${r.name}`);
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ summaries, shared }, null, 2));
  }

  const file = join(outDir, 'complexity.html');
  const html = page(summaries, shared.slice(0, 60));
  writeFileSync(file, html);
  console.log(`\nwrote ${file} (${Buffer.byteLength(html)} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
