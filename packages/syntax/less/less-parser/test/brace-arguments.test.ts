import { describe, expect, it } from 'vitest';
import type { Declaration, FunctionCall, Ruleset } from '@jesscss/core/ast';
import { parse } from '@jesscss/less-parser';

/**
 * Ledger P37: a `{` in a Less function argument is a DECLARATION LIST (a
 * detached ruleset), as it always was. A css-values-5 §3.1.1 `{}`-wrapped
 * value list there is "LATER": telling it from a declaration list needs the
 * block's first item read once and shared by both readings, which the grammar
 * does not do yet. Those cases are pending below, not deleted. A `var()`
 * fallback keeps its literal `{ a, b }` (pinned in jess's
 * `less-curly-block-arguments.test.ts`).
 */
function argumentKind(source: string): string {
  const sheet = parse(source);
  const rule = sheet.rules.at(-1) as Ruleset;
  const call = (rule.rules[0] as Declaration).value as FunctionCall;
  const value = call.args[0]!.value;
  if (Array.isArray(value) || typeof value !== 'object') {
    return 'slot';
  }
  return value.type === 'Block' ? `Block:${value.delimiter}` : value.type;
}

const CURLY = 'Block:curly';
const DECLARATIONS = 'AnonymousMixin';

const CASES: Array<[name: string, source: string, kind: string]> = [
  ['a value list', 'a { b: foo({ a, b }); }', CURLY],
  ['a single value', 'a { b: foo({ a }); }', CURLY],
  ['a variable-led value list', '@v: 1px;\na { b: foo({ @v, 2px }); }', CURLY],
  ['a call-led value list', 'a { b: foo({ f(x), y }); }', CURLY],
  ['a lone function call with no `;`', 'a { b: foo({ f(x) }); }', CURLY],
  ['hex colours', 'a { b: foo({ #fff, #000 }); }', CURLY],
  ['a colon inside a string', 'a { b: foo({ "x:y", z }); }', CURLY],
  ['a declaration', 'a { b: foo({ v: 1; }); }', DECLARATIONS],
  ['a declaration with no trailing `;`', 'a { b: foo({ a:b }); }', DECLARATIONS],
  ['an empty block', 'a { b: foo({}); }', DECLARATIONS],
  ['a nested rule with a selector list', 'a { b: foo({ h1, h2 { c: d } }); }', DECLARATIONS],
  ['a detached-ruleset call', '@r: { c: d };\na { b: foo({ @r() }); }', DECLARATIONS],
  ['a mixin call', '.m() { c: d }\na { b: foo({ .m() }); }', DECLARATIONS],
  ['a namespaced mixin call', 'a { b: foo({ #ns.m() }); }', DECLARATIONS],
  ['a child-combinator mixin call', 'a { b: foo({ #ns > .m(); }); }', DECLARATIONS],
  ['a variable then a spaced paren group', '@a: 1;\na { b: foo({ @a (b) }); }', CURLY]
];

function firstArgument(source: string): unknown {
  const sheet = parse(source);
  const rule = sheet.rules.at(-1) as Ruleset;
  return ((rule.rules[0] as Declaration).value as FunctionCall).args;
}

/*
 * Ledger P38: a first argument followed by a top-level `:` makes the call a
 * BRANCH list, `;`s preserved as a `;` List; a Less keyword argument does not.
 */
describe('Less: branch arguments are dispatched on the first argument (P38)', () => {
  it('a branch list is one `;` List of Branch nodes, the trailing `;` kept', () => {
    expect(firstArgument('a { b: if(style(--x: y): a; else: b;); }')).toMatchObject([{
      value: {
        type: 'List',
        sep: ';',
        value: [
          { type: 'Branch', condition: { type: 'FunctionCall', name: 'style' }, value: { src: 'a' } },
          { type: 'Branch', condition: { src: 'else' }, value: { src: 'b' } },
          []
        ]
      }
    }]);
  });

  it('a media() test is parsed with the query grammar, its variable kept', () => {
    expect(firstArgument('a { b: if(media(width > @w): 1); }')).toMatchObject([{
      value: {
        type: 'Branch',
        condition: {
          type: 'FunctionCall',
          name: 'media',
          args: [{ value: { type: 'Operation', operator: '>', left: { src: 'width' } } }]
        },
        value: { src: '1' }
      }
    }]);
  });

  it('a later condition is read like the first: an if-test, or a Less condition', () => {
    expect(firstArgument('a { b: if(@a > 1: x; supports(display: grid): y; @b > 2: z); }')).toMatchObject([{
      value: {
        type: 'List',
        sep: ';',
        value: [
          { type: 'Branch', condition: { type: 'Condition' }, value: { src: 'x' } },
          {
            type: 'Branch',
            condition: { type: 'FunctionCall', name: 'supports', args: [{ value: { type: 'Operation', operator: ':' } }] },
            value: { src: 'y' }
          },
          { type: 'Branch', condition: { type: 'Condition' }, value: { src: 'z' } }
        ]
      }
    }]);
  });

  it('a call opening on a keyword argument is never a branch list', () => {
    expect(() => parse('a { b: foo(@k: v: x); }')).toThrow();
  });

  it('a Less keyword argument stays a keyword argument', () => {
    expect(firstArgument('a { b: darken(@color: red, 10%); }')).toMatchObject([
      { name: 'color', value: { src: 'red' } },
      { value: { src: '10%' } }
    ]);
  });

  it('an escaped colon in a first argument is not a branch colon', () => {
    expect(firstArgument('a { b: foo(a\\:b); }')).toMatchObject([{ value: { src: 'a\\:b' } }]);
  });

  it('a `;` without the colon shape still separates arguments', () => {
    expect(firstArgument('a { b: foo(a; b); }')).toMatchObject([{ value: { src: 'a' } }, { value: { src: 'b' } }]);
  });
});

describe('Less: a `{` in a function argument is a declaration list (P37)', () => {
  for (const [name, source, kind] of CASES) {
    if (kind === CURLY) {
      /* P37 "LATER": a `{}`-wrapped value list in a Less function argument. */
      it.todo(`${name} → curly block (P37 LATER)`);
      continue;
    }
    it(`${name} → declaration list`, () => {
      expect(argumentKind(source)).toBe(kind);
    });
  }

  it('`{ a, b: c }` is an error', () => {
    expect(() => parse('a { b: foo({ a, b: c }); }')).toThrow();
  });

  it('a `{` leading a later branch group is a detached ruleset, never a curly block', () => {
    expect(() => parse('a { b: if(a: 1; {b}); }')).toThrow();
  });

  it('a keyword argument in a branch list is rejected, not dropped', () => {
    expect(() => parse('a { b: if(c: @k: v); }')).toThrow(/keyword argument/);
  });

  it('a branch value may be a detached ruleset', () => {
    expect(firstArgument('a { b: if(c: { v: 1; }); }')).toMatchObject([{
      value: { type: 'Branch', condition: { src: 'c' }, value: { type: 'AnonymousMixin' } }
    }]);
  });
});
