import { createServer } from 'vite';
import { run } from 'parseman';
import { fileURLToPath } from 'node:url';
import { scssGrammar } from '../src/grammar.js';

test('canonical SCSS grammar macro-fuses recognition leaves with no runtime import', async () => {
  /*
   * Two facts, transformed ONCE each. The macro-fusion is asserted on the CLIENT
   * transform (SSR externalizes `@jesscss/parser-shared` back into a runtime
   * `__vite_ssr_import__`, so only the client transform proves the runtime import
   * is gone). The grammar is then RUN via the ordinary static import above, which
   * vitest already macro-compiles — the sibling less/jess tests use exactly this.
   * The previous `ssrLoadModule('/src/grammar.ts')` macro-compiled the (largest)
   * grammar a SECOND time and SSR-loaded its whole dependency graph, which pushed
   * this test past the 30s default; the static import removes that second pass.
   */
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: fileURLToPath(new URL('../vitest.config.ts', import.meta.url)),
    server: { middlewareMode: true }
  });
  try {
    const transformed = await server.transformRequest('/src/grammar.ts');
    expect(transformed?.code).not.toContain('@jesscss/parser-shared');
    expect(transformed?.code).not.toMatch(/\bcomposeLeaf\s*\(/);
  } finally {
    await server.close();
  }

  const property = run(
    scssGrammar.Stylesheet,
    '@property --accent { syntax: "<color>"; inherits: false; }',
    { trivia: scssGrammar.whitespace }
  );
  expect(property.ok).toBe(true);
  expect(property.unconsumedFrom).toBeNull();
  expect(property.value).toMatchObject({
    type: 'Stylesheet',
    rules: [{ type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--accent' } }]
  });
});

test('compiler-facing SCSS entrypoint does not load the CST grammar', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: fileURLToPath(new URL('../vitest.config.ts', import.meta.url)),
    server: { middlewareMode: true }
  });
  try {
    const transformed = await server.transformRequest('/src/index.ts');
    expect(transformed?.code).not.toContain('./cst.js');
    expect(transformed?.code).not.toContain('./ast/grammar.js');
  } finally {
    await server.close();
  }
});
