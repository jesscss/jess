import { createServer } from 'vite';
import { run } from 'parseman';

function isGrammarModule(value: unknown): value is typeof import('../src/ast/grammar.js') {
  return typeof value === 'object' && value !== null && 'scssAstGrammar' in value;
}

test('canonical SCSS AST grammar macro-fuses recognition leaves with no runtime import', async () => {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: new URL('../vitest.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true }
  });
  try {
    const transformed = await server.transformRequest('/src/ast/grammar.ts');
    expect(transformed?.code).not.toContain('@jesscss/parser-shared');
    expect(transformed?.code).not.toMatch(/\bcomposeLeaf\s*\(/);

    const loaded = await server.ssrLoadModule('/src/ast/grammar.ts');
    if (!isGrammarModule(loaded)) {
      throw new Error('Expected coverage module to expose the SCSS AST grammar.');
    }
    const grammarModule = loaded;
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

test('compiler-facing SCSS entrypoint does not load the CST grammar', async () => {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: new URL('../vitest.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true }
  });
  try {
    const transformed = await server.transformRequest('/src/index.ts');
    expect(transformed?.code).not.toContain('./cst.js');
    expect(transformed?.code).not.toContain('./grammar.js');
  } finally {
    await server.close();
  }
});
