import { describe, expect, it } from 'vitest';
import type { Statement } from '@jesscss/core/ast';
import { parse } from '@jesscss/less-parser';

/**
 * Ledger A4 (owner 2026-11-01): `@export` publishes a root variable. The
 * declaration is the ordinary `VariableDeclaration`, written with the `export`
 * mode; whether it is at the stylesheet's top level is evaluation's question,
 * so a nested one still parses (ledger P45).
 */
function declarationOf(statement: Statement | undefined) {
  if (statement?.type !== 'VariableDeclaration') {
    throw new TypeError(`expected a VariableDeclaration, got ${statement?.type}`);
  }
  return statement;
}

describe('Less @export (A4)', () => {
  it.each(['@export', '@-export', '@EXPORT'])('reads %s @brand: red; as an exported declaration', (keyword) => {
    const declaration = declarationOf(parse(`${keyword} @brand: red;`).rules[0]);
    expect(declaration.name).toBe('brand');
    expect(declaration.write).toEqual({ mode: 'export' });
    expect(declaration.value).toMatchObject({ type: 'Keyword', src: 'red' });
  });

  it('leaves a plain declaration beside it a plain declaration', () => {
    const [exported, plain] = parse('@export @a: 1px;\n@b: @a;').rules;
    expect(declarationOf(exported).write.mode).toBe('export');
    expect(declarationOf(plain).write.mode).toBe('declare');
  });

  it.each(['@export foo;', '@export { a: b }', 'a { @export foo; }'])('keeps any other @export a generic at-rule: %s', (source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('parses an @export written in a ruleset body', () => {
    const rule = parse('.a { @export @n: x; }').rules[0];
    if (rule?.type !== 'Ruleset') {
      throw new TypeError('expected a ruleset');
    }
    expect(declarationOf(rule.rules[0]).write.mode).toBe('export');
  });
});
