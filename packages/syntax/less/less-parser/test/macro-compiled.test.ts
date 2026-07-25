import { createServer } from 'vite';

test('canonical Less AST grammar macro-fuses recognition leaves with no runtime import', async () => {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: new URL('../vitest.config.ts', import.meta.url).pathname,

    /*
     * The compiler-facing entry imports the macro-linked parser and otherwise
     * leaves Vite's dependency optimizer waiting on a never-needed prebundle
     * during middleware-server shutdown.
     */
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true }
  });
  try {
    const transformed = await server.transformRequest('/src/ast/grammar.ts');
    expect(transformed?.code).not.toContain('@jesscss/parser-shared');
    expect(transformed?.code).not.toMatch(/\bcomposeLeaf\s*\(/);
  } finally {
    await server.close();
  }
});

test('compiler-facing Less entrypoint does not load the CST grammar', async () => {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: new URL('../vitest.config.ts', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
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
