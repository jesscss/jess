import { describe, expect, it } from 'vitest';
import type { Statement } from '@jesscss/core/ast';
import { parse } from '@jesscss/less-parser';

/**
 * Ledger A20 (owner 2026-11-02): `@export brand, gap;` publishes root variables
 * by name; the `@` starts a read, so the names are bare. Whether it is at the
 * stylesheet's top level is evaluation's question, so a nested one still
 * parses (ledger P45). Both spellings read the same; any other shape after the
 * keyword is a located diagnostic, which a raw parse raises.
 */
function exportOf(statement: Statement | undefined) {
  if (statement?.type !== 'VariableExport') {
    throw new TypeError(`expected a VariableExport, got ${statement?.type}`);
  }
  return statement;
}

function namesOf(statement: Statement | undefined): string[] {
  return exportOf(statement).names.map(exported => exported.name);
}

const SPELLINGS = ['@export', '@-export'] as const;

describe('Less @export (A20)', () => {
  it.each([...SPELLINGS, '@EXPORT'])('reads %s brand; as an export of @brand', (keyword) => {
    expect(namesOf(parse(`${keyword} brand;`).rules[0])).toEqual(['brand']);
  });

  it('reads a comma-separated list of names, each located', () => {
    const exported = exportOf(parse('@export brand, gap-size,space;').rules[0]);
    expect(exported.names.map(n => [n.name, n._s, n._e])).toEqual([['brand', 8, 13], ['gap-size', 15, 23], ['space', 24, 29]]);
  });

  it('leaves the variables it names plain declarations', () => {
    const [declared, exported] = parse('@brand: red;\n@export brand;').rules;
    expect(declared).toMatchObject({ type: 'VariableDeclaration', name: 'brand', write: { mode: 'declare' } });
    expect(namesOf(exported)).toEqual(['brand']);
  });

  it('reads a name with an escape as the variable it declares', () => {
    expect(namesOf(parse('@br\\61nd: red;\n@export br\\61nd;').rules[1])).toEqual(['brand']);
  });

  it('reads a dashed name', () => {
    expect(namesOf(parse('@--x: 1;\n@export --x;').rules[1])).toEqual(['--x']);
  });

  it('ends at the closing brace of a body', () => {
    const rule = parse('.a { @export n }').rules[0];
    if (rule?.type !== 'Ruleset') {
      throw new TypeError('expected a ruleset');
    }
    expect(namesOf(rule.rules[0])).toEqual(['n']);
  });

  it('parses an @export written in a ruleset body', () => {
    const rule = parse('.a { @export n; }').rules[0];
    if (rule?.type !== 'Ruleset') {
      throw new TypeError('expected a ruleset');
    }
    expect(namesOf(rule.rules[0])).toEqual(['n']);
  });

  it.each(['@export: red;', '@-export: red;'])('keeps %s a variable declaration', (source) => {
    expect(parse(source).rules[0]).toMatchObject({ type: 'VariableDeclaration' });
  });

  describe.each(SPELLINGS)('%s', (keyword) => {
    it('reports the declaration form with the name-list spelling', () => {
      expect(() => parse(`${keyword} @brand: red;`)).toThrow(expect.objectContaining({
        code: 'parse/export-declaration',
        fix: 'Declare the variable, then export it by name: @brand: …; @export brand;'
      }));
    });

    it.each([
      'brand gap;',
      'brand,;',
      'brand: red;',
      'brand !important;',
      ';',
      '{ a: b }',
      'foo { color: red }',
      'foo bar { color: red }'
    ])('reports a malformed list: %s', (rest) => {
      expect(() => parse(`${keyword} ${rest}`.replace(' ;', ';'))).toThrow(expect.objectContaining({ code: 'parse/malformed-export', offset: 0 }));
    });

    it.each(['1x', '-'])('reports the name %s as a variable declaration would', (name) => {
      expect(() => parse(`${keyword} ${name};`)).toThrow(expect.objectContaining({ code: 'parse/unsupported-variable-name' }));
      expect(() => parse(`@${name}: 1;`)).toThrow(expect.objectContaining({ code: 'parse/unsupported-variable-name' }));
    });
  });
});
