import * as G from '../src/grammar.js';
import { createServer } from 'vite';
import { compiledGrammarCoverageDefinitions, createGrammarCoverageCollector, createGrammarInstrumentationContext, run } from 'parseman';
import { cssAstGrammar, cssCstGrammar } from '../src/grammar.js';
import { parseCst } from '../src/cst.js';
import { parseCssCst } from '../src/cst-css.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
test('grammar is macro-compiled (not interpreted) under vitest', () => {
  // compiled rules are plain functions; interpreted ones are Combinator objects
  expect(typeof G.Stylesheet).toBe('function');
  expect(typeof G.Ruleset).toBe('function');
  expect('_def' in G.Stylesheet).toBe(false);
  expect('parse' in G.Stylesheet).toBe(false);
});

type CssGrammarModule = Pick<typeof import('../src/grammar.js'), 'cssAstGrammar'>;

function isCssGrammarModule(value: unknown): value is CssGrammarModule {
  return typeof value === 'object'
    && value !== null
    && 'cssAstGrammar' in value
    && typeof value.cssAstGrammar === 'object'
    && value.cssAstGrammar !== null;
}

function containsNode(value: unknown, predicate: (value: Record<string, unknown>) => boolean): boolean {
  if (Array.isArray(value)) {
    return value.some(child => containsNode(child, predicate));
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return predicate(record)
    || Object.values(record).some(child => containsNode(child, predicate));
}

test('canonical AST grammar macro-fuses the recognition artifact with no runtime import', async () => {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: new URL('../vitest.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true }
  });
  try {
    const transformed = await server.transformRequest('/src/grammar.ts');
    expect(transformed?.code).not.toContain('@jesscss/parser-shared');
    expect(transformed?.code).not.toContain('from \'../grammar.js\'');
    expect(transformed?.code).not.toMatch(/\bcomposeLeaf\s*\(/);
  } finally {
    await server.close();
  }
});

test('canonical CSS factory lowers as a positioned CST artifact', () => {
  const result = parseCst(
    cssCstGrammar as Record<string, unknown>,
    'a { color: red; }'
  );

  expect(result.errors).toHaveLength(0);
  expect(result.unconsumedFrom).toBeNull();
  expect(result.tree.type).toBe('StyleSheet');
  expect(containsNode(result.tree, value => value.type === 'QualifiedRule')).toBe(true);
});

test('coverage-enabled macro CSS reports structural grammar coverage across public fixtures', async () => {
  const server = await createServer({
    root: new URL('../../../../..', import.meta.url).pathname,
    configFile: false,
    plugins: [(await import('parseman/plugin')).default.vite({ grammarCoverage: true })],
    server: { middlewareMode: true }
  });
  try {
    const covered: unknown = await server.ssrLoadModule('/packages/syntax/css/css-parser/src/grammar.ts');
    if (!isCssGrammarModule(covered)) {
      throw new TypeError('expected the Vite module to expose cssAstGrammar');
    }
    const stylesheetRule = covered.cssAstGrammar.Stylesheet;
    if (!stylesheetRule) {
      throw new TypeError('expected cssAstGrammar to expose Stylesheet');
    }
    const definitions = compiledGrammarCoverageDefinitions(covered.cssAstGrammar);
    const collector = createGrammarCoverageCollector(definitions);
    const fixtureRoot = join(import.meta.dirname, 'css');
    for (const filename of readdirSync(fixtureRoot).filter(name => name.endsWith('.css'))) {
      const result = run(stylesheetRule, readFileSync(join(fixtureRoot, filename), 'utf8'), {
        trivia: covered.cssAstGrammar.whitespace,
        instrumentation: createGrammarInstrumentationContext({ collector })
      });
      expect(result.ok && result.unconsumedFrom === null, filename).toBe(true);
    }
    const coverage = collector.snapshot();
    expect(coverage.definitions.length).toBeGreaterThan(0);
    expect(coverage.hits.length).toBeGreaterThan(0);
    expect(coverage.ratio).toBeGreaterThan(0);

    /*
     * Keep the corpus proof separate from this focused probe: the concrete
     * import URL reaches exactly its two grammar-owned URL rules.
     */
    const importResult = run(stylesheetRule, '@import url(/* before */ theme.css /* after */);', {
      trivia: covered.cssAstGrammar.whitespace,
      instrumentation: createGrammarInstrumentationContext({ collector })
    });
    expect(importResult.ok && importResult.unconsumedFrom === null).toBe(true);
    const importCoverage = collector.snapshot();
    expect(importCoverage.hits.filter(id => !coverage.hits.includes(id))).toEqual([
      'rule:ImportUrl',
      'rule:ImportUrlUnquoted'
    ]);
  } finally {
    await server.close();
  }
});

test('macro-compiled declaration extension keeps calc on the strict route', () => {
  for (const source of ['.a { x: (foo); }', '.a { x: 1 / 2; }', '.a { filter: alpha(opacity=50); }', '.a { x: foo|bar; }', '.a { x: 1e3px; y: calc(.5E1px + 2px); }', '.a { remainder: calc(5px % 2); }', '.a { offset: 0 calc(-1 * var(--x)); }']) {
    const cst = parseCssCst(source);
    const direct = run(cssAstGrammar.Stylesheet, source, { trivia: cssAstGrammar.whitespace });
    expect(cst.errors, source).toHaveLength(0);
    expect(cst.unconsumedFrom, source).toBeNull();
    expect(direct.ok && direct.unconsumedFrom === null && direct.value?.type === 'Stylesheet', source).toBe(true);
  }
  for (const source of ['.a { width: calc(); }', '.a { width: calc(+); }', '.a { width: 0 calc(); }', '.a { width: 0 calc(+); }']) {
    const direct = run(cssAstGrammar.Stylesheet, source, { trivia: cssAstGrammar.whitespace });
    expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
  }
});

test('macro-compiled calc keeps balanced var fallback components structured', () => {
  const source = '.a { x: calc(var(--x, (foo) [foo]) + 2px); y: calc(var(--x, foo, bar) + 2px); z: calc(var(--x, foo([bar])) + 2px); w: calc(var(--x, {foo}) + 2px); nested: calc(var(--x, var(--y, a, b)) + 2px); empty: calc(var(--x,) + 2px); trailing: calc(var(--x, foo,) + 2px); genericTrailing: calc(var(--x, foo(a,)) + 2px); genericLeading: calc(var(--x, foo(,a)) + 2px); interior: calc(var(--x, a,,b) + 2px); validBracket: calc(var(--x, [a(b)c]) + 2px); validBrace: calc(var(--x, {a[b]c}) + 2px); }';
  const direct = run(cssAstGrammar.Stylesheet, source, { trivia: cssAstGrammar.whitespace });
  expect(direct.ok && direct.unconsumedFrom === null && direct.value?.type === 'Stylesheet').toBe(true);
});

test('macro-compiled calc rejects crossing fallback block delimiters', () => {
  for (const source of [
    '.a { x: calc(var(--x, [a(b]c)]) + 2px); }',
    '.a { x: calc(var(--x, {a[b}c]}) + 2px); }',
    '.a { x: calc(var(--x, [a(b]) + 2px); }',
    '.a { x: calc(var(--x, {a[b}) + 2px); }'
  ]) {
    const direct = run(cssAstGrammar.Stylesheet, source, { trivia: cssAstGrammar.whitespace });
    expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
  }
});

test('macro-compiled calc accepts every adjacent fallback-block pair and rejects every crossed pair', () => {
  for (const fallback of ['([a])', '({a})', '[(a)]', '[{a}]', '{(a)}', '{[a]}', '[a(b)]', '{a[b]}']) {
    const source = `.a { x: calc(var(--x, ${fallback}) + 2px); }`;
    const direct = run(cssAstGrammar.Stylesheet, source, { trivia: cssAstGrammar.whitespace });
    expect(direct.ok && direct.unconsumedFrom === null && direct.value?.type === 'Stylesheet', fallback).toBe(true);
  }
  for (const fallback of ['([a)]', '({a)}', '[(a])', '[{a]}', '{(a})', '{[a}]', '([a]', '[(a)', '{[a]']) {
    const source = `.a { x: calc(var(--x, ${fallback}) + 2px); }`;
    const direct = run(cssAstGrammar.Stylesheet, source, { trivia: cssAstGrammar.whitespace });
    expect(direct.ok && direct.unconsumedFrom === null, fallback).toBe(false);
  }
});

test('macro-compiled direct selector closure matches public CST acceptance', () => {
  for (const source of [
    '[data-role="button" i] { color: red; }',
    ':is(.card, :not(.disabled), :has(.icon > svg)) { color: red; }',
    ':nth-child(2n + 1 of :is(.card, .tile)) { color: red; }',
    '50% { color: red; }'
  ]) {
    const cst = parseCssCst(source);
    const direct = run(cssAstGrammar.Stylesheet, source, { trivia: cssAstGrammar.whitespace });
    expect(cst.errors, source).toHaveLength(0);
    expect(cst.unconsumedFrom, source).toBeNull();
    expect(direct.ok && direct.unconsumedFrom === null && direct.value?.type === 'Stylesheet', source).toBe(true);
  }
});

test('macro-compiled comment-delimited url identifiers are not url or function tokens', () => {
  const source = '.asset { background: url/* name-open */(icon.svg); }';
  const cst = parseCssCst(source);
  const direct = run(cssAstGrammar.Stylesheet, source, { trivia: cssAstGrammar.whitespace });
  expect(cst.errors).toHaveLength(0);
  expect(cst.unconsumedFrom).toBeNull();
  expect(direct.ok && direct.unconsumedFrom === null && direct.value?.type === 'Stylesheet').toBe(true);
  expect(containsNode(direct.value, value => value.type === 'Url')).toBe(false);
  expect(containsNode(direct.value, value => value.type === 'FunctionCall' && value.name === 'url')).toBe(false);

  for (const invalid of [
    '.asset { background: url(foo bar); }'
  ]) {
    const result = run(cssAstGrammar.Stylesheet, invalid, { trivia: cssAstGrammar.whitespace });
    expect(result.ok && result.unconsumedFrom === null, invalid).toBe(false);
  }
});

test('macro-compiled direct query functions match public CST acceptance', () => {
  const source = '@container sidebar style(--theme: dark) and scroll-state(stuck: block-start) { .card { color: red; } }';
  const cst = parseCssCst(source);
  const direct = run(cssAstGrammar.Stylesheet, source, { trivia: cssAstGrammar.whitespace });
  expect(cst.errors).toHaveLength(0);
  expect(cst.unconsumedFrom).toBeNull();
  expect(direct.ok && direct.unconsumedFrom === null && direct.value?.type === 'Stylesheet').toBe(true);
});
