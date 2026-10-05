import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

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
