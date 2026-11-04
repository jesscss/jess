/*
 * Canaries for `pnpm check:guardrails` assertion 8 (scripts/grammar-guardrails.mjs).
 * Each rule must go red on a planted violation and stay green on a clean
 * grammar; the ratchet must report a new site and a removed one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareGrammarBaseline, grammarDefinitions, regexWidth, scanGrammarSource, MANY, PRODUCTIONS_FILE } from '../grammar-guardrails.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const ts = createRequire(import.meta.url)('@typescript/typescript6/lib/typescript.js');
const FILE = 'packages/syntax/demo/demo-parser/src/grammar.ts';

const scan = (source, base = new Map()) => scanGrammarSource(ts, FILE, source, base);
const rulesOf = (source, base) => scan(source, base).map(h => `${h.rule}:${h.const}`);

const CLEAN = String.raw`
import { choice, classifiedTrivia, keywords, literal, makeWord, node, noTrivia, not, optional, parser, peek, regex, rules, sequence, token, word, composeLeaf } from 'parseman' with { type: 'macro' };
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
  const base = grammarDefinitions(ts, 'base.ts', `const Narrow = literal('x'); const Wide = sequence(literal('a'), many(literal('b')));`);
  assert.deepEqual(rulesOf(planted(`const probe = not(g.Narrow);`), base), []);
  assert.deepEqual(rulesOf(planted(`const probe = not(g.Wide);`), base), ['lookahead:probe']);
});

test('lookahead: token() cannot declare whitespace or a scan to be one token', () => {
  assert.deepEqual(rulesOf(planted(String.raw`const probe = not(token(regex(/[-\w]+[ \t]*:/)));`)), ['lookahead:probe']);
  assert.deepEqual(rulesOf(planted(String.raw`const probe = not(token(regex(/[^;]*;/)));`)), ['lookahead:probe']);
  assert.deepEqual(rulesOf(planted(`const probe = not(token(sequence(literal('a'), trivia, literal('b'))));`)), ['lookahead:probe']);
});

test('dialect-prefix: a prefixed or Ast/Cst rule name is caught; a whole grammar export is not', () => {
  assert.deepEqual(rulesOf(planted(`const lessThing = literal('x');`)), ['dialect-prefix:lessThing']);
  assert.deepEqual(rulesOf(planted(`const ScssThing = literal('x');`)), ['dialect-prefix:ScssThing']);
  assert.deepEqual(rulesOf(planted(`const thingCst = literal('x');`)), ['dialect-prefix:thingCst']);
  assert.deepEqual(rulesOf(planted(`const T = node('JessThing', literal('x'));`)), ['dialect-prefix:T']);
  assert.deepEqual(rulesOf(planted(`const lessGrammar = composeLeaf([rules(factory)]);`)), []);
  assert.deepEqual(rulesOf(planted(`const lessonPlan = literal('x');`)), []);
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

test('ratchet: a new site is fresh, a removed one is stale, a moved one keeps its entry', () => {
  const entry = { rule: 'lookahead', file: FILE, line: 10, construct: 'not(x)', issue: 'jesscss/jess#1' };
  const moved = { rule: 'lookahead', file: FILE, line: 12, construct: 'not(x)' };
  const added = { rule: 'lookahead', file: FILE, line: 20, construct: 'not(y)' };
  const same = compareGrammarBaseline([moved], [entry]);
  assert.deepEqual(same.fresh, []);
  assert.deepEqual(same.stale, []);
  assert.deepEqual(same.kept, [{ ...entry, line: 12 }]);
  assert.deepEqual(compareGrammarBaseline([moved, added], [entry]).fresh, [added]);
  assert.deepEqual(compareGrammarBaseline([], [entry]).stale, [entry]);
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
