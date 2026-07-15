/**
 * Per-shape head-to-head builders for the tree2-vs-tree harness.
 *
 * This file lives OUTSIDE `tree2/` on purpose: it is the OLD side of the
 * comparison and therefore imports the legacy `../tree` API. The hard module
 * boundary applies to `tree2/` itself, which stays free of any `../tree`
 * reference. Each shape is built three ways for a byte-for-byte race:
 *   - `buildNew`  — programmatic construction via the clean-room tree2 API
 *   - `buildOld`  — programmatic construction via the legacy `../tree` API
 *   - `expected`  — the literal CSS bytes both must reproduce
 */

// OLD side (legacy tree) — allowed here, forbidden inside tree2/.
import {
  rules,
  ruleset,
  decl as tDecl,
  sel as tSel,
  el,
  spaced as tSpaced,
  comment as tComment,
  dimension,
  sellist as tSellist,
  compound as tCompound,
  amp,
  co,
  Node,
} from '../tree/index.js';
import { ComplexSelector } from '../tree/selector-complex.js';
import { CompoundSelector } from '../tree/selector-compound.js';
import { Context } from '../context.js';
import { renderNodeToString } from '../tree/util/render-buffer.js';

// NEW side (clean-room tree2).
import * as t2 from '../tree2/index.js';
import type { Root } from '../tree2/index.js';

const CN = { collapseNesting: true } as const;

export interface Shape {
  name: string;
  expected: string;
  buildNew: () => Root;
  /** Returns a freshly-constructed legacy root each call (build cost included). */
  buildOld: () => unknown;
}

/** Render a legacy root to a string (handles the MaybePromise contract). */
export function renderOld(node: unknown, context?: Context): string {
  // collapseNesting is driven by the render (print) options; the Context is
  // created option-free (collapseNesting is not a ContextOptions key).
  const out = renderNodeToString(
    node as Parameters<typeof renderNodeToString>[0],
    context ?? new Context(),
    CN,
  );
  if (typeof out === 'string') {
    return out;
  }
  throw new Error('tree render returned a Promise for a static shape; harness expects sync');
}

/** A reusable context per shape — lets the race hoist fixed setup out of the timed loop. */
export function newContext(): Context {
  return new Context();
}

/** Serialize a tree2 root without position tracking (fast path). */
export function renderNewFast(node: Root): string {
  return t2.serialize(node).css;
}

/** Serialize a tree2 root WITH sourcemap position tracking. */
export function renderNewTracked(node: Root): string {
  return t2.serialize(node, { trackPositions: true }).css;
}

/* ------------------------------ legacy composition-op instrumentation ------ */

export interface LegacyOps {
  cloneForPlacement: number;
  inherit: number;
  withComponents: number;
}

type AnyFn = (this: unknown, ...args: unknown[]) => unknown;
type Patchable = Record<string, AnyFn>;
const asPatchable = (proto: object): Patchable => proto as unknown as Patchable;

/**
 * Count the legacy per-placement composition ops for ONE render of a shape:
 * `cloneForPlacement` + `inherit` (both on Node) and `withComponents` (on
 * Complex/CompoundSelector). Patches prototypes, runs one render, restores.
 */
export function withLegacyOpCounters(run: () => void): LegacyOps {
  const counts: LegacyOps = { cloneForPlacement: 0, inherit: 0, withComponents: 0 };
  const np = asPatchable(Node.prototype);
  const cxp = asPatchable(ComplexSelector.prototype);
  const cmp = asPatchable(CompoundSelector.prototype);

  const origClone = np.cloneForPlacement!;
  const origInherit = np.inherit!;
  const origCxWith = cxp.withComponents!;
  const origCmWith = cmp.withComponents!;

  np.cloneForPlacement = function (this: unknown, ...args: unknown[]): unknown {
    counts.cloneForPlacement++;
    return origClone.apply(this, args);
  };
  np.inherit = function (this: unknown, ...args: unknown[]): unknown {
    counts.inherit++;
    return origInherit.apply(this, args);
  };
  cxp.withComponents = function (this: unknown, ...args: unknown[]): unknown {
    counts.withComponents++;
    return origCxWith.apply(this, args);
  };
  cmp.withComponents = function (this: unknown, ...args: unknown[]): unknown {
    counts.withComponents++;
    return origCmWith.apply(this, args);
  };

  try {
    run();
  } finally {
    np.cloneForPlacement = origClone;
    np.inherit = origInherit;
    cxp.withComponents = origCxWith;
    cmp.withComponents = origCmWith;
  }
  return counts;
}

/** Legacy composition-op counts for one render of a shape. */
export function countLegacyOps(shape: Shape): LegacyOps {
  return withLegacyOpCounters(() => {
    renderOld(shape.buildOld());
  });
}

/** tree2's composition-op counts for one render of a shape. */
export function tree2Ops(shape: Shape): t2.ComposeStats {
  return t2.composeStats(shape.buildNew());
}

/* --------------------------------------------------------------- rungs 1-2 */

const RED_OLD = () => tDecl({ name: 'color', value: tSpaced([el('red')]) });
const RED_NEW = () => t2.decl('color', t2.word('red'));

const rung1: Shape = {
  name: 'rung1: one rule / one decl / keyword value',
  expected: '.test {\n  color: red;\n}\n',
  buildNew: () => t2.root([t2.rule('.test', [RED_NEW()])]),
  buildOld: () => rules([ruleset({ selector: tSel([el('.test')]), rules: [RED_OLD()] })]),
};

const rung2: Shape = {
  name: 'rung2: multi decl / dimension / comment trivia',
  expected: '.box {\n  /* hi */\n  margin: 0px;\n  padding: 10px;\n  color: red;\n}\n',
  buildNew: () =>
    t2.root([
      t2.rule('.box', [
        t2.comment('/* hi */'),
        t2.decl('margin', t2.dim(0, 'px')),
        t2.decl('padding', t2.dim(10, 'px')),
        RED_NEW(),
      ]),
    ]),
  buildOld: () =>
    rules([
      ruleset({
        selector: tSel([el('.box')]),
        rules: [
          tComment('/* hi */'),
          tDecl({ name: 'margin', value: tSpaced([dimension([0, 'px'])]) }),
          tDecl({ name: 'padding', value: tSpaced([dimension([10, 'px'])]) }),
          RED_OLD(),
        ],
      }),
    ]),
};

/* --- rung 3: selector lists, compound selectors, combinators (flat) ------- */

const rung3: Shape = {
  name: 'rung3: compound / child / descendant / list selectors',
  expected:
    '.a.b {\n  color: red;\n}\n' +
    '.x > .y {\n  color: red;\n}\n' +
    '.p .q {\n  color: red;\n}\n' +
    '.m,\n.n {\n  color: red;\n}\n',
  buildNew: () =>
    t2.root([
      // .a.b  (compound)
      t2.rule(t2.complex([{ compound: t2.compound('.a', '.b') }]), [RED_NEW()]),
      // .x > .y  (child combinator)
      t2.rule(
        t2.complex([{ compound: t2.compound('.x') }, { comb: '>', compound: t2.compound('.y') }]),
        [RED_NEW()],
      ),
      // .p .q  (descendant combinator)
      t2.rule(
        t2.complex([{ compound: t2.compound('.p') }, { comb: ' ', compound: t2.compound('.q') }]),
        [RED_NEW()],
      ),
      // .m, .n  (selector list)
      t2.rule(t2.selist(t2.sel('.m'), t2.sel('.n')), [RED_NEW()]),
    ]),
  buildOld: () =>
    rules([
      ruleset({ selector: tSel([tCompound([el('.a'), el('.b')])]), rules: [RED_OLD()] }),
      ruleset({ selector: tSel([el('.x'), co('>'), el('.y')]), rules: [RED_OLD()] }),
      ruleset({ selector: tSel([el('.p'), co(' '), el('.q')]), rules: [RED_OLD()] }),
      ruleset({ selector: tSellist([tSel([el('.m')]), tSel([el('.n')])]), rules: [RED_OLD()] }),
    ]),
};

/* --- rung 4: nesting + `&` composition (THE cost center) ------------------ */

// .a { .b { } } -> .a .b   (one descendant composition)
const rung4Nest: Shape = {
  name: 'rung4: nesting descendant (.a { .b })',
  expected: '.a .b {\n  color: red;\n}\n',
  buildNew: () => t2.root([t2.rule('.a', [t2.rule('.b', [RED_NEW()])])]),
  buildOld: () =>
    rules([
      ruleset({
        selector: tSel([el('.a')]),
        rules: [ruleset({ selector: tSel([el('.b')]), rules: [RED_OLD()] })],
      }),
    ]),
};

// .a { &:hover { } } -> .a:hover
const rung4AmpHover: Shape = {
  name: 'rung4: ampersand pseudo (.a { &:hover })',
  expected: '.a:hover {\n  color: red;\n}\n',
  buildNew: () =>
    t2.root([
      t2.rule('.a', [t2.rule(t2.complex([{ compound: t2.compound('&', ':hover') }]), [RED_NEW()])]),
    ]),
  buildOld: () =>
    rules([
      ruleset({
        selector: tSel([el('.a')]),
        rules: [ruleset({ selector: tSel([amp(), el(':hover')]), rules: [RED_OLD()] })],
      }),
    ]),
};

// .a { &.b { } } -> .a.b
const rung4AmpClass: Shape = {
  name: 'rung4: ampersand compound (.a { &.b })',
  expected: '.a.b {\n  color: red;\n}\n',
  buildNew: () =>
    t2.root([
      t2.rule('.a', [t2.rule(t2.complex([{ compound: t2.compound('&', '.b') }]), [RED_NEW()])]),
    ]),
  buildOld: () =>
    rules([
      ruleset({
        selector: tSel([el('.a')]),
        rules: [ruleset({ selector: tSel([amp(), el('.b')]), rules: [RED_OLD()] })],
      }),
    ]),
};

// .a { .b { .c { } } } -> .a .b .c   (composition compounds with depth)
const rung4Deep: Shape = {
  name: 'rung4: 3-level deep nesting (.a{.b{.c}})',
  expected: '.a .b .c {\n  color: red;\n}\n',
  buildNew: () => t2.root([t2.rule('.a', [t2.rule('.b', [t2.rule('.c', [RED_NEW()])])])]),
  buildOld: () =>
    rules([
      ruleset({
        selector: tSel([el('.a')]),
        rules: [
          ruleset({
            selector: tSel([el('.b')]),
            rules: [ruleset({ selector: tSel([el('.c')]), rules: [RED_OLD()] })],
          }),
        ],
      }),
    ]),
};

// .a, .b { .c, .d { } } -> :is(.a, .b) .c, :is(.a, .b) .d  (multiplicative)
const rung4ListNest: Shape = {
  name: 'rung4: list x list nesting (.a,.b{.c,.d})',
  expected: ':is(.a, .b) .c,\n:is(.a, .b) .d {\n  color: red;\n}\n',
  buildNew: () =>
    t2.root([
      t2.rule(t2.selist(t2.sel('.a'), t2.sel('.b')), [
        t2.rule(t2.selist(t2.sel('.c'), t2.sel('.d')), [RED_NEW()]),
      ]),
    ]),
  buildOld: () =>
    rules([
      ruleset({
        selector: tSellist([tSel([el('.a')]), tSel([el('.b')])]),
        rules: [
          ruleset({
            selector: tSellist([tSel([el('.c')]), tSel([el('.d')])]),
            rules: [RED_OLD()],
          }),
        ],
      }),
    ]),
};

export const shapes: Shape[] = [rung1, rung2, rung3];
export const nestingShapes: Shape[] = [
  rung4Nest,
  rung4AmpHover,
  rung4AmpClass,
  rung4Deep,
  rung4ListNest,
];
export const allShapes: Shape[] = [...shapes, ...nestingShapes];
