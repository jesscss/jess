import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import type { Statement } from '@jesscss/core/ast';
import { parse } from '../src/index.js';

/**
 * Ledger A1 and A20: `.jess` spells the browser-runtime statement `@-expose`,
 * with the dash, and lists bare names (`@-expose brand, gap;`) of variables
 * declared as `$brand: …;`. The `$` starts a read, as Less's `@` does, so
 * `.less` to `.jess` renames only the keyword. Whether it is at the top level
 * is evaluation's question, so a nested one still parses (P45); any other shape
 * after the keyword is a located diagnostic, which a raw parse raises.
 */
function exposeOf(statement: Statement | undefined) {
  if (statement?.type !== 'VariableExpose') {
    throw new TypeError(`expected a VariableExpose, got ${statement?.type}`);
  }
  return statement;
}

function namesOf(statement: Statement | undefined): string[] {
  return exposeOf(statement).names.map(exposed => exposed.name);
}

describe('.jess @-expose (A20)', () => {
  it.each(['@-expose', '@-EXPOSE'])('reads %s brand; as exposing $brand', (keyword) => {
    expect(namesOf(parse(`${keyword} brand;`).rules[0])).toEqual(['brand']);
  });

  it('reads a comma-separated list of names, each located', () => {
    const exposed = exposeOf(parse('@-expose brand, gap-size,space;').rules[0]);
    expect(exposed.names.map(n => [n.name, n._s, n._e])).toEqual([['brand', 9, 14], ['gap-size', 16, 24], ['space', 25, 30]]);
  });

  it('leaves the variables it names plain declarations', () => {
    const [declared, exposed] = parse('$brand: red;\n@-expose brand;').rules;
    expect(declared).toMatchObject({ type: 'VariableDeclaration', name: 'brand', write: { mode: 'declare' } });
    expect(namesOf(exposed)).toEqual(['brand']);
  });

  it('needs no semicolon at the end of the stylesheet or of a body', () => {
    expect(namesOf(parse('@-expose brand').rules[0])).toEqual(['brand']);
    const rule = parse('.a { @-expose n }').rules[0];
    expect(rule?.type === 'Ruleset' ? namesOf(rule.rules[0]) : []).toEqual(['n']);
  });

  it.each([
    ['a ruleset', '.a { @-expose n; }'],
    ['an at-rule', '@media print { @-expose n; }'],
    ['a mixin', '.m() { @-expose n; }']
  ])('parses an @-expose written in %s', (_where, source) => {
    const rule = parse(source).rules[0];
    expect(rule !== undefined && 'rules' in rule && Array.isArray(rule.rules) ? namesOf(rule.rules[0]) : []).toEqual(['n']);
  });

  it('may precede a CSS @import', () => {
    expect(parse('@-expose brand;\n@import url(x.css);').rules.map(rule => rule.type)).toEqual(['VariableExpose', 'AtRuleStatement']);
  });

  it.each(['@expose brand;', '@-exposed brand;'])('keeps %s a generic at-rule, as other undashed or longer names are', (source) => {
    expect(parse(source).rules[0]).toMatchObject({ type: 'AtRuleStatement' });
  });

  it('reports the declaration form with the name-list spelling', () => {
    expect(() => parse('@-expose $brand: red;')).toThrow(expect.objectContaining({
      code: 'parse/expose-declaration',
      offset: 0,
      fix: 'Declare the variable, then expose it by name: $brand: …; @-expose brand;'
    }));
  });

  it.each([
    '$brand;',
    'brand gap;',
    'brand,;',
    'brand: red;',
    ': red;',
    'brand !important;',
    ';',
    '{ a: b }',
    'foo { color: red }'
  ])('reports a malformed list: %s', (rest) => {
    expect(() => parse(`@-expose ${rest}`.replace(' ;', ';'))).toThrow(expect.objectContaining({
      code: 'parse/malformed-expose',
      offset: 0,
      fix: 'Write the names it exposes, for example: @-expose brand, gap;'
    }));
  });

  it.each(['a\\;b', 'a\\}b'])('reads past an escaped terminator in a malformed list: %s', (rest) => {
    expect(() => parse(`@-expose ${rest};`)).toThrow(expect.objectContaining({ code: 'parse/malformed-expose', offset: 0 }));
    expect(() => parse(`@-expose ${rest};\n.x { c: d }`)).toThrow(expect.objectContaining({ code: 'parse/malformed-expose' }));
  });

  it('prints back as the statement it parsed from', () => {
    const source = '$brand: red;\n$gap: 1px;\n@-expose brand, gap;\n';
    expect(emitJess(parse(source))).toBe(source);
  });
});
