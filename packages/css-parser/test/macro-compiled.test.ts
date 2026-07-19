import * as G from '../src/grammar.js';
import { createServer } from 'vite';
test('grammar is macro-compiled (not interpreted) under vitest', () => {
  // compiled rules are plain functions; interpreted ones are Combinator objects
  expect(typeof G.Stylesheet).toBe('function');
  expect(typeof G.Ruleset).toBe('function');
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  expect((G.Stylesheet as any)._def).toBeUndefined();
  expect((G.Stylesheet as any).parse).toBeUndefined();
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
});

test('private AST grammar macro-fuses the recognition artifact with no runtime import', async () => {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: new URL('../vitest.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true }
  });
  try {
    const transformed = await server.transformRequest('/src/ast/grammar.ts');
    expect(transformed?.code).not.toContain('@jesscss/internal-css-recognition');
    expect(transformed?.code).not.toMatch(/\bcomposeLeaf\s*\(/);
  } finally {
    await server.close();
  }
});
