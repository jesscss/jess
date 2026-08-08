/*
 * Reading a live (`$name`) binding's OWN PRIOR value, versus a genuine
 * self-reference with nothing prior to read.
 *
 * The two differ by exactly one thing — whether an earlier binding of the name
 * exists — and the evaluator must tell them apart. `resolveVarRef` excludes the
 * declaration currently being evaluated and walks BACKWARD to the one before it,
 * so the store has to still HOLD that earlier binding. The scoped store keeps a
 * source-order stack per name (`declIndex`); the live store keeps
 * `BindingCell.prev`. When the live store was a single slot, write `N` destroyed
 * `N-1`, the backward walk found nothing behind the excluded node, and a plain
 * read-then-write reported a false `Recursive reference`.
 *
 * A control block does NOT open a frame — that is settled — so a reassignment
 * inside `$if` lands in the containing frame and is precisely the case a
 * single-slot store cannot express. `$for`/`@each` never showed the defect only
 * because each iteration builds its own frame, which is framing luck rather than
 * the rule being right; the `$if` cases below share the containing frame and so
 * pin the actual rule.
 */
import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import {
  decl, dimension, ifNode, keyword, operation, rule, stylesheet,
  variableDeclaration, variableReference
} from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeLessRegistry());

/** `$name` — the LIVE store, which is what `.scss`/`.jess` `$x` lowers to. */
const live = (name: string) => variableReference(name, 'live');
const declare = (name: string, value: Parameters<typeof variableDeclaration>[1]) =>
  variableDeclaration(name, value, { mode: 'declare' });
const readInto = (selector: string, name: string) => rule(selector, [decl('x', live(name))]);

const css = (statements: Parameters<typeof stylesheet>[0]) =>
  serialize(stylesheet(statements), { evaluator }).css;

describe('a live binding reading its own PRIOR value', () => {
  it('resolves to the previous binding at the same level', () => {
    expect(css([
      declare('i', dimension(3)),
      declare('i', operation('-', live('i'), dimension(1))),
      readInto('.a', 'i')
    ])).toBe('.a {\n  x: 2;\n}\n');
  });

  it('resolves through a $if block, which shares the containing frame', () => {
    expect(css([
      declare('i', dimension(3)),
      ifNode([{
        guard: null,
        rules: [declare('i', operation('-', live('i'), dimension(1)))]
      }]),
      readInto('.a', 'i')
    ])).toBe('.a {\n  x: 2;\n}\n');
  });

  it('resolves through two nested $if blocks', () => {
    expect(css([
      declare('i', dimension(3)),
      ifNode([{
        guard: null,
        rules: [ifNode([{
          guard: null,
          rules: [declare('i', operation('-', live('i'), dimension(1)))]
        }])]
      }]),
      readInto('.a', 'i')
    ])).toBe('.a {\n  x: 2;\n}\n');
  });

  it('resolves a bare copy, not only an arithmetic read', () => {
    expect(css([
      declare('i', keyword('red')),
      declare('i', live('i')),
      readInto('.a', 'i')
    ])).toBe('.a {\n  x: red;\n}\n');
  });

  it('resolves repeated self-redeclarations back to the original binding', () => {
    expect(css([
      declare('i', keyword('red')),
      declare('i', live('i')),
      declare('i', live('i')),
      readInto('.a', 'i')
    ])).toBe('.a {\n  x: red;\n}\n');
  });
});

describe('a live binding that is genuinely self-referential', () => {
  /*
   * These must still fail, and for the RIGHT reason: the read excludes the
   * declaration being evaluated, walks back, and finds NO earlier binding — the
   * reference is unresolvable, not merely detected. The only difference from the
   * block above is the absent prior declaration.
   */
  const recursive = { code: 'eval/recursive-reference', phase: 'eval' };

  it('is an error when nothing prior binds the name', () => {
    expect(() => css([
      declare('i', live('i')),
      readInto('.a', 'i')
    ])).toThrowError(expect.objectContaining(recursive));
  });

  it('is an error when the self-reference is arithmetic and nothing prior binds it', () => {
    expect(() => css([
      declare('i', operation('-', live('i'), dimension(1))),
      readInto('.a', 'i')
    ])).toThrowError(expect.objectContaining(recursive));
  });

  it('is an error inside a $if block when nothing prior binds the name', () => {
    expect(() => css([
      ifNode([{
        guard: null,
        rules: [
          declare('i', operation('-', live('i'), dimension(1))),
          readInto('.a', 'i')
        ]
      }])
    ])).toThrowError(expect.objectContaining(recursive));
  });
});
