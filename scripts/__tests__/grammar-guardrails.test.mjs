/*
 * Canaries for `pnpm check:guardrails` assertion 8 (scripts/grammar-guardrails.mjs).
 * Each rule must go red on a planted violation and stay green on a clean
 * grammar; the ratchet must report a new site and a removed one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANY_SOURCE, compareBaselineToBase, compareGrammarBaseline, GRAMMAR_SOURCE, grammarDefinitions, MANY, NOT_A_GRAMMAR,
  parsemanCombinatorImports, PRODUCTIONS_FILE, regexWidth, scanGrammarSource
} from '../grammar-guardrails.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const ts = createRequire(import.meta.url)('@typescript/typescript6/lib/typescript.js');
const FILE = 'packages/syntax/demo/demo-parser/src/grammar.ts';

const scan = (source, base = new Map()) => scanGrammarSource(ts, FILE, source, base);
const rulesOf = (source, base) => scan(source, base).map(h => `${h.rule}:${h.const}`);

const CLEAN = String.raw`
import { adjacent, attempt, balanced, choice, classifiedTrivia, dispatch, field, gate, keywords, literal, makeWord, many, node, notAdjacent, oneOrMore, oneOrMoreSep, sepBy, noTrivia, not, optional, parser, peek, regex, rules, scanTo, sequence, token, word, composeLeaf } from 'parseman' with { type: 'macro' };
const trivia = classifiedTrivia({ whitespace: regex(/[ \t\n\r\f]+/), comment: regex(/\/\*(?:[^*]|\*(?!\/))*\*\//) });
const identWord = makeWord({ boundary: '-_a-zA-Z0-9' });
const identifier = regex(/-?(?:[_a-zA-Z\u0080-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const atKeyword = regex(/@(?:-[a-z]+-)?keyframes(?![-_a-zA-Z0-9\u0080-￿\\])/i);
const factory = (g) => {
  const blockStart = not(literal('{'));
  const operator = peek(keywords(['+', '-']));
  const end = not(regex(/[;}!]/));
  const eof = not(regex(/[\s\S]/));
  const colonAfterTrivia = not(regex(/[ \t\n\r\f]*:/));
  const when = not(word('when'));
  const layer = not(identWord('layer'));
  const braceAfterTrivia = not(sequence(optional(trivia), literal('{')));
  const functionToken = not(token(noTrivia(sequence(word('layer'), literal('(')))));
  const gated = not(choice({ gate: state => state !== undefined, combinator: literal('=') }));
  const name = not(identifier);
  const keyword = not(g.Keyframes);
  /** A property name and its colon. */
  const Declaration = node('Declaration', sequence(identifier, literal(':')), children => children);
  return { Declaration, Keyframes: atKeyword };
};
export const demoGrammar = composeLeaf([rules(factory)]);
`;

test('a clean grammar passes every rule', () => {
  assert.deepEqual(scan(CLEAN), []);
});

const planted = body => `${CLEAN}\nconst factory2 = (g) => {\n${body}\n};\n`;

test('lookahead: a multi-token regex pre-scan is caught (the Less ruleset/declaration guard)', () => {
  assert.deepEqual(rulesOf(planted(String.raw`const probe = not(regex(/[-\w]+[ \t]*:[ \t\n\r\f]/));`)), ['lookahead:probe']);
});

test('lookahead: a scanning regex is caught', () => {
  assert.deepEqual(rulesOf(planted(String.raw`const probe = peek(regex(/[^:;{}]*[@$]\{/));`)), ['lookahead:probe']);
});

test('lookahead: a regex lookaround that reads the next token is caught', () => {
  assert.deepEqual(rulesOf(planted(String.raw`const probe = not(regex(/[ \t\n\r\f]*!?all(?=[ \t\n\r\f]*(?:,|\)))/i));`)), ['lookahead:probe']);
});

test('lookahead: a glued identifier-then-punctuation regex is caught', () => {
  assert.deepEqual(rulesOf(planted(String.raw`const probe = peek(regex(/[.#]?[-\w]*\$\{/));`)), ['lookahead:probe']);
});

test('lookahead: a multi-token sequence is caught', () => {
  assert.deepEqual(rulesOf(planted(`const probe = not(sequence(literal('$'), word('if')));`)), ['lookahead:probe']);
});

test('lookahead: a repetition is caught', () => {
  assert.deepEqual(rulesOf(planted(`const probe = peek(many(literal('a')));`)), ['lookahead:probe']);
});

test('lookahead: a whole multi-token production, local or through g., is caught', () => {
  assert.deepEqual(rulesOf(planted(`const probe = not(g.Declaration);`)), ['lookahead:probe']);
  assert.deepEqual(rulesOf(planted(`const wide = sequence(literal('a'), literal('b'));\nconst probe = not(wide);`)), ['lookahead:probe']);
});

test('lookahead: a production defined nowhere cannot be proven narrow', () => {
  assert.deepEqual(rulesOf(planted(`const probe = not(g.SomethingElsewhere);`)), ['lookahead:probe']);
});

test('lookahead: an inherited production resolves through the base grammar', () => {
  const base = grammarDefinitions(ts, 'base.ts', `import { literal, many, sequence } from 'parseman'; const Narrow = literal('x'); const Wide = sequence(literal('a'), many(literal('b')));`);
  assert.deepEqual(rulesOf(planted(`const probe = not(g.Narrow);`), base), []);
  assert.deepEqual(rulesOf(planted(`const probe = not(g.Wide);`), base), ['lookahead:probe']);
});

test('lookahead: token() cannot declare whitespace or a scan to be one token', () => {
  assert.deepEqual(rulesOf(planted(String.raw`const probe = not(token(regex(/[-\w]+[ \t]*:/)));`)), ['lookahead:probe']);
  assert.deepEqual(rulesOf(planted(String.raw`const probe = not(token(regex(/[^;]*;/)));`)), ['lookahead:probe']);
  assert.deepEqual(rulesOf(planted(`const probe = not(token(sequence(literal('a'), trivia, literal('b'))));`)), ['lookahead:probe']);
});

test('lookahead: a lookaround cannot hide what follows whitespace, in a lookahead or a consuming regex', () => {
  for (const pattern of [String.raw`/[-\w]+[ \t]*(?=:[ \t\n\r\f])/`, String.raw`/[-\w]+(?=[ \t]*(?=:))/`, String.raw`/[a-z](?=(?:[-\w]+):)/`, String.raw`/(?<=(?:[-\w]+):)x/`]) {
    assert.deepEqual(rulesOf(planted(`const probe = not(regex(${pattern}));`)), ['lookahead:probe'], pattern);
    assert.deepEqual(rulesOf(planted(`const probe = regex(${pattern});`)), ['lookahead:probe'], pattern);
  }
});

test('lookahead: a nested not or peek after a consuming arm reads a token, at any depth', () => {
  const caught = body => assert.deepEqual(rulesOf(planted(body)), ['lookahead:probe'], body);
  caught(String.raw`const probe = not(sequence(regex(/[-\w]+/), peek(literal(':'))));`);
  caught(String.raw`const probe = not(sequence(regex(/[-\w]+/), not(literal(':'))));`);
  caught(String.raw`const inner = sequence(regex(/[-\w]+/), peek(literal(';'))); const probe = peek(sequence(optional(trivia), inner));`);
  caught(String.raw`const probe = not(token(sequence(regex(/[-\w]+/), peek(literal(':')))));`);
  assert.deepEqual(rulesOf(planted(`const probe = not(sequence(peek(literal(':')), literal(':')));`)), []);
});

test('regexWidth: tokens glued in one regex are counted; a real single token passes', () => {
  const many_ = [
    String.raw`/(?:[-\w]+):/`, String.raw`/([-\w]+):/`, '/color:/', '/(?:color|margin|padding):/', String.raw`/;[-\w]+/`, String.raw`/\{[-\w]+/`,
    '/.?.?.?.?.?.?.?.?.?.?:/', '/[^;]?[^;]?[^;]?[^;]?;/', String.raw`/\p{Any}+(?=;)/u`, '/[!-:<-~]+(?=;)/', String.raw`/([-\w]+):\1/`, String.raw`/(?:[-\w]+)[^\S]?:/`, '/.foo/', '/[^;]:/'
  ];
  for (const pattern of many_) {
    assert.equal(regexWidth(pattern).width, MANY, pattern);
    assert.equal(regexWidth(pattern).hard, true, pattern);
  }
  const one = [
    '/[0-9]+\\.[0-9]+/', String.raw`/[-+]?\d*\.?\d+/`, '/"[^"]*"/', '/[<>=]*=~/', String.raw`/[a-z]+\\./`, '/[^;]/', '/./', String.raw`/\d+%/`, String.raw`/#[0-9a-f]+/`, String.raw`/@[-\w]+/`, String.raw`/[-\w]+\(/`
  ];
  for (const pattern of one) {
    assert.equal(regexWidth(pattern).width, 1, pattern);
  }
  assert.equal(regexWidth(String.raw`/\/\*[^*]*\*\//`).width, 0);
});

test('lookahead: a consuming arm that starts by scanning past one token is caught, in each form', () => {
  const WIDE = String.raw`regex(/[-\w]+[ \t]*:/)`;
  const caught = body => assert.deepEqual(scan(planted(body)).filter(h => h.const === 'probe').map(h => h.rule), ['lookahead'], body);
  caught(`const probe = choice(sequence(${WIDE}, literal('x')), literal('y'));`);
  caught(`const probe = optional(sequence(${WIDE}, literal('x')));`);
  caught(`const probe = choice(sequence(scanTo(literal(':')), literal(':')), literal('y'));`);
  caught(`const wide = ${WIDE};\nconst probe = choice(sequence(wide, literal('x')), literal('y'));`);
  caught(`const probe = choice({ gate: s => s, combinator: sequence(${WIDE}, literal('x')) }, literal('y'));`);
  caught(`const probe = choice(sequence(optional(trivia), ${WIDE}), literal('y'));`);
  const passes = body => assert.deepEqual(scan(planted(body)).filter(h => h.rule === 'lookahead'), [], body);
  passes(`const probe = choice(sequence(literal('a'), literal('x')), literal('y'));`);
  passes(String.raw`const probe = choice(sequence(regex(/[-\w]+/), literal('x')), literal('y'));`);
  passes(`const probe = choice(literal('y'), ${WIDE});`);
  passes(`const probe = choice(sequence(literal('a'), ${WIDE}), literal('y'));`);
  passes(`const probe = choice(sequence(g.Declaration, ${WIDE}), literal('y'));`);
  const base = grammarDefinitions(ts, 'base.ts', `import { regex } from 'parseman'; const map = { WideRule: ${WIDE} };`);
  assert.deepEqual(scan(planted(`const probe = choice(sequence(g.WideRule, literal('x')), literal('y'));`), base).filter(h => h.rule === 'lookahead'), [], 'a rule reference stays with the backtrack probe');
});

test('lookahead: wrappers, guards and optional leads do not hide a consuming arm', () => {
  const WIDE = String.raw`regex(/[-\w]+[ \t]*:/)`;
  const SEQ = `sequence(${WIDE}, literal('x'))`;
  const caught = body => assert.deepEqual(scan(planted(body)).filter(h => h.const === 'probe').map(h => h.rule), ['lookahead'], body);
  caught(`const probe = choice(parser({ trivia: whitespace }, ${SEQ}), literal('y'));`);
  caught(`const probe = optional(parser({ trivia: null }, ${SEQ}));`);
  caught(`const name = 'A';\nconst probe = choice(node(name, ${SEQ}, c => c), literal('y'));`);
  caught(`const probe = choice(field('a', ${SEQ}), literal('y'));`);
  caught(`const probe = choice(sequence(gate(s => s), ${WIDE}, literal('x')), literal('y'));`);
  caught(`const probe = choice(sequence(notAdjacent(), ${WIDE}, literal('x')), literal('y'));`);
  caught(`const probe = choice(sequence(adjacent(), ${WIDE}, literal('x')), literal('y'));`);
  caught(`const probe = choice(many(${SEQ}), literal('y'));`);
  caught(`const probe = choice(sequence(optional(literal('.')), ${WIDE}, literal('x')), literal('y'));`);
});

test('lookahead: a repeat or balanced that starts a scan counts only when a required term follows it', () => {
  const WIDE = String.raw`regex(/[-\w]+[ \t]*:/)`;
  const SEQ = `sequence(${WIDE}, literal('x'))`;
  const hits = body => scan(planted(body)).filter(h => h.rule === 'lookahead').length;
  for (const body of [
    `const probe = many(${SEQ});`,
    `const probe = oneOrMore(${SEQ});`,
    `const probe = oneOrMoreSep(${SEQ}, literal(','));`,
    `const probe = sepBy(${SEQ}, literal(','));`,
    `const probe = choice(sequence(balanced('(', ')'), literal('{')), literal('y'));`,
    `const probe = optional(sequence(balanced('(', ')'), literal('{')));`
  ]) {
    assert.equal(hits(body), 1, body);
  }
  for (const body of [
    `const probe = many(${WIDE});`,
    `const probe = many(sequence(${WIDE}, optional(literal('x'))));`,
    `const probe = sepBy(sequence(literal('a'), literal('x')), literal(','));`,
    `const probe = choice(balanced('(', ')'), literal('y'));`,
    `const probe = choice(sequence(balanced('(', ')'), optional(literal('{'))), literal('y'));`,
    `const probe = sequence(balanced('(', ')'), literal('{'));`
  ]) {
    assert.equal(hits(body), 0, body);
  }
});

test('lookahead: an object with a parse member is a hand-written combinator; other objects are not', () => {
  const caught = body => assert.deepEqual(scan(planted(body)).filter(h => h.const === 'probe').map(h => h.rule), ['lookahead'], body);
  caught(`const probe = { parse(input, pos) { return input.indexOf(':', pos); } };`);
  caught(`const probe = { parse: (input: string, pos: number) => pos };`);
  caught(`const parse = () => 1;\nconst probe = { parse };`);
  caught(`const probe = { 'parse': (input: string, pos: number) => pos };`);
  assert.deepEqual(scan(planted(`const probe = { parsed: 1, value: x => x.parse() };`)).filter(h => h.rule === 'lookahead'), []);
});

test('fingerprint: a baselined arm cannot grow a required tail with nothing moving', () => {
  const WIDE = String.raw`regex(/[-\w]+[ \t]*:/)`;
  const hash = arm => scan(`${CLEAN}\nconst text = ${WIDE};\nconst probe = choice(${arm}, literal('y'));\n`).find(h => h.const === 'probe').resolved;
  assert.notEqual(hash('text'), hash(`sequence(text, literal(':'))`));
  assert.match(hash('text'), /^[0-9a-f]{16}$/);
  const lead = source => scan(`${CLEAN}\nconst text = regex(${source});\nconst probe = choice(sequence(text, literal('x')), literal('y'));\n`).find(h => h.const === 'probe').resolved;
  assert.notEqual(lead(String.raw`/[-\w]+[ \t]*:/`), lead(String.raw`/[^;]*;/`));
});

test('literal, keywords and word: text with more than one token in it is not one token', () => {
  const caught = body => assert.deepEqual(rulesOf(planted(body)), ['lookahead:probe'], body);
  caught(`const probe = not(literal('foo : bar'));`);
  caught(`const probe = not(keywords(['foo : bar', 'a b']));`);
  caught(`const probe = not(word('foo : bar'));`);
  caught(`const probe = not(token(literal('foo : bar')));`);
  caught(`const kw = makeWord();\nconst probe = not(kw('foo : bar'));`);
  caught(`const probe = not(literal('color:'));`);
  assert.deepEqual(rulesOf(planted(`const probe = not(literal('@{')); const other = not(literal('::'));`)), []);
});

test('names: a combinator is what parseman exports, not what happens to share its name', () => {
  const clean = body => assert.deepEqual(scan(body).map(h => h.rule), [], body);
  clean(`const token = 'x'; export const y = [token];`);
  clean(`export function f(ctx) { const { node, field } = ctx; return node ?? field; }`);
  clean(`import { label as tag } from './other.js'; export const z = tag;`);
  clean(`export function f() { try { return 1; } catch (regex) { return String(regex); } }`);
  clean(`function peek(s) { return s[0]; } export const q = peek('a b');`);
  clean(`const not = b => !b; export const q = not(true);`);
  clean(`import type { not as N } from 'parseman'; export type M = N;`);
  clean(`export type { Combinator } from 'parseman';`);
  clean(`export { run as parsemanRun } from 'parseman';`);
  clean(`import { not } from 'parseman'; const f = (not) => not(sequence(a, b));`);
});

test('resolution: what a name could be counts, not what it first looked like', () => {
  const caught = body => assert.deepEqual(rulesOf(planted(body)), ['lookahead:probe'], body);
  const WIDE = String.raw`regex(/[-\w]+[ \t]*:/)`;
  caught(`let w = literal('x');\nw = ${WIDE};\nconst probe = not(w);`);
  caught(`const n = literal(';');\nconst la = (n) => { const probe = not(n); return probe; };`);
  caught(`const n = literal(';');\nconst o = { n: ${WIDE} };\nconst probe = not(o.n);`);
  caught(`const o = {\n  /** x */\n  Semi: literal(';')\n};\no.Semi = ${WIDE};\nconst probe = not(o.Semi);`);
  caught(`const probe = not(parser(() => ${WIDE}));`);
  caught(`const probe = dispatch(${WIDE}, a);`);
  caught(`const probe = not(word('a', '-\\\\w])(?=[ \\\\t]*:)(?![x'));`);
  caught(`const probe = keywords(['a'], { boundary: '-\\\\w])(?=[ \\\\t]*:)(?![x' });`);
  const dialect = grammarDefinitions(ts, 'dialect.ts', `import { regex } from 'parseman'; const map = { Narrow: ${WIDE} };`);
  const own = `const probe = not(g.Narrow);\nconst map = {\n  /** One token. */\n  Narrow: literal('x')\n};`;
  assert.deepEqual(rulesOf(planted(own)), []);
  assert.deepEqual(rulesOf(planted(own), dialect), ['lookahead:probe']);
});

test('dialect-prefix: an uppercase, suffix or infix dialect name is caught, through every rule form', () => {
  const named = (body, name) => assert.deepEqual(rulesOf(planted(`/** x */\n${body}`)), [`dialect-prefix:${name}`], body);
  named(`const LESSThing = literal('x');`, 'LESSThing');
  named(`const CSSThing = literal('x');`, 'CSSThing');
  named(`const DeclarationLess = literal('x');`, 'DeclarationLess');
  named(`const AtScssRule = literal('x');`, 'AtScssRule');
  named(`const t = node('SCSSThing', literal('x'));`, 't');
  named(`const lessKw = makeWord();`, 'lessKw');
  named(`const b = literal('x');\nconst LessThing = b;`, 'LessThing');
  assert.deepEqual(rulesOf(planted(`const NodeList = literal('x'); const blessed = literal('y'); const unless = literal('z');`)).filter(r => r.startsWith('dialect')), []);
});

test('jsdoc: a rule in a map and an empty block need one too', () => {
  assert.deepEqual(rulesOf(planted(`const map = { PlantedRule: literal('y') };`)), ['jsdoc:PlantedRule']);
  assert.deepEqual(rulesOf(planted(`/** */\nconst PlantedRule = literal('y');`)), ['jsdoc:PlantedRule']);
  assert.deepEqual(rulesOf(planted(`const map = {\n  /** Recognizes y. */\n  PlantedRule: literal('y')\n};`)), []);
});

test('dialect-prefix: a prefixed or Ast/Cst rule name is caught; a whole grammar export is not', () => {
  assert.deepEqual(rulesOf(planted(`const lessThing = literal('x');`)), ['dialect-prefix:lessThing']);
  assert.deepEqual(rulesOf(planted(`/** A thing. */\nconst ScssThing = literal('x');`)), ['dialect-prefix:ScssThing']);
  assert.deepEqual(rulesOf(planted(`const thingCst = literal('x');`)), ['dialect-prefix:thingCst']);
  assert.deepEqual(rulesOf(planted(`const t = node('JessThing', literal('x'));`)), ['dialect-prefix:t']);
  assert.deepEqual(rulesOf(planted(`const lessGrammar = composeLeaf([rules(factory)]);`)), []);
  assert.deepEqual(rulesOf(planted(`const lessonPlan = literal('x');`)), []);
});

test('attempt: try-then-rollback is caught wherever it appears', () => {
  assert.deepEqual(rulesOf(planted(`const probe = attempt(sequence(literal('a'), literal('b')));`)), ['attempt:probe']);
  assert.deepEqual(rulesOf(planted(`const probe = choice(attempt(literal('a')), literal('b'));`)), ['attempt:probe']);
});

test('jsdoc: a rule without a JSDoc block is caught; a /** */ block passes, a /* */ block does not', () => {
  assert.deepEqual(rulesOf(planted(`const Rule = literal('x');`)), ['jsdoc:Rule']);
  assert.deepEqual(rulesOf(planted(`/* Not JSDoc. */\nconst Rule = literal('x');`)), ['jsdoc:Rule']);
  assert.deepEqual(rulesOf(planted(`/** Recognizes x. */\nconst Rule = literal('x');`)), []);
  assert.deepEqual(rulesOf(planted(`const helper = literal('x');`)), []);
});

test('runtime-codegen: new Function, Function() and eval() are caught', () => {
  assert.deepEqual(rulesOf(planted(`const probe = new Function('return 1');`)), ['runtime-codegen:probe']);
  assert.deepEqual(rulesOf(planted(`const probe = Function('return 1');`)), ['runtime-codegen:probe']);
  assert.deepEqual(rulesOf(planted(`const probe = eval('1');`)), ['runtime-codegen:probe']);
});

test('regexWidth: one token, trivia and many', () => {
  assert.equal(regexWidth(String.raw`/[;}!]/`).width, 1);
  assert.equal(regexWidth(String.raw`/@\{/`).width, 1);
  assert.equal(regexWidth(String.raw`/[^,;:)]|$/`).width, 1);
  assert.equal(regexWidth(String.raw`/[ \t\n\r\f]+/`).width, 0);
  assert.equal(regexWidth(String.raw`/#[0-9a-fA-F]+[ \t\n\r\f]*[;}!]/`).width, MANY);
  assert.equal(regexWidth(String.raw`/<(?=-?[_a-z][-\w]*>)/`).width, MANY);
});

test('regex(): a lookaround past one token is caught in a consuming regex too', () => {
  assert.deepEqual(rulesOf(planted(String.raw`const probe = regex(/[-\w]+(?=[ \t]*:)/);`)), ['lookahead:probe']);
  assert.deepEqual(rulesOf(planted(String.raw`const probe = regex(/(?![-\w]+[ \t]*:)[-\w]+/);`)), ['lookahead:probe']);
  assert.deepEqual(rulesOf(planted(String.raw`const probe = regex(/[-\w]+[ \t]*:(?=[ \t]*\{)/);`)), ['lookahead:probe']);
});

test('regex(): a check of the adjacent character and plain multi-token consumption pass', () => {
  assert.deepEqual(rulesOf(planted(String.raw`const probe = regex(/[-\w]+(?![-\w])/);`)), []);
  assert.deepEqual(rulesOf(planted(String.raw`const probe = regex(/:(?=[ \t\n\r\f]|\{)/);`)), []);
  assert.deepEqual(rulesOf(planted(String.raw`const probe = regex(/-(?![0-9]|\/[*/])/);`)), []);
  assert.deepEqual(rulesOf(planted(String.raw`const probe = regex(/,[ \t\n\r\f]*/);`)), []);
});

test('regex(): a pattern that is not a literal cannot be read, so it is caught', () => {
  assert.deepEqual(rulesOf(planted(String.raw`const pattern = /[-\w]+(?=[ \t]*:)/; const probe = regex(pattern);`)), ['lookahead:probe']);
  assert.deepEqual(rulesOf(planted(String.raw`const probe = regex(new RegExp('a(?= b)'));`)), ['lookahead:probe']);
});

test('regex(): one inside a lookahead is reported once, as the lookahead', () => {
  assert.deepEqual(scan(planted(String.raw`const probe = not(regex(/[-\w]+(?=[ \t]*:)/));`)).map(h => h.construct.slice(0, 4)), ['not(']);
});

test('regexWidth: the holes in a hand-rolled reader stay closed', () => {
  const hardMany = (source) => {
    const w = regexWidth(source);
    assert.equal(w.width, MANY, source);
    assert.equal(w.hard, true, source);
  };
  hardMany(String.raw`/(?:[-\w]+[ \t]*):[ \t\n]/`);
  hardMany(String.raw`/(?:[ \t]*foo)+/`);
  hardMany(String.raw`/\/\*foo bar/`);
  hardMany(String.raw`/\/\/foo bar/`);
  hardMany(String.raw`/\/[a]foo bar/`);
  hardMany(String.raw`/[-\w]+\x20*:/`);
  hardMany(String.raw`/a b/`);
  hardMany(String.raw`/[-\w ]+:/`);
  hardMany(String.raw`/[ -~]+/`);
  hardMany(String.raw`/a\w{0} b/`);
  assert.equal(regexWidth(String.raw`/[-\w]+\x3a/`).width, MANY);
  assert.equal(regexWidth(String.raw`/foo\w{0}/`).width, 1);
});

test('regexWidth: canonical comments are trivia; a CSS hex escape keeps its terminating whitespace', () => {
  assert.equal(regexWidth(String.raw`/\/\*(?:[^*]|\*(?!\/))*\*\//`).width, 0);
  assert.equal(regexWidth(String.raw`/\/\/[^\n\r]*/`).width, 0);
  assert.equal(regexWidth(String.raw`/\\(?:[0-9a-fA-F]{1,6}[ \t]?|x)foo/`).width, 1);
  assert.equal(regexWidth(String.raw`/\\[0-9a-fA-F]{1,6}[ \t]?foo/`).width, 1);
  assert.equal(regexWidth(String.raw`/[0-9a-fA-F]{1,6}[ \t]?foo/`).width, MANY);
});

test('parseman-import: an alias, a namespace, destructuring or a re-export cannot hide a combinator', () => {
  const imports = source => scan(source).map(h => h.rule);
  assert.deepEqual(imports(`import { not as notAhead } from 'parseman';`), ['parseman-import']);
  assert.deepEqual(imports(`import { attempt as tryParse } from 'parseman';`), ['parseman-import']);
  assert.deepEqual(imports(`import * as pm from 'parseman';`), ['parseman-import']);
  assert.deepEqual(imports(`const { not: n } = parseman;`), ['parseman-import']);
  assert.deepEqual(imports(`const { peek } = parseman;`), ['parseman-import']);
  assert.deepEqual(imports(`const pm = await import('parseman');`), ['parseman-import']);
  assert.deepEqual(imports(`const pm = require('parseman');`), ['parseman-import']);
  assert.deepEqual(imports(`export { not as n } from 'parseman';`), ['parseman-import']);
  assert.deepEqual(imports(`export * from 'parseman';`), ['parseman-import']);
  assert.deepEqual(imports(`import { not } from 'parseman'; const n = not;`), ['parseman-import']);
  assert.deepEqual(imports(`import { regex } from 'parseman'; const r = regex;`), ['parseman-import']);
  assert.deepEqual(imports(`import { attempt } from 'parseman'; const o = { attempt };`), ['parseman-import']);
  assert.deepEqual(imports(`import pm from 'parseman';`), ['parseman-import']);
  assert.deepEqual(imports(`import { default as pm } from 'parseman';`), ['parseman-import']);
  assert.deepEqual(imports(`import pm = require('parseman');`), ['parseman-import']);
  assert.deepEqual(imports(`import { createRequire } from 'node:module'; const r = createRequire(import.meta.url);`), ['parseman-import']);
  assert.deepEqual(imports(`import { not } from 'pm-alias';`), ['parseman-import']);
  assert.deepEqual(imports(`import { thing } from './__tests__/helper.js';`), ['parseman-import']);
});

test('parseman-import: own names, other modules, types and local variables named like a combinator pass', () => {
  const imports = source => scan(source).map(h => h.rule);
  assert.deepEqual(imports(`import { not, peek } from 'parseman';`), []);
  assert.deepEqual(imports(`import { fn as other } from './helpers.js';`), []);
  assert.deepEqual(imports(`export type { ParseDoc } from 'parseman';`), []);
  assert.deepEqual(imports(`const reduce = (not) => not.span;`), []);
  assert.deepEqual(imports(`const reduce = (kids) => { const not = kids[0]; return not === undefined; };`), []);
  assert.deepEqual(imports(`const reduce = (kids) => { for (const token of kids) { use(token); } };`), []);
});

test('token(): it narrows a one-token shape and nothing wider', () => {
  const caught = body => assert.deepEqual(rulesOf(planted(body)), ['lookahead:probe'], body);
  const passes = body => assert.deepEqual(rulesOf(planted(body)), [], body);
  caught(`const probe = not(token(noTrivia(sequence(identifier, literal(':'), identifier, literal('{')))));`);
  caught(String.raw`const probe = not(token(regex(/[-\w]+\x20*:/)));`);
  caught(`const probe = not(token(noTrivia(sequence(identifier, identifier))));`);
  caught(`const probe = not(token(noTrivia(sequence(identifier, literal(':')))));`);
  caught(`const probe = not(token(noTrivia(sequence(many(identifier), literal('(')))));`);
  caught(`const probe = not(token(noTrivia(sequence(literal('a b'), literal('(')))));`);
  caught(String.raw`const probe = not(token(regex(/[-\w]+:/)));`);
  passes(`const probe = not(token(noTrivia(sequence(identifier, literal('(')))));`);
  passes(`const probe = not(token(noTrivia(sequence(literal('@'), identifier))));`);
  passes(`const probe = not(token(noTrivia(sequence(literal(':'), identifier, literal('(')))));`);
  passes(`const probe = not(token(noTrivia(sequence(regex(/\\d+/), literal('%')))));`);
  passes(`const probe = not(token(noTrivia(sequence(literal('*'), identifier))));`);
});

test('a type cast hides neither a rule name nor a missing JSDoc block', () => {
  assert.deepEqual(rulesOf(planted(`const lessThing = literal('x') as Combinator<string>;`)), ['dialect-prefix:lessThing']);
  assert.deepEqual(rulesOf(planted(`const lessThing = (literal('x') satisfies Combinator<string>);`)), ['dialect-prefix:lessThing']);
  assert.deepEqual(rulesOf(planted(`const Rule = literal('x') as Combinator<string>;`)), ['jsdoc:Rule']);
  assert.deepEqual(rulesOf(planted(`const Rule = literal('x') satisfies Combinator<string>;`)), ['jsdoc:Rule']);
  assert.deepEqual(rulesOf(planted(`const wide = regex(/a b/) as Combinator<string>; const probe = not(wide);`)), ['lookahead:probe']);
});

test('runtime-codegen: another route to eval or Function is caught; a type is not', () => {
  assert.deepEqual(rulesOf(planted(`const probe = Function;`)), ['runtime-codegen:probe']);
  assert.deepEqual(rulesOf(planted(`const probe = globalThis.eval('1');`)), ['runtime-codegen:probe']);
  assert.deepEqual(rulesOf(planted(`const probe = (0, eval)('1');`)), ['runtime-codegen:probe']);
  assert.deepEqual(rulesOf(planted(`const probe = globalThis['Function']('return 1');`)), ['runtime-codegen:probe']);
  assert.deepEqual(rulesOf(planted(`let probe: Function | undefined;`)), []);
  assert.deepEqual(rulesOf(planted(`const probe = (() => {}).constructor('return 1');`)), ['runtime-codegen:probe']);
  assert.deepEqual(rulesOf(planted(`const probe = setTimeout('1');`)), ['runtime-codegen:probe']);
  assert.deepEqual(rulesOf(planted(`const probe = globalThis['ev' + 'al']('1');`)), ['runtime-codegen:probe']);
  assert.deepEqual(scan(planted(`const { eval: probe } = globalThis;`)).map(h => h.rule), ['runtime-codegen']);
  assert.deepEqual(scan(`import vm from 'node:vm';`).map(h => h.rule), ['runtime-codegen']);
  assert.deepEqual(scan(`import type { Script } from 'node:vm';`), []);
});

test('coverage: every source extension is scanned; a combinator imported elsewhere is found', () => {
  for (const ext of ['ts', 'mts', 'cts', 'tsx', 'js', 'mjs']) {
    assert.equal(GRAMMAR_SOURCE.test(`packages/syntax/less/less-parser/src/thing.${ext}`), true, ext);
    assert.equal(ANY_SOURCE.test(`packages/core/src/thing.${ext}`), true, ext);
  }
  assert.equal(GRAMMAR_SOURCE.test('packages/parser-shared/src/thing.d.ts'), false);
  assert.equal(GRAMMAR_SOURCE.test('packages/parser-shared/src/thing.test.ts'), false);
  assert.equal(GRAMMAR_SOURCE.test('packages/core/src/thing.ts'), false);
  assert.deepEqual(scanGrammarSource(ts, 'packages/parser-shared/src/thing.tsx', `import { many, not } from 'parseman'; const probe = not(many(a));`).map(h => h.rule), ['lookahead']);
  assert.equal(NOT_A_GRAMMAR.test('packages/core/src/grammar.ts'), false);
  assert.equal(NOT_A_GRAMMAR.test('packages/syntax/less/less-parser/test/a.ts'), true);
  assert.equal(NOT_A_GRAMMAR.test('test/dialects.ts'), true);
  assert.equal(NOT_A_GRAMMAR.test('packages/core/src/perf/helper.ts'), false);
  assert.equal(NOT_A_GRAMMAR.test('packages/core/perf/helper.ts'), true);
  assert.equal(NOT_A_GRAMMAR.test('tools/grammar-tournament/src/coverage.mjs'), true);

  assert.deepEqual(parsemanCombinatorImports(`import { not, literal as l, parse } from 'parseman';`), ['not', 'literal']);
  assert.deepEqual(parsemanCombinatorImports(`import * as pm from 'parseman';`), ['* from parseman']);
  assert.deepEqual(parsemanCombinatorImports(`export { not } from 'parseman';`), ['not']);
  assert.deepEqual(parsemanCombinatorImports(`const pm = await import('parseman');`), ['dynamic parseman']);
  assert.deepEqual(parsemanCombinatorImports(`const pm = createRequire(import.meta.url)('parseman');`), ['dynamic parseman']);
  assert.deepEqual(parsemanCombinatorImports(`import { not } from '../node_modules/.pnpm/parseman@1.0.0/node_modules/parseman/dist/index.js';`), ['not']);
  assert.deepEqual(parsemanCombinatorImports(`import parseman from 'parseman/plugin';`), []);
  assert.deepEqual(parsemanCombinatorImports(`import type { Combinator } from 'parseman';`), []);
  assert.deepEqual(parsemanCombinatorImports(`import { DIGEST_FORMAT } from 'parseman/oracle';`), []);
  assert.deepEqual(parsemanCombinatorImports(`import { not } from './mine.js';`), []);
});

test('fingerprint: any change to what a site reads moves it, past any clip; a comment or formatting does not', () => {
  const site = (regexSource, comment = '') => `${CLEAN}\nconst wide = regex(${comment}${regexSource});\nconst probe = not(choice(literal('a'), wide));\n`;
  const fingerprint = source => scan(source).find(h => h.const === 'probe').resolved;
  const base = fingerprint(site(String.raw`/[-\w]+[ \t]*:/`));
  assert.notEqual(fingerprint(site(String.raw`/[^;{}]*[;{]/`)), base);
  assert.equal(fingerprint(site(String.raw`/[-\w]+[ \t]*:/`, '/* why */\n  // and why\n  ')), base);
  const long = 'x'.repeat(400);
  const clipped = end => fingerprint(`${CLEAN}\nconst probe = not(regex(/${long} ${end}/));\n`);
  assert.notEqual(clipped('a'), clipped('b'));
});

test('fingerprint: attempt, a consuming regex and a dispatch selector carry one', () => {
  const hit = body => scan(planted(body)).find(h => h.const === 'probe');
  assert.match(hit(`const probe = attempt(literal('a'));`).resolved, /^[0-9a-f]{16}$/);
  assert.match(hit(String.raw`const probe = regex(/[-\w]+[ \t]*(?=:)/);`).resolved, /^[0-9a-f]{16}$/);
  assert.match(hit(String.raw`const probe = dispatch(regex(/[-\w]+[ \t]*:/), a);`).resolved, /^[0-9a-f]{16}$/);
});

test('fingerprint: an inline reducer does not move it; what the rule matches does', () => {
  const site = (reducer, text = 'b') => `${CLEAN}\nconst inner = node('X', sequence(literal('a'), literal('${text}')), ${reducer});\nconst probe = not(inner);\n`;
  const hash = source => scan(source).find(h => h.const === 'probe').resolved;
  assert.equal(hash(site('c => c[0]')), hash(site('c => c[1]')));
  assert.equal(hash(site('function (c) { return c[0]; }')), hash(site('(c) => c.length')));
  assert.notEqual(hash(site('c => c[0]')), hash(site('c => c[0]', 'z')));
});

test('fingerprint: an attempt reads its own expression and one level of definitions; a not or peek reads them all', () => {
  const site = (top, middle, deep) => `${CLEAN}\nconst deep = literal('${deep}');\nconst middle = sequence(literal('${middle}'), deep);\nconst probe = ${top}(sequence(literal('a'), middle));\n`;
  const hash = source => scan(source).find(h => h.const === 'probe').resolved;
  for (const [top, deepMoves] of [['attempt', false], ['not', true], ['peek', true]]) {
    assert.notEqual(hash(site(top, 'm', 'd')), hash(site(top, 'x', 'd')), `${top} direct body`);
    assert.equal(hash(site(top, 'm', 'd')) !== hash(site(top, 'm', 'x')), deepMoves, `${top} deep`);
  }
});

test('fingerprint: a site in the CSS grammar or parser-shared reads every dialect; other sites read the grammar they compose', () => {
  const definitions = (file, text) => grammarDefinitions(ts, file, `import { literal } from 'parseman'; const map = { Thing: literal('${text}') };`);
  const LESS = 'packages/syntax/less/less-parser/src/grammar.ts';
  const CSS = 'packages/syntax/css/css-parser/src/grammar.ts';
  const SHARED = 'packages/parser-shared/src/recognition.ts';
  const source = planted(`const probe = not(sequence(g.Thing, literal('z')));`);
  const hash = (file, base) => scanGrammarSource(ts, file, source, base).find(h => h.const === 'probe').resolved;
  assert.notEqual(hash(CSS, definitions(LESS, 'a')), hash(CSS, definitions(LESS, 'b')));
  assert.notEqual(hash(SHARED, definitions(LESS, 'a')), hash(SHARED, definitions(LESS, 'b')));
  assert.equal(hash(FILE, definitions(LESS, 'a')), hash(FILE, definitions(LESS, 'b')));
  assert.notEqual(hash(FILE, definitions(SHARED, 'a')), hash(FILE, definitions(SHARED, 'b')));
});

test('ratchet: a site whose fingerprint moved is changed, not fresh; a new site at another const is fresh', () => {
  const source = regexSource => `${CLEAN}\nconst wide = regex(${regexSource});\nconst probe = not(wide);\n`;
  const before = scan(source(String.raw`/[-\w]+[ \t]*:/`));
  const after = scan(source(String.raw`/[^;{}]*[;{]/`));
  assert.equal(before[0].construct, after[0].construct);
  const { fresh, stale, changed } = compareGrammarBaseline(after, before);
  assert.deepEqual([fresh.length, stale.length, changed.length], [0, 0, 1]);
  assert.equal(changed[0].hit.resolved, after[0].resolved);
  assert.deepEqual(compareGrammarBaseline(before, before).changed, []);
  const moved = compareGrammarBaseline(before.map(h => ({ ...h, const: 'other' })), before);
  assert.deepEqual([moved.fresh.length, moved.stale.length], [1, 1]);
});

test('shrink-only: a new site or repeat is added; a moved fingerprint needs a new note; a removal is fine', () => {
  const entry = { rule: 'lookahead', file: FILE, const: 'probe', construct: 'not(x)', resolved: 'aaa' };
  const base = { entries: [entry], undocumentedRules: { [FILE]: ['Rule'] } };
  const added = current => compareBaselineToBase(base, { ...base, ...current }).added;
  const unexplained = current => compareBaselineToBase(base, { ...base, ...current }).unexplained;
  assert.deepEqual(added(base), []);
  assert.deepEqual(added({ entries: [], undocumentedRules: {} }), []);
  assert.deepEqual(added({ entries: [{ ...entry, line: 99 }] }), []);
  assert.equal(added({ entries: [entry, { ...entry, const: 'other' }] }).length, 1);
  assert.equal(added({ entries: [entry, entry] }).length, 1);
  assert.deepEqual(added({ undocumentedRules: { [FILE]: ['Rule', 'Other'] } }).map(e => e.construct), ['Other']);
  assert.equal(unexplained({ entries: [{ ...entry, resolved: 'bbb' }] }).length, 1);
  assert.equal(unexplained({ entries: [{ ...entry, resolved: 'bbb', changed: 'A shared definition grew a case.' }] }).length, 0);
  assert.equal(compareBaselineToBase(
    { ...base, entries: [{ ...entry, changed: 'old reason' }] },
    { ...base, entries: [{ ...entry, resolved: 'bbb', changed: 'old reason' }] }
  ).unexplained.length, 1);
});

test('shrink-only: a ref that cannot be read fails rather than skips', () => {
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/check-guardrails.mjs'), '--shrink-against=refs/does/not/exist'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /--shrink-against/);
});

test('no-eval, no-implied-eval and no-new-func are enabled for parser sources', () => {
  const dir = mkdtempSync(join(ROOT, 'packages/parser-shared/src/codegen-probe-'));
  const fixture = join(dir, 'probe.ts');
  writeFileSync(fixture, `export const a = eval('1');\nexport const b = new Function('return 1');\nexport const c = setTimeout('1');\n`);
  try {
    const { stdout, stderr } = spawnSync(process.execPath, [
      join(ROOT, 'node_modules/eslint/bin/eslint.js'), '--no-warn-ignored', fixture
    ], { cwd: ROOT, encoding: 'utf8' });
    for (const rule of ['no-eval', 'no-new-func', 'no-implied-eval']) {
      assert.match(stdout, new RegExp(`\\b${rule}\\b`), stdout + stderr);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ratchet: a new site is fresh, a removed one is stale, a moved one keeps its entry', () => {
  const entry = { rule: 'lookahead', file: FILE, line: 10, construct: 'not(x)', why: 'a', issue: 'jesscss/jess#1' };
  const moved = { rule: 'lookahead', file: FILE, line: 12, construct: 'not(x)', why: 'a' };
  const added = { rule: 'lookahead', file: FILE, line: 20, construct: 'not(y)', why: 'a' };
  const same = compareGrammarBaseline([moved], [entry]);
  assert.deepEqual(same.fresh, []);
  assert.deepEqual(same.stale, []);
  assert.deepEqual(same.kept, [{ ...entry, line: 12 }]);
  assert.deepEqual(compareGrammarBaseline([moved, added], [entry]).fresh, [added]);
  assert.deepEqual(compareGrammarBaseline([], [entry]).stale, [entry]);
});

/*
 * The gate as CI runs it, on a throwaway checkout: a violation that only the
 * library catches is no protection if the command still exits zero.
 */
test('the gate command exits non-zero on every planted failure', () => {
  const tree = join(mkdtempSync(join(tmpdir(), 'grammar-gate-')), 'tree');
  const git = (...args) => {
    const run = spawnSync('git', args, { cwd: tree, encoding: 'utf8' });
    assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
  };
  const copy = (rel) => {
    mkdirSync(dirname(join(tree, rel)), { recursive: true });
    copyFileSync(join(ROOT, rel), join(tree, rel));
  };
  const added = spawnSync('git', ['worktree', 'add', '--detach', tree, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  const BASELINE = 'scripts/check-guardrails.grammar-baseline.json';
  const CSS = 'packages/syntax/css/css-parser/src/grammar.ts';
  const SIBLING = 'packages/parser-shared/src/recognition.ts';
  const at = rel => join(tree, rel);
  const read = rel => readFileSync(at(rel), 'utf8');
  const gate = (...args) => {
    const run = spawnSync(process.execPath, ['scripts/check-guardrails.mjs', ...args], { cwd: tree, encoding: 'utf8', maxBuffer: 1 << 28 });
    return { status: run.status, out: run.stdout + run.stderr };
  };
  const list = () => JSON.parse(gate('--list-grammar').out);
  const fails = (name, message, ...args) => {
    const { status, out } = gate(...args);
    assert.notEqual(status, 0, `${name}: exited zero\n${out}`);
    assert.match(out, message, name);
  };

  /* Run `body` on the tree, then put every touched file back. */
  const scenario = (files, body) => {
    const saved = files.map(rel => [rel, existsSync(at(rel)) ? read(rel) : undefined]);
    try {
      body();
    } finally {
      for (const [rel, text] of saved) {
        if (text === undefined) {
          rmSync(at(rel), { force: true });
        } else {
          writeFileSync(at(rel), text);
        }
      }
    }
  };
  const addCommit = (message) => {
    git('add', '-A', 'scripts', 'packages');
    const commit = git('-c', 'user.name=gate', '-c', 'user.email=gate@example.invalid', 'commit-tree', git('write-tree'), '-p', 'HEAD', '-m', message);
    git('update-ref', '--no-deref', 'HEAD', commit);
    return commit;
  };
  const PLANT = String.raw`
const plantedCliFresh = not(regex(/[-\w]+[ \t]*:[ \t]/));
`;
  try {
    symlinkSync(join(ROOT, 'node_modules'), at('node_modules'));
    for (const rel of spawnSync('git', ['ls-files', '-m', '-o', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)) {
      if (/^(?:scripts|packages)\//.test(rel) && existsSync(join(ROOT, rel))) {
        copy(rel);
      }
    }
    const clean = gate();
    assert.equal(clean.status, 0, clean.out);

    scenario([CSS], () => {
      writeFileSync(at(CSS), read(CSS) + PLANT);
      fails('fresh hit', /new grammar lookahead violation/);
    });

    scenario([BASELINE], () => {
      const baseline = JSON.parse(read(BASELINE));
      baseline.entries.push({ ...baseline.entries[0], construct: 'noSuchSite', const: 'noSuchSite' });
      writeFileSync(at(BASELINE), JSON.stringify(baseline));
      fails('stale entry', /no longer occur/);
    });

    scenario(['packages/core/src/planted-grammar.ts'], () => {
      writeFileSync(at('packages/core/src/planted-grammar.ts'), `import { not } from 'parseman';\nexport const x = not;\n`);
      fails('stray file', /outside the scanned grammar sources/);
    });

    scenario(['packages/core/productions.ts'], () => {
      writeFileSync(at('packages/core/productions.ts'), 'export {};\n');
      fails('productions.ts', /productions\.ts/);
    });

    scenario(['scripts/grammar-guardrails.mjs'], () => {
      writeFileSync(at('scripts/grammar-guardrails.mjs'), read('scripts/grammar-guardrails.mjs').replace(`new Set(['not', 'peek'])`, 'new Set()'));
      fails('blinded scanner', /self-test/);
    });

    scenario(['scripts/grammar-guardrails.mjs'], () => {
      writeFileSync(at('scripts/grammar-guardrails.mjs'), read('scripts/grammar-guardrails.mjs').replace('    checkConsumingArms(node, name);\n', ''));
      fails('scanner blind to consuming arms', /self-test/);
    });

    /* A site planted and baselined together: the shrink comparison sees a new site. */
    scenario([CSS, BASELINE], () => {
      const site = regexSource => String.raw`
const plantedCliProbe = not(regex(${regexSource}));
`;
      const stock = read(CSS);
      const setSite = regexSource => writeFileSync(at(CSS), stock + site(regexSource));
      const baseline = JSON.parse(read(BASELINE));
      const saveEntry = (fields) => {
        const planted = list().find(h => h.const === 'plantedCliProbe');
        const others = baseline.entries.filter(e => e.const !== 'plantedCliProbe');
        baseline.entries = [...others, { ...planted, issue: baseline.issue, ...fields }];
        writeFileSync(at(BASELINE), JSON.stringify(baseline));
      };
      setSite(String.raw`/[-\w]+[ \t]*:[ \t]/`);
      saveEntry({});
      assert.equal(gate().status, 0);
      fails('added site', /added to scripts\/check-guardrails\.grammar-baseline\.json/, '--shrink-against=HEAD');

      addCommit('base with the site');
      assert.equal(gate('--shrink-against=HEAD').status, 0);

      setSite(String.raw`/[-\w]+[ \t]*:[ \t]+x/`);
      fails('changed fingerprint', /changed what they read/);
      saveEntry({});
      assert.equal(gate().status, 0);
      fails('changed with no note', /no new `changed` note/, '--shrink-against=HEAD');

      const NOTE = 'Planted: the site grew a tail.';
      saveEntry({ changed: NOTE });
      const noted = gate('--shrink-against=HEAD');
      assert.equal(noted.status, 0, noted.out);
      assert.match(noted.out, new RegExp(NOTE));

      addCommit('base with the note');
      const carried = gate('--shrink-against=HEAD');
      assert.equal(carried.status, 0, carried.out);
      assert.doesNotMatch(carried.out, new RegExp(NOTE), 'a note the base already has is not news');
      assert.match(gate().out, new RegExp(NOTE), 'with no base, every note prints');
      setSite(String.raw`/[-\w]+[ \t]*:[ \t]+y/`);
      saveEntry({ changed: NOTE });
      fails('a note copied from the base', /no new `changed` note/, '--shrink-against=HEAD');

      const good = read(BASELINE);
      writeFileSync(at(BASELINE), '{ not json');
      const broken = addCommit('base with a broken baseline');
      writeFileSync(at(BASELINE), good);
      fails('an unreadable base baseline', /cannot be proven to shrink/, `--shrink-against=${broken}`);
    });
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', tree], { cwd: ROOT });
    rmSync(dirname(tree), { recursive: true, force: true });
  }
});

test('productions.ts: any package path is caught; a productions/ directory is not', () => {
  assert.equal(PRODUCTIONS_FILE.test('packages/syntax/less/less-parser/src/productions.ts'), true);
  assert.equal(PRODUCTIONS_FILE.test('packages/core/productions.ts'), true);
  assert.equal(PRODUCTIONS_FILE.test('packages/syntax/less/less-parser/src/productions/value.ts'), false);
  assert.equal(PRODUCTIONS_FILE.test('packages/syntax/less/less-parser/src/my-productions.ts'), false);
});

test('lint:absolute:parsers: a planted `as any` in a parser package fails; the real parser sources pass', () => {
  const eslint = (...files) => spawnSync(process.execPath, [
    join(ROOT, 'node_modules/eslint/bin/eslint.js'), '--config', 'eslint.absolute.config.mjs', ...files
  ], { cwd: ROOT, encoding: 'utf8' });
  const dir = mkdtempSync(join(ROOT, 'packages/parser-shared/src/absolute-probe-'));
  const fixture = join(dir, 'probe.ts');
  writeFileSync(fixture, 'export const probe = (1 as any);\n');
  try {
    const planted = eslint(fixture);
    assert.notEqual(planted.status, 0, `${planted.stdout}\n${planted.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['lint:absolute:parsers'];
  const real = eslint(...[...script.matchAll(/'([^']+)'/g)].map(m => m[1]));
  assert.equal(real.status, 0, `${real.stdout}\n${real.stderr}`);
});

test('grammar/no-hand-rolled-keyword-regex is enabled for grammar files', () => {
  const dir = mkdtempSync(join(ROOT, 'packages/syntax/css/css-parser/src/keyword-probe-'));
  const lint = (body) => {
    const fixture = join(dir, 'probe.ts');
    writeFileSync(fixture, `import { regex, word } from 'parseman';\n${body}\n`);
    return spawnSync(process.execPath, [
      join(ROOT, 'node_modules/eslint/bin/eslint.js'), '--no-warn-ignored', '--rule', '{"@typescript-eslint/no-unused-vars":"off"}', fixture
    ], { cwd: ROOT, encoding: 'utf8' });
  };
  try {
    const planted = lint('export const probe = regex(/not(?![-\\w])/i);');
    assert.match(planted.stdout, /grammar\/no-hand-rolled-keyword-regex/, planted.stdout + planted.stderr);
    const clean = lint('export const probe = word(\'not\');');
    assert.doesNotMatch(clean.stdout, /grammar\/no-hand-rolled-keyword-regex/, clean.stdout + clean.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
