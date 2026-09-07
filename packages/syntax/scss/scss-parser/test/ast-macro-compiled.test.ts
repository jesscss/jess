import { createServer } from 'vite';
import { run } from 'parseman';
import { fileURLToPath } from 'node:url';
import { scssGrammar } from '../src/grammar.js';

/*
 * The SCSS grammar is the largest of the four, and this test macro-compiles it
 * from source (the point: prove the fusion emits no runtime `parser-shared`
 * import). The fusion is asserted on the CLIENT transform — SSR mode externalizes
 * `@jesscss/parser-shared` back into a runtime `__vite_ssr_import__`, so only the
 * client transform proves the import is gone — and the grammar is RUN via the
 * ordinary static import above, which vitest already macro-compiles (the sibling
 * less/jess tests do exactly this). This replaced a second `ssrLoadModule` pass
 * that macro-compiled the grammar again and SSR-loaded its whole dependency graph.
 *
 * A single cold macro-compile of this grammar is ~7s locally but ~30s on the CI
 * runner, so the timeout is raised well above the 30s default: the cost is the
 * one transform, not a hang. Making it genuinely fast on CI would require
 * speeding the macro-compile plugin itself (tracked separately).
 */
test('canonical SCSS grammar macro-fuses recognition leaves with no runtime import', async () => {
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
}, 120_000);

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
