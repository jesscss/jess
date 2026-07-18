import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst } from './bridge.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * v5 nesting-collapse `:is()` COMPACTION (collapseNesting:true).
 *
 * When collapsing a nested `&`-less descendant onto its ancestor `A`, the
 * multi-branch side wraps in a SINGLE `:is(...)` — `A` is emitted ONCE, OUTSIDE
 * the `:is()`, and is NEVER cartesian-distributed (no combinatorial row
 * explosion). The predicate per side is simply list-vs-single:
 *
 *   render(side) = side.isMultiBranchList ? `:is(${branches.join(', ')})` : side
 *
 * then `A <combinator> render(child)`. `A` is one opaque unit that may itself
 * already carry an `:is()` from a shallower nesting level.
 *
 * `&`-based descendants are a DIFFERENT path: each `&` substitutes over the full
 * cartesian ancestor array (the `selectors`-fixture cartesian), untouched here.
 *
 * This supersedes the earlier verbose form that repeated the full ancestor prefix
 * inside the `:is()` (`:is(A x, A y) …`) and cartesian-expanded a rule's own
 * multi-branch header. The compact prefix-factored form is the intended v5 output
 * (owner ruling 2026-07-18); the corpus `rulesets` golden was reconciled to it.
 */

const render = async (src: string): Promise<string> => {
  const root = bridgeToAst(parseLessFn(src).tree, src);
  const evaluator = buildEvaluator(makeBuiltinRegistry());
  return (await serialize(root, { evaluator, collapseNesting: true })).css;
};

describe('ast/ nesting — `:is()` compaction (collapseNesting:true)', () => {
  it('single × single joins plainly (no `:is()`)', async () => {
    expect(await render('.a {\n  .c { x: 1; }\n}')).toBe('.a .c {\n  x: 1;\n}\n');
  });

  it('multi parent × single child → `:is(parents) child`', async () => {
    expect(await render('.a, .b {\n  .c { x: 1; }\n}')).toBe(':is(.a, .b) .c {\n  x: 1;\n}\n');
  });

  it('single parent × multi child → `parent :is(children)` (NOT cartesian rows)', async () => {
    expect(await render('.a {\n  .c, .d { x: 1; }\n}')).toBe('.a :is(.c, .d) {\n  x: 1;\n}\n');
  });

  it('multi parent × multi child → `:is(parents) :is(children)` (single row)', async () => {
    expect(await render('.a, .b {\n  .c, .d { x: 1; }\n}')).toBe(':is(.a, .b) :is(.c, .d) {\n  x: 1;\n}\n');
  });

  it('`&`-based child STILL cartesian-expands (different path, unchanged)', async () => {
    expect(await render('h1, h2, h3 {\n  a, p {\n    &:hover { color: red; }\n  }\n}')).toBe(
      'h1 a:hover,\nh2 a:hover,\nh3 a:hover,\nh1 p:hover,\nh2 p:hover,\nh3 p:hover {\n  color: red;\n}\n',
    );
  });

  it('the ancestor `:is()` is opaque — a deeper multi child wraps WITHOUT repeating the prefix', async () => {
    // `A` = `.p :is(.a, .b)` is carried down as one unit; the next multi child
    // wraps as its own `:is()`, prefix emitted once.
    expect(await render('.p {\n  .a, .b {\n    .c, .d { x: 1; }\n  }\n}')).toBe(
      '.p :is(.a, .b) :is(.c, .d) {\n  x: 1;\n}\n',
    );
    // ...and a deeper SINGLE child joins plainly onto the same opaque ancestor.
    expect(await render('.p {\n  .a, .b {\n    .c { x: 1; }\n  }\n}')).toBe(
      '.p :is(.a, .b) .c {\n  x: 1;\n}\n',
    );
  });

  it('deep multi-selector block (the `rulesets` spec): compact `:is()` at each join', async () => {
    const src = `#first > .one {
  > #second .two > #deux {
    width: 50%;
    #third { &:focus { color: black; #fifth { > #sixth { .seventh #eighth { + #ninth { color: purple; } } } } } height: 100%; }
    #fourth, #five, #six {
      color: #110000;
      .seven, .eight > #nine { border: 1px solid black; }
      #ten { color: red; }
    }
  }
  font-size: 2em;
}
`;
    expect(await render(src)).toBe(
      `#first > .one > #second .two > #deux {
  width: 50%;
}
#first > .one > #second .two > #deux #third:focus {
  color: black;
}
#first > .one > #second .two > #deux #third:focus #fifth > #sixth .seventh #eighth + #ninth {
  color: purple;
}
#first > .one > #second .two > #deux #third {
  height: 100%;
}
#first > .one > #second .two > #deux :is(#fourth, #five, #six) {
  color: #110000;
}
#first > .one > #second .two > #deux :is(#fourth, #five, #six) :is(.seven, .eight > #nine) {
  border: 1px solid black;
}
#first > .one > #second .two > #deux :is(#fourth, #five, #six) #ten {
  color: red;
}
#first > .one {
  font-size: 2em;
}
`,
    );
  });
});
