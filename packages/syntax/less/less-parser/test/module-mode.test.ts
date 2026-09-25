import { describe, expect, it } from 'vitest';
import type { FunctionCall, Stylesheet } from '@jesscss/core/ast';
import { hasAmbientFunctions } from '../../../../core/src/ast/provenance.js';
import { parse } from '@jesscss/less-parser';

/**
 * Ledger P36: the grammar decides, per document, whether Less built-ins are
 * ambient, and every call it builds shares that one answer.
 */
function calls(sheet: Stylesheet): FunctionCall[] {
  const found: FunctionCall[] = [];
  for (const rule of sheet.rules) {
    if (rule.type !== 'Ruleset') {
      continue;
    }
    for (const declaration of rule.rules) {
      if (declaration.type === 'Declaration' && !Array.isArray(declaration.value) && declaration.value.type === 'FunctionCall') {
        found.push(declaration.value);
      }
    }
  }
  return found;
}

describe('Less module mode (P36)', () => {
  it('leaves built-ins ambient in a document with no module directive', () => {
    const [call] = calls(parse('a { b: min(1px, 2px); }'));
    expect(call && hasAmbientFunctions(call)).toBe(true);
  });

  it.each(['@use "x";', '@-use "x";', '@compose "x";', '@-compose "x";', '.w { @compose "x"; }'])(
    'closes them for every call in a document that writes %s',
    (directive) => {
      const found = calls(parse(`a { b: min(1px, 2px); }\n${directive}\nc { d: darken(red, 1%); }`));
      expect(found).toHaveLength(2);
      expect(found.map(hasAmbientFunctions)).toEqual([false, false]);
      expect(found[0]!._fnScope).toBe(found[1]!._fnScope);
    }
  );

  it('closes them in every document under moduleMode: modern', () => {
    const [call] = calls(parse('a { b: min(1px, 2px); }', { moduleMode: 'modern' }));
    expect(call && hasAmbientFunctions(call)).toBe(false);
  });

  it('keeps the parsed call on a lowered if()/boolean(), sharing the document scope', () => {
    const rule = parse('a { b: if( @x ,1px, 2px); c: boolean(@x); d: min(1px, 2px); }').rules[0];
    if (rule?.type !== 'Ruleset') {
      throw new TypeError('expected a ruleset');
    }
    const values = rule.rules.map(d => (d.type === 'Declaration' && !Array.isArray(d.value) ? d.value : undefined));
    const [ifValue, booleanValue, minValue] = values;
    expect(ifValue?.type).toBe('IfValue');
    expect(booleanValue?.type).toBe('Expression');
    const asCall = ifValue?.type === 'IfValue' ? ifValue._asCall : null;
    expect(asCall?.name).toBe('if');

    // The ordinary parsed call, not a copy of its bytes: its arguments are the lowered branches' own nodes.
    expect(asCall?.args).toHaveLength(3);
    expect(ifValue?.type === 'IfValue' ? ifValue.branches[0].value : undefined).toBe(asCall?.args[1]?.value);
    expect(booleanValue?.type === 'Expression' ? booleanValue._asCall?.name : undefined).toBe('boolean');
    expect(minValue?.type === 'FunctionCall' ? minValue._fnScope : undefined).toBe(asCall?._fnScope);
  });

  it('does not treat a legacy @import as a module directive', () => {
    const [call] = calls(parse('@import "x";\na { b: min(1px, 2px); }'));
    expect(call && hasAmbientFunctions(call)).toBe(true);
  });
});
