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
import {
  addedBaselineEntries, ANY_SOURCE, compareGrammarBaseline, GRAMMAR_SOURCE, grammarDefinitions, MANY, NOT_A_GRAMMAR,
  parsemanCombinatorImports, PRODUCTIONS_FILE, regexWidth, scanGrammarSource
} from '../grammar-guardrails.mjs';

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

test('regex(): a one-character boundary check and plain multi-token consumption pass', () => {
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
  assert.deepEqual(imports(`const n = not;`), ['parseman-import']);
  assert.deepEqual(imports(`const r = regex;`), ['parseman-import']);
  assert.deepEqual(imports(`const o = { attempt };`), ['parseman-import']);
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
});

test('coverage: every source extension is scanned; a combinator imported elsewhere is found', () => {
  for (const ext of ['ts', 'mts', 'cts', 'tsx', 'js', 'mjs']) {
    assert.equal(GRAMMAR_SOURCE.test(`packages/syntax/less/less-parser/src/thing.${ext}`), true, ext);
    assert.equal(ANY_SOURCE.test(`packages/core/src/thing.${ext}`), true, ext);
  }
  assert.equal(GRAMMAR_SOURCE.test('packages/parser-shared/src/thing.d.ts'), false);
  assert.equal(GRAMMAR_SOURCE.test('packages/parser-shared/src/thing.test.ts'), false);
  assert.equal(GRAMMAR_SOURCE.test('packages/core/src/thing.ts'), false);
  assert.deepEqual(scanGrammarSource(ts, 'packages/parser-shared/src/thing.tsx', `const probe = not(many(a));`).map(h => h.rule), ['lookahead']);
  assert.equal(NOT_A_GRAMMAR.test('packages/core/src/grammar.ts'), false);
  assert.equal(NOT_A_GRAMMAR.test('packages/syntax/less/less-parser/test/a.ts'), true);
  assert.equal(NOT_A_GRAMMAR.test('tools/grammar-tournament/src/coverage.mjs'), true);

  assert.deepEqual(parsemanCombinatorImports(`import { not, literal as l, parse } from 'parseman';`), ['not', 'literal']);
  assert.deepEqual(parsemanCombinatorImports(`import * as pm from 'parseman';`), ['* from parseman']);
  assert.deepEqual(parsemanCombinatorImports(`export { not } from 'parseman';`), ['not']);
  assert.deepEqual(parsemanCombinatorImports(`const pm = await import('parseman');`), ['dynamic parseman']);
  assert.deepEqual(parsemanCombinatorImports(`import parseman from 'parseman/plugin';`), []);
  assert.deepEqual(parsemanCombinatorImports(`import type { Combinator } from 'parseman';`), []);
  assert.deepEqual(parsemanCombinatorImports(`import { DIGEST_FORMAT } from 'parseman/oracle';`), []);
  assert.deepEqual(parsemanCombinatorImports(`import { not } from './mine.js';`), []);
});

test('ratchet: widening what a baselined lookahead resolves to fails, though its call text is the same', () => {
  const source = regex => `${CLEAN}\nconst wide = regex(${regex});\nconst probe = not(wide);\n`;
  const before = scan(source(String.raw`/[-\w]+[ \t]*:/`));
  const after = scan(source(String.raw`/[^;{}]*[;{]/`));
  assert.equal(before[0].construct, after[0].construct);
  const { fresh, stale } = compareGrammarBaseline(after, before);
  assert.equal(fresh.length, 1);
  assert.equal(stale.length, 1);
  assert.deepEqual(compareGrammarBaseline(before, before).fresh, []);
});

test('ratchet: widening a baselined sequence fails too', () => {
  const source = args => `${CLEAN}\nconst wide = sequence(${args});\nconst probe = not(wide);\n`;
  const { fresh } = compareGrammarBaseline(scan(source(`literal('a'), literal('b'), literal('c')`)), scan(source(`literal('a'), literal('b')`)));
  assert.equal(fresh.length, 1);
});

test('shrink-only: an added entry, a repeat of one, or an added undocumented rule is reported; a removal is not', () => {
  const entry = { rule: 'lookahead', file: FILE, construct: 'not(x)', resolved: 'aaa' };
  const base = { entries: [entry], undocumentedRules: { [FILE]: ['Rule'] } };
  assert.deepEqual(addedBaselineEntries(base, base), []);
  assert.deepEqual(addedBaselineEntries(base, { entries: [], undocumentedRules: {} }), []);
  assert.deepEqual(addedBaselineEntries(base, { ...base, entries: [{ ...entry, line: 99 }] }), []);
  assert.equal(addedBaselineEntries(base, { ...base, entries: [entry, { ...entry, construct: 'not(y)' }] }).length, 1);
  assert.equal(addedBaselineEntries(base, { ...base, entries: [entry, entry] }).length, 1);
  assert.equal(addedBaselineEntries(base, { ...base, entries: [{ ...entry, resolved: 'bbb' }] }).length, 1);
  const added = addedBaselineEntries(base, { ...base, undocumentedRules: { [FILE]: ['Rule', 'Other'] } });
  assert.deepEqual(added.map(e => e.construct), ['Other']);
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
