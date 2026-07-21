import { createServer } from 'vite';
import { run } from 'parseman';

test('canonical SCSS AST grammar macro-fuses recognition leaves with no runtime import', async () => {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: new URL('../vitest.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true }
  });
  try {
    const transformed = await server.transformRequest('/src/ast/grammar.ts');
    expect(transformed?.code).not.toContain('@jesscss/internal-css-recognition');
    expect(transformed?.code).not.toMatch(/\bcomposeLeaf\s*\(/);

    const grammarModule = await server.ssrLoadModule('/src/ast/grammar.ts') as typeof import('../src/ast/grammar.js');
    const property = run(
      grammarModule.scssAstGrammar.ScssAstDocument,
      '@property --accent { syntax: "<color>"; inherits: false; }',
      { trivia: grammarModule.scssAstGrammar.whitespace }
    );
    expect(property.ok).toBe(true);
    expect(property.unconsumedFrom).toBeNull();
    expect(property.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--accent' } }]
    });
  } finally {
    await server.close();
  }
});
