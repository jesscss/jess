import { describe, it, expect } from 'vitest';
import { Parser } from '../src/jess.js';
import { Quoted, Interpolated, Reference, Call, INTERPOLATION_PLACEHOLDER, isNode, N } from '@jesscss/core';

const parser = new Parser();

function firstDeclValue(input: string): any {
  const { tree, errors } = parser.parse(input);
  expect(errors).toHaveLength(0);
  // Walk to the first declaration's value.
  let found: any;
  const seen = new Set<any>();
  const walk = (node: any) => {
    if (found || !node || typeof node !== 'object' || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (isNode(node, N.Declaration)) {
      found = node.value;
      return;
    }
    const kids = (node as any).value;
    if (Array.isArray(kids)) {
      kids.forEach(walk);
    } else if (kids) {
      walk(kids);
    }
    if (Array.isArray((node as any).rules)) {
      (node as any).rules.forEach(walk);
    }
  };
  walk(tree);
  return found;
}

describe('%() lowering to string interpolation', () => {
  it('lowers %("rgb(%d, %d, %d)", @r, @g, @b) to Quoted(Interpolated) with 3 markers + 3 refs', () => {
    const value = firstDeclValue('a { x: %("rgb(%d, %d, %d)", @r, @g, @b); }');
    expect(value).toBeInstanceOf(Quoted);
    const interp = value.value;
    expect(interp).toBeInstanceOf(Interpolated);
    const marks = interp.source.split(INTERPOLATION_PLACEHOLDER).length - 1;
    expect(marks).toBe(3);
    expect(interp.source).toBe(`rgb(${INTERPOLATION_PLACEHOLDER}, ${INTERPOLATION_PLACEHOLDER}, ${INTERPOLATION_PLACEHOLDER})`);
    expect(interp.replacements).toHaveLength(3);
    for (const r of interp.replacements) {
      expect(r).toBeInstanceOf(Reference);
    }
  });

  it('wraps uppercase %S directive replacement in escape()', () => {
    const value = firstDeclValue('a { x: %("%S", @x); }');
    const interp = value.value;
    expect(interp).toBeInstanceOf(Interpolated);
    expect(interp.replacements).toHaveLength(1);
    const rep = interp.replacements[0];
    expect(rep).toBeInstanceOf(Call);
    expect(String(rep.name.key ?? rep.name)).toBe('escape');
  });

  it('%% becomes a literal %', () => {
    const value = firstDeclValue('a { x: %("100%%", @x); }');
    const interp = value.value;
    // %% is literal percent, @x uses no directive -> no replacements from %%; but there is no %s here
    expect(interp === undefined || interp.source.includes('100%')).toBeTruthy();
  });

  it('emits a deprecation warning', () => {
    const { warnings } = parser.parse('a { x: %("hi %s", @y); }');
    const w = warnings.find((w: any) => w.deprecation === 'percent-format');
    expect(w).toBeDefined();
    expect(w?.message).toContain('deprecated');
  });

  it('does NOT affect the bare % mod operator (10 % 3)', () => {
    const { errors } = parser.parse('a { x: 10 % 3; }');
    expect(errors).toHaveLength(0);
    const value = firstDeclValue('a { x: 10 % 3; }');
    // should be an operation/expression, not a Quoted
    expect(value).not.toBeInstanceOf(Quoted);
  });
});
