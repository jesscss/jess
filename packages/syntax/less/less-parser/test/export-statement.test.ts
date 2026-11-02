import { describe, expect, it } from 'vitest';
import type { Statement } from '@jesscss/core/ast';
import { parse } from '@jesscss/less-parser';

/**
 * Ledger A4 (owner 2026-11-02): `@export brand, gap;` publishes root variables
 * by name; the `@` starts a read, so the names are bare. Whether it is at the
 * stylesheet's top level is evaluation's question, so a nested one still
 * parses (ledger P45).
 */
function exportOf(statement: Statement | undefined) {
  if (statement?.type !== 'VariableExport') {
    throw new TypeError(`expected a VariableExport, got ${statement?.type}`);
  }
  return statement;
}

describe('Less @export (A4)', () => {
  it.each(['@export', '@-export', '@EXPORT'])('reads %s brand; as an export of @brand', (keyword) => {
    expect(exportOf(parse(`${keyword} brand;`).rules[0]).names).toEqual(['brand']);
  });

  it('reads a comma-separated list of names', () => {
    expect(exportOf(parse('@export brand, gap-size,space;').rules[0]).names).toEqual(['brand', 'gap-size', 'space']);
  });

  it('leaves the variables it names plain declarations', () => {
    const [declared, exported] = parse('@brand: red;\n@export brand;').rules;
    expect(declared).toMatchObject({ type: 'VariableDeclaration', name: 'brand', write: { mode: 'declare' } });
    expect(exportOf(exported).names).toEqual(['brand']);
  });

  it.each(['@export { a: b }', 'a { @export 1px; }'])('keeps any other @export a generic at-rule: %s', (source) => {
    expect(parse(source).rules.some(rule => rule.type === 'VariableExport')).toBe(false);
  });

  it('rejects a variable read in the name list', () => {
    expect(() => parse('@export @brand: red;')).toThrow();
  });

  it('parses an @export written in a ruleset body', () => {
    const rule = parse('.a { @export n; }').rules[0];
    if (rule?.type !== 'Ruleset') {
      throw new TypeError('expected a ruleset');
    }
    expect(exportOf(rule.rules[0]).names).toEqual(['n']);
  });
});
