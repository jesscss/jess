import { parseCst } from '@jesscss/css-parser/cst';
import { lessCstGrammar, lessGrammar } from '../src/grammar.js';

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

test('canonical Less grammar is the default artifact while CST remains explicit', () => {
  expect(lessCstGrammar).not.toBe(lessGrammar);
  expect(lessGrammar.VarDeclaration).toBeDefined();
});

test('Less factory compiles and runs in CST host mode', () => {
  const result = parseCst(lessCstGrammar as Record<string, unknown>, '@color: red; .x { color: @color; }');

  expect(result.errors).toHaveLength(0);
  expect(result.unconsumedFrom).toBeNull();
  expect(result.tree.grammarType).toBe('Stylesheet');
  expect(result.tree.rules.some(child => child._tag === 'node' && child.grammarType === 'VariableDeclaration')).toBe(true);
  expect(hasGrammarNode(result.tree, 'Ruleset')).toBe(true);
});

test('Less CST leaves detached binding semicolons at statement-list boundary', () => {
  const result = parseCst(lessCstGrammar as Record<string, unknown>, '@theme: { color: red; };');
  const [declaration, semicolon] = result.tree.rules;

  expect(result.errors).toHaveLength(0);
  expect(result.unconsumedFrom).toBeNull();
  expect(declaration?._tag).toBe('node');
  expect(declaration?._tag === 'node' ? declaration.grammarType : undefined).toBe('VariableDeclaration');
  expect(semicolon).toMatchObject({ _tag: 'leaf', value: ';' });
});
