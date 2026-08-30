#!/usr/bin/env node
/**
 * Generate railroad (syntax) diagrams for the four jess grammars.
 *
 * The diagrams come from `parseman/spec`, which walks the SAME combinator tree
 * (`_def`) the interpreter and macro compiler consume — so the pages cannot
 * drift from what actually parses. Output is self-contained: the railroad
 * library and its CSS are inlined by parseman, and the index page written here
 * has no external reference either.
 *
 * Usage: node scripts/generate-railroad-diagrams.mjs [--out <dir>]
 *
 * Requires the workspace to be built (`pnpm run build:release`) — the grammar
 * modules import `@jesscss/parser-shared/lib/*`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Two loader concerns, both needed to import a grammar module directly:
 *
 * 1. `type: 'macro'` import attributes. Node rejects an attribute it does not
 *    know, so every macro-authored grammar dies on import. Dropping the
 *    attribute degrades the macro import to a plain runtime import, which is
 *    what the spec walker needs (real combinators, not compiled functions).
 *    This mirrors what parseman's own diagnostics CLI does. Only
 *    `type: 'macro'` is dropped; `type: 'json'` still means what it means.
 * 2. `.js` specifiers that name a `.ts` source. Node's native type stripping
 *    does not rewrite extensions, so `import … from './parse-error.js'` inside
 *    `src/` fails. Resolve to the sibling `.ts` when it exists on disk.
 */
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

/**
 * `balanced()` builds an interior whose own `self` reference points back at it,
 * and that reference carries no `_ruleName`. `buildSpecModel` cuts cycles ONLY
 * at named rules, so every rule that reaches a `balanced()` recurses until the
 * stack dies (`RangeError`, then SIGSEGV at `--stack-size=40000` — it is a true
 * cycle, not merely deep). See docs/grammar/railroad/index.html for the writeup.
 *
 * Each rule below is the MINIMAL one that directly contains a `balanced()` —
 * verified by re-running `buildSpecModel` per rule with every other failing rule
 * pinned. Pinning them to a prose terminal is the only lever `parseman/spec`
 * offers, and it costs real structure in the two Less rules, which are segment
 * lists rather than pure delimiter scans.
 */
const BALANCED_PINS = {
  css: { AtRulePreludeGroup: 'balanced ( … ) or [ … ]' },
  less: {
    AtRulePrelude: 'at-rule prelude text, with balanced ( … ) / [ … ] groups',
    OpaqueAtPrelude: 'opaque at-rule prelude text, with balanced ( … ) / [ … ] groups'
  },
  scss: { AtRootFilterPrelude: 'balanced ( … )' },
  jess: {}
};

/**
 * Deliberately EMPTY.
 *
 * Nothing is pinned for looks. These pages are read as an instrument: a rule that
 * renders as an unreadable ladder is telling you something about the rule, and
 * hiding it behind a prose name would destroy the measurement. `NamedColorToken`
 * — a `keywords([…])` of 148 CSS colour names that draws a 4,500-pixel vertical
 * alternation on the Less page, and exists in NO other dialect — is exactly the
 * kind of thing that must stay visible. See scripts/analyze-grammar-complexity.mjs.
 *
 * The `BALANCED_PINS` above are not an exception to this: without them the
 * emitter does not produce a page at all.
 */
const LEGIBILITY_PINS = {
  css: {},
  less: {},
  scss: {},
  jess: {}
};

const DIALECTS = [
  { id: 'css', title: 'CSS', pkg: 'packages/syntax/css/css-parser', exportName: 'cssGrammar' },
  { id: 'less', title: 'Less', pkg: 'packages/syntax/less/less-parser', exportName: 'lessGrammar' },
  { id: 'scss', title: 'SCSS', pkg: 'packages/syntax/scss/scss-parser', exportName: 'scssGrammar' },
  { id: 'jess', title: 'Jess', pkg: 'packages/syntax/jess/jess-parser', exportName: 'jessGrammar' }
];

/** Every dialect's parser enters at `Stylesheet` (see each `src/parse-with.ts`). */
const ENTRY = 'Stylesheet';

/**
 * Readable names for the terminals the four grammars share.
 *
 * Without this the diagram boxes read as raw regex source, and the CSS-family
 * character classes are long enough to dominate a whole row. Only patterns whose
 * meaning is unambiguous are renamed; anything else keeps its literal source,
 * because a spec that shows a pattern which is not the pattern is worse than an
 * ugly one. Keyed by exact source so a grammar edit cannot silently inherit a
 * wrong name.
 */
const TERMINAL_NAMES = new Map(Object.entries({
  '[ \\t\\n\\r\\f]+': 'WHITESPACE',
  '[ \\t\\n\\r\\f]*': 'WHITESPACE?',
  '(?:[ \\t\\n\\r\\f]+|\\/\\*(?:[^*]|\\*(?!\\/))*\\*\\/)+': 'WHITESPACE or COMMENT',
  '(?:[ \\t\\n\\r\\f]|\\/\\*(?:[^*]|\\*(?!\\/))*\\*\\/)+': 'WHITESPACE or COMMENT',
  '(?:[ \\t\\n\\r\\f]+|\\/\\*(?:[^*]|\\*(?!\\/))*\\*\\/|\\/\\/[^\\n\\r]*)+': 'WHITESPACE or COMMENT (incl. //)',
  '[ \\t\\n\\r\\f]*(?:\\/\\*(?:[^*]|\\*(?!\\/))*\\*\\/[ \\t\\n\\r\\f]*)*': 'WHITESPACE or COMMENT?',
  '(?:\\/\\*(?:[^*]|\\*(?!\\/))*\\*\\/)*[ \\t\\n\\r\\f]+(?:\\/\\*(?:[^*]|\\*(?!\\/))*\\*\\/[ \\t\\n\\r\\f]*)*': 'WHITESPACE or COMMENT',
  '\\/\\*(?:[^*]|\\*(?!\\/))*\\*\\/': 'COMMENT',
  '-?[_a-zA-Z\\u0080-\\uffff][-_a-zA-Z0-9\\u0080-\\uffff]*': 'IDENT',
  '[_a-zA-Z\\u0080-\\uffff][-_a-zA-Z0-9\\u0080-\\uffff]*': 'IDENT (no leading -)',
  '-?[_a-zA-Z\\u0080-\\uffff][-_a-zA-Z0-9\\u0080-\\uffff]*(?![-_a-zA-Z0-9\\u0080-\\uffff\\\\])': 'IDENT',
  '-?(?:[_a-zA-Z\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))(?:[-_a-zA-Z0-9\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))*': 'IDENT (escapes allowed)',
  '(?:[-_a-zA-Z0-9\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))+': 'NAME (escapes allowed)',
  '[-_a-zA-Z0-9\\u0080-\\uffff]+': 'NAME',
  '[0-9][-_a-zA-Z0-9\\u0080-\\uffff]*': 'NAME (digit-led)',
  '&[-_a-zA-Z0-9\\u0080-\\uffff]*': '& NAME?',
  '::?(?![ \\t\\n\\r\\f])': '":" or "::"',
  '[+-]?(?:\\d*\\.\\d+(?:[eE][+-]?\\d+)?|\\d+(?:[eE][+-]?\\d+)?|\\d+)': 'NUMBER',
  '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])': 'HEX COLOR',
  '[Uu]\\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?': 'UNICODE RANGE',
  'even|odd|[-+]?\\d*n(?:[ \\t\\n\\r\\f]*[+-][ \\t\\n\\r\\f]*\\d+)?|[-+]?\\d+': 'NTH',
  '--(?:[-_a-zA-Z0-9\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))+': 'CUSTOM PROPERTY NAME',
  '\'(?:[^\'\\n\\\\]|\\\\.)*\'': 'SINGLE-QUOTED STRING',
  '"(?:[^"\\n\\\\]|\\\\.)*"': 'DOUBLE-QUOTED STRING',
  '(?:[^"\\\\]|\\\\[\\s\\S])*': 'DOUBLE-QUOTED BODY',
  '(?:[^\'\\\\]|\\\\[\\s\\S])*': 'SINGLE-QUOTED BODY',
  '\\\\[^\\n\\r\\f]': 'ESCAPE',
  '@(?:-[a-z]+-)?keyframes(?![-_a-zA-Z0-9\\u0080-\\uFFFF])': '@keyframes (vendor-prefixable)',
  'not(?![-_a-zA-Z0-9\\u0080-\\uffff])': '"not"',
  'and(?![-_a-zA-Z0-9\\u0080-\\uffff])': '"and"',
  'or(?![-_a-zA-Z0-9\\u0080-\\uffff])': '"or"',
  'nth-(?:last-)?(?:child|of-type)(?![-_a-zA-Z0-9\\u0080-\\uFFFF])': 'nth-child / nth-last-child / nth-of-type / nth-last-of-type',
  '(?:[^()\\[\\]\'"@/]|@(?![@{_a-zA-Z\\u0080-\\uffff-])|\\/(?!\\*))+': 'PSEUDO-ARGUMENT TEXT',
  '(?:[.#]?-?(?:[_a-zA-Z\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))(?:[-_a-zA-Z0-9\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))*|\\*)': 'SIMPLE SELECTOR (type / .class / #id / *)',
  '[.#]-?(?:[_a-zA-Z\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))(?:[-_a-zA-Z0-9\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))*': 'CLASS or ID SELECTOR',
  '@-?(?:[_a-zA-Z\\u0080-\\uFFFF]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))(?:[-_a-zA-Z0-9\\u0080-\\uFFFF]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))*': 'AT-KEYWORD',
  '(?:[^()\\[\\]\'"#\\/]|#(?!\\{)|\\/(?!\\*))+': 'PSEUDO-ARGUMENT TEXT',
  '[.#]?-?[_a-zA-Z\\u0080-\\uffff][-_a-zA-Z0-9\\u0080-\\uffff]*': 'SIMPLE SELECTOR (type / .class / #id)',
  '(?:[-+]?\\d*\\.\\d|[-+]?\\d*n(?:[ \\t\\n\\r\\f]*[+-][ \\t\\n\\r\\f]*(?:\\)|[^0-9 \\t\\n\\r\\f]|\\d+[_a-zA-Z\\u0080-\\uffff\\\\]))|[+-][ \\t\\n\\r\\f]+(?:\\d*n|n)|[-+]?\\d+[ \\t\\n\\r\\f]+n|[-+]?\\d+[ \\t\\n\\r\\f]*[+-][ \\t\\n\\r\\f]*n)': 'MALFORMED NTH ARGUMENT',
  '(?:[.#]?-?(?:[_a-zA-Z\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))(?:[-_a-zA-Z0-9\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))*|\\d+(?:\\.\\d+)?%|\\*)': 'SIMPLE SELECTOR or PERCENTAGE',
  '(?:[.#]?-?(?:[_a-zA-Z\\u0080-\\uFFFF]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))(?:[-_a-zA-Z0-9\\u0080-\\uFFFF]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))*|\\d+(?:\\.\\d+)?%|\\*)': 'SIMPLE SELECTOR or PERCENTAGE',
  '(?!(?:calc|url|var)(?=\\())-?(?:[_a-zA-Z\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))(?:[-_a-zA-Z0-9\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))*': 'IDENT (not a calc/url/var call)',
  '[.#](?:-?(?:[_a-zA-Z\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))(?:[-_a-zA-Z0-9\\u0080-\\uffff]|\\\\(?:[0-9a-fA-F]{1,6}[ \\t\\n\\r\\f]?|[^\\n\\r\\f]))*)?': 'CLASS or ID SELECTOR (name optional)'
}));

function regexDisplay(source) {
  return TERMINAL_NAMES.get(source);
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function indexPage(results) {
  const rows = results.map(r => `      <li>
        <a href="./${r.id}.html"><strong>${esc(r.title)}</strong></a>
        — ${r.rules} productions, entry rule <code>Stylesheet</code>
        ${r.balancedPins.length === 0 ? '' : `<br><span class="note">pinned around <code>balanced()</code>: ${r.balancedPins.map(p => `<code>${esc(p)}</code>`).join(', ')}</span>`}
        ${r.legibilityPins.length === 0 ? '' : `<br><span class="note">pinned for legibility: ${r.legibilityPins.map(p => `<code>${esc(p)}</code>`).join(', ')}</span>`}
      </li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>jess grammar railroad diagrams</title>
<style>
  body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem; color: #1b1b1b; }
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.1rem; margin-top: 2.5rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px; }
  ul { padding-left: 1.2rem; }
  li { margin: 0.9rem 0; }
  .note { color: #555; font-size: 0.9em; }
  a { color: #0a58ca; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181c; color: #e6e6e6; }
    code { background: #262a30; }
    .note { color: #a8a8a8; }
    a { color: #7fb2ff; }
  }
</style>
</head>
<body>
<h1>jess grammar railroad diagrams</h1>
<p>One page per dialect. Each is a standalone HTML file — the diagram library and
its CSS are inlined, so nothing is fetched when you open it. The numbers behind
these pages are on the <a href="./complexity.html">complexity page</a>.</p>
<p>The diagrams are generated by <code>parseman/spec</code> from the same
<code>rules()</code> grammar that parses, by walking its combinator tree. They
cannot drift from what actually parses. Regenerate with
<code>node scripts/generate-railroad-diagrams.mjs</code>.</p>
<ul>
${rows}
</ul>

<h2>The rendering is deliberately not optimised</h2>
<p>These pages are an instrument. A rule that renders as an unreadable ladder is
telling you something about the rule, so nothing here smooths, collapses,
re-wraps or prettifies a diagram to make it fit. Every rule the grammar defines
is emitted — no reachability pruning — trivia rules included, in declaration
order, and a monster is left looking like a monster.</p>
<p>The one rendering option in use is readable names for common terminals
(<code>IDENT</code> rather than a 200-character character class). That changes how
faithfully you can read the shape, not what the shape is. The
<code>balanced()</code> pins below are the single exception, and they are forced:
without them the emitter does not produce a page at all.</p>

<h2>How to read a page</h2>
<p>Productions are in declaration order; the entry rule for every dialect is
<code>Stylesheet</code> (see each package's <code>src/parse-with.ts</code>). A box
is a terminal or a reference to another rule; a reference is a link, so a rule
whose diagram spells a construct out instead of linking to it has inlined that
construct.</p>

<h2>Known limitation: <code>balanced()</code></h2>
<p><code>buildSpecModel</code> cuts reference cycles only at NAMED rules.
<code>balanced(open, close)</code> deliberately keeps its own identity — its
interior holds a self-reference — and that reference carries no rule name, so the
walker recurses until the stack dies. Every rule listed above as pinned is a rule
that directly contains a <code>balanced()</code>; pinning it to a prose terminal
is the only lever the emitter offers. For CSS and SCSS the pinned rule <em>is</em>
a delimiter scan, so nothing is lost. For the two Less rules it costs real
structure: they are segment lists (whitespace / comma / group / quoted / text)
and the page now shows only the summary.</p>

<h2>Known limitation: <code>word()</code> and <code>keywords()</code></h2>
<p><code>word('@import')</code> lowers to a single-alternative <code>choice</code>,
and neither the spec model nor the renderer collapses it — so a lone
<code>@import</code> is drawn inside an alternation frame, and the EBNF shows
<code>("@import")</code>. That is the emitter presenting a combinator below the
abstraction it was authored at. It is a <strong>parseman</strong> issue, not a
grammar one, and it does not inflate the counts on the
<a href="./complexity.html">complexity page</a>: a one-arm choice adds no box, no
row and no path.</p>

<h2>Terminals</h2>
<p>Common CSS-family patterns are given readable names (<code>IDENT</code>,
<code>NUMBER</code>, <code>WHITESPACE or COMMENT</code>, …). Anything not on that
curated list keeps its literal regex source: a spec that shows a pattern which is
not the pattern would be worse than an ugly one. The remaining raw patterns are
what makes a handful of diagrams wide; each diagram scrolls inside its own box,
so the page itself never scrolls sideways.</p>
</body>
</html>
`;
}

async function main() {
  const outArg = process.argv.indexOf('--out');
  const outDir = outArg !== -1 ? resolve(process.argv[outArg + 1]) : join(ROOT, 'docs/grammar/railroad');
  mkdirSync(outDir, { recursive: true });

  register(`data:text/javascript,${encodeURIComponent(LOADER_HOOK)}`);

  const results = [];
  for (const d of DIALECTS) {
    const spec = await import(pathToFileURL(join(ROOT, d.pkg, 'node_modules/parseman/dist/spec/index.js')).href);
    const mod = await import(pathToFileURL(join(ROOT, d.pkg, 'src/grammar.ts')).href);
    const grammar = mod[d.exportName];
    if (!grammar) {
      throw new Error(`${d.pkg}/src/grammar.ts has no export ${d.exportName}`);
    }

    const terminals = { ...BALANCED_PINS[d.id], ...LEGIBILITY_PINS[d.id] };

    /*
     * Faithful by construction. No `root` (every rule the grammar defines is
     * emitted, not just the reachable closure), `includeTrivia: true` (trivia
     * rules are part of what parses, so hiding them would misrepresent the
     * grammar), declaration order, and no collapsing of anything. The only
     * option that touches presentation is `regexDisplay`, which names common
     * terminals — that changes how faithfully a reader can read the shape, not
     * what the shape is.
     */
    const opts = {
      title: `${d.title} grammar`,
      includeTrivia: true,
      regexDisplay,
      terminals,
      showEbnf: true
    };
    const html = spec.toRailroadHtml(grammar, opts);
    const model = spec.buildSpecModel(grammar, opts);
    const file = join(outDir, `${d.id}.html`);
    writeFileSync(file, html);
    results.push({
      id: d.id, title: d.title, file,
      bytes: Buffer.byteLength(html),
      rules: model.productions.length,
      balancedPins: Object.keys(BALANCED_PINS[d.id]),
      legibilityPins: Object.keys(LEGIBILITY_PINS[d.id])
    });
    console.log(`${d.id.padEnd(5)} ${String(model.productions.length).padStart(4)} productions  ${String(Buffer.byteLength(html)).padStart(9)} bytes  ${file}`);
  }

  const idx = join(outDir, 'index.html');
  const idxHtml = indexPage(results);
  writeFileSync(idx, idxHtml);
  console.log(`index ${' '.repeat(4)}              ${String(Buffer.byteLength(idxHtml)).padStart(9)} bytes  ${idx}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
