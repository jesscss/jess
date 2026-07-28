import { createServer } from 'vite';
import { run } from 'parseman';
import { parseJessCst } from '../src/cst.js';
import { jessAstGrammar } from '../src/grammar.js';

test('canonical Jess AST grammar macro-fuses recognition with no runtime import', async () => {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: new URL('../../../../../vitest.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true }
  });
  try {
    const transformed = await server.transformRequest('/src/grammar.ts');
    expect(transformed?.code).not.toContain('@jesscss/parser-shared');
    expect(transformed?.code).not.toMatch(/\bcomposeLeaf\s*\(/);
    expect(transformed?.code).toContain('DirectJessStaticPseudoArgument');
    expect(transformed?.code).toContain('DirectJessGuardCall');
    expect(transformed?.code).toContain('DirectJessDollarValue');
    expect(transformed?.code).toContain('DirectJessUnwrappedProductRest');
    expect(transformed?.code).toContain('DirectJessCallComponent');
    expect(transformed?.code).toContain('CssImportTarget');
    expect(transformed?.code).toContain('CssSyntaxStaticUrlInner');
  } finally {
    await server.close();
  }
});

test('macro-compiled Jess call components retain modern CSS slash separators structurally', () => {
  const valid = '.card { box-shadow: rgb(15 23 42 / 0.22); }';
  const cst = parseJessCst(valid);
  const direct = run(jessAstGrammar.JessAstDocument, valid, { trivia: jessAstGrammar.whitespace });
  expect(cst.errors).toHaveLength(0);
  expect(cst.unconsumedFrom).toBeNull();
  expect(direct.ok && direct.unconsumedFrom === null && direct.value?.type === 'Stylesheet').toBe(true);

  for (const invalid of [
    '.card { color: rgb(/ 0.22); }',
    '.card { color: rgb(15 23 42 /); }',
    '.card { color: rgb(15 23 42 / 0.22 / 1); }'
  ]) {
    const cst = parseJessCst(invalid);
    const result = run(jessAstGrammar.JessAstDocument, invalid, { trivia: jessAstGrammar.whitespace });
    expect(cst.errors.length + Number(cst.unconsumedFrom !== null), invalid).toBeGreaterThan(0);
    expect(result.ok && result.unconsumedFrom === null, invalid).toBe(false);
  }
});
