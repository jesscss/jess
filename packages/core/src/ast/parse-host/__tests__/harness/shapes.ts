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
  mixin,
  call,
  ref,
  list,
  vardecl,
  any,
} from '../../../../tree/index.js';
import { ComplexSelector } from '../../../../tree/selector-complex.js';
import { CompoundSelector } from '../../../../tree/selector-compound.js';
import { Context } from '../../../../context.js';
import { renderNodeToString } from '../../../../tree/util/render-buffer.js';

// NEW side (clean-room tree2).
import * as t2 from '../../../index.js';
import type { Root } from '../../../index.js';

const CN = { collapseNesting: true } as const;

export interface Shape {
  name: string;
  expected: string;
  buildNew: () => Root;
  /** Returns a freshly-constructed legacy root each call (build cost included). */
  buildOld: () => unknown;
}

/**
 * Render a legacy root to a string. Mixin resolution is ASYNC in the legacy
 * engine (it returns a Promise), so this awaits — async is part of legacy's
 * real cost for mixin-bearing stylesheets. collapseNesting is driven by the
 * render (print) options; the root is set on the context for mixin lookup.
 */
export async function renderOld(node: unknown, context?: Context): Promise<string> {
  const ctx = context ?? new Context();
  (ctx as unknown as { root: unknown }).root = node;
  return await renderNodeToString(node as Parameters<typeof renderNodeToString>[0], ctx, CN);
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
export async function withLegacyOpCounters(run: () => Promise<void>): Promise<LegacyOps> {
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
    await run();
  } finally {
    np.cloneForPlacement = origClone;
    np.inherit = origInherit;
    cxp.withComponents = origCxWith;
    cmp.withComponents = origCmWith;
  }
  return counts;
}

/** Legacy composition-op counts for one render of a shape. */
export function countLegacyOps(shape: Shape): Promise<LegacyOps> {
  return withLegacyOpCounters(async () => {
    await renderOld(shape.buildOld());
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

/* --- rung 5: mixin placement (eval) — canonical body, called under distinct parents */

const callOld = (name: string, args?: ReturnType<typeof list>) => {
  const nameRef = ref({ key: name }, { type: 'mixin' });
  return args ? call({ name: nameRef, args }) : call({ name: nameRef });
};

// mixin .mix { color: red; width: 10px } called under .a and .b
const rung5Decls: Shape = {
  name: 'rung5: mixin decls placed under .a and .b',
  expected:
    '.a {\n  color: red;\n  width: 10px;\n}\n' + '.b {\n  color: red;\n  width: 10px;\n}\n',
  buildNew: () =>
    t2.root([
      t2.mixinDef('.mix', [], [RED_NEW(), t2.decl('width', t2.dim(10, 'px'))]),
      t2.rule('.a', [t2.mixinCall('.mix')]),
      t2.rule('.b', [t2.mixinCall('.mix')]),
    ]),
  buildOld: () =>
    rules([
      mixin({ name: '.mix', rules: [RED_OLD(), tDecl({ name: 'width', value: tSpaced([dimension([10, 'px'])]) })] }),
      ruleset({ selector: tSel([el('.a')]), rules: [callOld('.mix')] }),
      ruleset({ selector: tSel([el('.b')]), rules: [callOld('.mix')] }),
    ]),
};

// mixin .box { color: red; .inner { width: 1px } &:hover { color: blue } } under .a, .b
const rung5Nested: Shape = {
  name: 'rung5: mixin with nested + & placed under .a and .b',
  expected:
    '.a {\n  color: red;\n}\n.a .inner {\n  width: 1px;\n}\n.a:hover {\n  color: blue;\n}\n' +
    '.b {\n  color: red;\n}\n.b .inner {\n  width: 1px;\n}\n.b:hover {\n  color: blue;\n}\n',
  buildNew: () => {
    const box = t2.mixinDef(
      '.box',
      [],
      [
        RED_NEW(),
        t2.rule('.inner', [t2.decl('width', t2.dim(1, 'px'))]),
        t2.rule(t2.complex([{ compound: t2.compound('&', ':hover') }]), [t2.decl('color', t2.word('blue'))]),
      ],
    );
    return t2.root([box, t2.rule('.a', [t2.mixinCall('.box')]), t2.rule('.b', [t2.mixinCall('.box')])]);
  },
  buildOld: () => {
    const box = mixin({
      name: '.box',
      rules: [
        RED_OLD(),
        ruleset({ selector: tSel([el('.inner')]), rules: [tDecl({ name: 'width', value: tSpaced([dimension([1, 'px'])]) })] }),
        ruleset({ selector: tSel([amp(), el(':hover')]), rules: [tDecl({ name: 'color', value: tSpaced([el('blue')]) })] }),
      ],
    });
    return rules([
      box,
      ruleset({ selector: tSel([el('.a')]), rules: [callOld('.box')] }),
      ruleset({ selector: tSel([el('.b')]), rules: [callOld('.box')] }),
    ]);
  },
};

// mixin .paint(@c) { color: @c } called .paint(blue) under .a, .paint(green) under .b
const rung5Param: Shape = {
  name: 'rung5: parametrized mixin, distinct args under .a and .b',
  expected: '.a {\n  color: blue;\n}\n.b {\n  color: green;\n}\n',
  buildNew: () =>
    t2.root([
      t2.mixinDef('.paint', [{ name: 'c', default: t2.word('red') }], [t2.decl('color', t2.varRef('c'))]),
      t2.rule('.a', [t2.mixinCall('.paint', [t2.word('blue')])]),
      t2.rule('.b', [t2.mixinCall('.paint', [t2.word('green')])]),
    ]),
  buildOld: () =>
    rules([
      mixin({
        name: '.paint',
        params: list([vardecl({ name: 'c', value: any('red') }, { paramVar: true })]),
        rules: [tDecl({ name: 'color', value: ref({ key: 'c' }, { type: 'variable' }) })],
      }),
      ruleset({ selector: tSel([el('.a')]), rules: [callOld('.paint', list([any('blue')]))] }),
      ruleset({ selector: tSel([el('.b')]), rules: [callOld('.paint', list([any('green')]))] }),
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
export const mixinShapes: Shape[] = [rung5Decls, rung5Nested, rung5Param];
export const allShapes: Shape[] = [...shapes, ...nestingShapes, ...mixinShapes];
