import { createServer } from 'vite';
import { parseCst } from '@jesscss/css-parser/cst';
import { lessAstGrammar, lessCstGrammar, lessGrammar } from '../src/grammar.js';

function hasGrammarNode(value: unknown, grammarType: string): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record._tag !== 'node') {
    return false;
  }
  if (record.grammarType === grammarType) {
    return true;
  }
  return Array.isArray(record.rules) && record.rules.some(child => hasGrammarNode(child, grammarType));
}

test('canonical Less grammar is the AST artifact while CST remains explicit', () => {
  expect(lessGrammar).toBe(lessAstGrammar);
  expect(lessCstGrammar).not.toBe(lessGrammar);
  expect(lessGrammar.VarDeclaration).toBeDefined();
});

test('Less factory compiles and runs in CST host mode', () => {
  const result = parseCst(lessCstGrammar as Record<string, unknown>, '@color: red; .x { color: @color; }');

  expect(result.errors).toHaveLength(0);
  expect(result.unconsumedFrom).toBeNull();
  expect(result.tree.grammarType).toBe('Stylesheet');
  expect(result.tree.rules.some(child => child._tag === 'node' && child.grammarType === 'VarDeclaration')).toBe(true);
  expect(hasGrammarNode(result.tree, 'Ruleset')).toBe(true);
});

test('Less CST leaves detached binding semicolons at statement-list boundary', () => {
  const result = parseCst(lessCstGrammar as Record<string, unknown>, '@theme: { color: red; };');
  const [declaration, semicolon] = result.tree.rules;

  expect(result.errors).toHaveLength(0);
  expect(result.unconsumedFrom).toBeNull();
  expect(declaration?._tag).toBe('node');
  expect(declaration?._tag === 'node' ? declaration.grammarType : undefined).toBe('VarDeclaration');
  expect(semicolon).toMatchObject({ _tag: 'leaf', value: ';' });
});

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
    const transformed = await server.transformRequest('/src/grammar.ts');
    expect(transformed?.code).not.toContain('@jesscss/parser-shared');
    expect(transformed?.code).not.toMatch(/\bcomposeLeaf\s*\(/);
  } finally {
    await server.close();
  }
});

test('compiler-facing Less entrypoint does not load compatibility grammar shims', async () => {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: new URL('../vitest.config.ts', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
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
