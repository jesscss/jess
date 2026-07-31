/**
 * Generates isolated probe grammars so each combinator class's marginal
 * codegen cost can be read as a byte delta against `p00-base`.
 *
 * Every probe declares the SAME trivia and the same single entry rule shape, so
 * the only difference between two probe artifacts is the construct under test.
 */
import { writeFileSync, readdirSync, unlinkSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const here = dir.pathname;

for (const name of readdirSync(here)) {
  if (/^p[0-9]{2}-.*\.ts$/.test(name) && name !== 'p00-base.ts') {
    unlinkSync(here + name);
  }
}

const LITERALS = [
  ')', '(', '}', '{', ',', ']', '[', ';', '-', '\\\'', '"', ':', '/', '.', '*',
  '&', '%', '~', '|', '^', '?', '>', '=', '<', '+', '$', '~\\\'', '~"', '@', '!'
];

const MARGIN = [
  '@top-left-corner', '@top-left', '@top-center', '@top-right-corner', '@top-right',
  '@bottom-left-corner', '@bottom-left', '@bottom-center', '@bottom-right-corner',
  '@bottom-right', '@left-top', '@left-middle', '@left-bottom', '@right-top',
  '@right-middle', '@right-bottom'
];
const DESCRIPTOR = [
  '@font-face', '@counter-style', '@property', '@color-profile',
  '@font-palette-values', '@position-try', '@view-transition'
];
const FFV = [
  '@stylistic', '@styleset', '@character-variant', '@swash', '@ornaments',
  '@annotation', '@historical-forms'
];

const REGEXES = [
  String.raw`/-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/`,
  String.raw`/(?:[^"\\]|\\[\s\S])*/`,
  String.raw`/(?:[^'\\]|\\[\s\S])*/`,
  String.raw`/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/`,
  String.raw`/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/`,
  String.raw`/-?[_a-zA-Z-￿](?:[_a-zA-Z0-9-￿]|-(?![0-9]))*|%/`,
  String.raw`/\/\*(?:[^*]|\*(?!\/))*\*\//`,
  String.raw`/\/\/[^\n\r]*/`,
  String.raw`/::?(?![ \t\n\r\f])/`,
  String.raw`/even|odd|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*\d+)?|[-+]?\d+/i`,
  String.raw`/[Uu]\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?/`,
  String.raw`/--(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/`,
  String.raw`/@(?:-[a-z]+-)?keyframes(?![-\w])/i`,
  String.raw`/(?:[.#]?-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\d+(?:\.\d+)?%|\*)/`,
  String.raw`/(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/`,
  String.raw`/[a-zA-Z]/`
];

const HEAD = `/** Generated probe — see gen.mjs. Not a shipped grammar. */\n`;

function write(name, imports, body, exportRule) {
  writeFileSync(
    here + name + '.ts',
    HEAD
    + `import { ${imports.join(', ')} } from 'parseman' with { type: 'macro' };\n\n`
    + `const whitespace = regex(/[ \\t\\n\\r\\f]+/);\n\n`
    + `export const probeGrammar = rules({ trivia: whitespace }, _g => {\n${body}\n  return { Start: ${exportRule} };\n});\n`
  );
}

/* p01 — 30 distinct literal spellings, one choice. */
write('p01-lit30', ['choice', 'literal', 'regex', 'rules'],
  `  const Start = choice(\n${LITERALS.map(l => `    literal('${l}')`).join(',\n')}\n  );\n`,
  'Start');

/* p02 — the same 30 spellings across 219 sites, matching the real site count. */
{
  const sites = [];
  for (let i = 0; i < 219; i++) {
    sites.push(`    literal('${LITERALS[i % LITERALS.length]}')`);
  }
  write('p02-lit219', ['choice', 'literal', 'regex', 'rules'],
    `  const Start = choice(\n${sites.join(',\n')}\n  );\n`, 'Start');
}

/* p03 — 16 real CSS terminal regexes. */
write('p03-regex16', ['choice', 'regex', 'rules'],
  `  const Start = choice(\n${REGEXES.map(r => `    regex(${r})`).join(',\n')}\n  );\n`,
  'Start');

/* p04 — 30 real CSS terminal regexes (same 16 doubled with distinct tails). */
{
  const doubled = REGEXES.concat(REGEXES.map(r => r.replace(/\/$/, 'x/').replace(/\/i$/, 'x/i')));
  write('p04-regex32', ['choice', 'regex', 'rules'],
    `  const Start = choice(\n${doubled.map(r => `    regex(${r})`).join(',\n')}\n  );\n`, 'Start');
}

/* p05 — one keywords() table of 30 at-keywords (68-word class, part 1). */
write('p05-kw30', ['keywords', 'regex', 'rules'],
  `  const Start = keywords(\n    [${MARGIN.concat(DESCRIPTOR, FFV).map(w => `'${w}'`).join(', ')}],\n    { caseInsensitive: true, boundary: '-_0-9A-Za-z' }\n  );\n`,
  'Start');

/* p06 — the same 30 spellings as 30 separate word() terminals in a choice. */
write('p06-word30', ['choice', 'regex', 'rules', 'word'],
  `  const Start = choice(\n${MARGIN.concat(DESCRIPTOR, FFV).map(w => `    word('${w}', '-_0-9A-Za-z', { caseInsensitive: true })`).join(',\n')}\n  );\n`,
  'Start');

/* p07 — 20 NAMED node() rules (codegen may never inline a named rule). */
{
  const lines = [];
  for (let i = 0; i < 20; i++) {
    lines.push(`  const N${i} = node('N${i}', sequence(literal('('), regex(/[a-z]+/), literal(')')), children => children[1]);`);
  }
  lines.push(`  const Start = choice(${Array.from({ length: 20 }, (_, i) => `N${i}`).join(', ')});`);
  write('p07-named20', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence'],
    lines.join('\n') + '\n', 'Start');
}

/* p08 — the identical 20 structures written inline, no names. */
{
  const arms = [];
  for (let i = 0; i < 20; i++) {
    arms.push(`    node('N${i}', sequence(literal('('), regex(/[a-z]+/), literal(')')), children => children[1])`);
  }
  write('p08-inline20', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence'],
    `  const Start = choice(\n${arms.join(',\n')}\n  );\n`, 'Start');
}

/* p09 — 20 literal-led choice arms sharing one broad opener (the anti-pattern). */
{
  const arms = [];
  for (let i = 0; i < 20; i++) {
    arms.push(`    sequence(regex(/[a-z]+/), literal('${LITERALS[i]}'))`);
  }
  write('p09-choice20', ['choice', 'literal', 'regex', 'rules', 'sequence'],
    `  const Start = choice(\n${arms.join(',\n')}\n  );\n`, 'Start');
}

/* p10 — the same 20 branches routed once with dispatch(). */
{
  const cases = [];
  for (let i = 0; i < 20; i++) {
    cases.push(`    when('k${i}', node('N${i}', routed(), children => children))`);
  }
  write('p10-dispatch20', ['dispatch', 'node', 'otherwise', 'regex', 'routed', 'rules', 'when'],
    `  const Start = dispatch(\n    regex(/[a-z0-9]+/),\n${cases.join(',\n')},\n    otherwise(node('Generic', routed(), children => children))\n  );\n`,
    'Start');
}

/* p11 — composeLeaf of the whole shared CSS terminal alphabet, nothing else. */
writeFileSync(here + 'p11-sharedleaves.ts',
  HEAD
  + `import { composeLeaf, regex, rules, sequence } from 'parseman' with { type: 'macro' };\n`
  + `import { cssSyntax } from '@jesscss/parser-shared/recognition';\n\n`
  + `const whitespace = regex(/[ \\t\\n\\r\\f]+/);\n\n`
  + `const probeFactory = (g: Record<string, never>) => {\n`
  + `  const Start = sequence(g.Identifier, g.NumberToken);\n\n  return { Start };\n};\n\n`
  + `export const probeGrammar = composeLeaf([cssSyntax, rules({ trivia: whitespace }, probeFactory)]);\n`);

console.log('generated');
