import { describe, it, expect } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parse } from '../src/index.js';

const render = (source: string): string | undefined =>
  serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css;

describe('jess `::=` optional-shadow assignment', () => {
  it('parses `::=` as reassign-or-declare, distinct from `:` / `:=` / `?:`, for `$` and `$^`', () => {
    const ast = parse('$live ::= 1; $^scoped ::= 2;');
    expect(ast).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'live', write: { mode: 'reassign-or-declare', scope: 'live' } },
        { type: 'VariableDeclaration', name: 'scoped', write: { mode: 'reassign-or-declare', scope: 'scoped' } }
      ]
    });
  });

  it('reassigns the nearest existing OUTER binding', () => {
    expect(render('$x: 1; $if (true) { $x ::= 2; } .a { v: $x; }'))
      .toBe('.a {\n  v: 2;\n}\n');
  });

  it('declares when no binding exists (unlike `:=`, which errors)', () => {
    expect(render('.a { $y ::= 5; v: $y; }'))
      .toBe('.a {\n  v: 5;\n}\n');
    expect(() => render('.a { $z := 5; v: $z; }')).toThrow();
  });

  it('reassigns an existing SCOPED binding through the scoped store (`$^name ::=`)', () => {
    expect(render('$^t: 1; $if (true) { $^t ::= 2; } .a { v: $^t; }'))
      .toBe('.a {\n  v: 2;\n}\n');
  });

  it('`:=` still ERRORS when the variable is unbound (unchanged)', () => {
    expect(() => render('$if (true) { $z := 5; }')).toThrow();
  });

  it('`:` still declares (mandatory shadow) — a fresh local binding, no error', () => {
    expect(render('.a { $w: 3; v: $w; }'))
      .toBe('.a {\n  v: 3;\n}\n');
  });

  it('`?:` (if-absent) is unchanged: no-op when already bound', () => {
    expect(render('$x: 1; $x?: 9; .a { v: $x; }'))
      .toBe('.a {\n  v: 1;\n}\n');
  });
});
