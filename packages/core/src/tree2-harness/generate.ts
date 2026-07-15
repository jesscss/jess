/**
 * Large-stylesheet generators for the at-scale race (~10k nodes), built both
 * ways. At this scale the real creation+serialize work dwarfs the fixed
 * Context/resolve setup, so setup contamination stops mattering.
 *
 * Two variants:
 *   - flat: N rules x 2 declarations (baseline serialize throughput)
 *   - composition-heavy: nested rules with `&` (in-compound) + descendant
 *     composition — the actual cost center (per-placement selector composition).
 *
 * The composition-heavy variant deliberately uses ONLY composition forms tree2
 * reproduces byte-for-byte today: descendant nesting and `&` fused inside a
 * compound (`&:hover`, `&.active`, `&:focus`). It avoids a standalone `&`
 * followed by a combinator under a COMPLEX parent (e.g. `& > .x` under `.a .b`),
 * which Less v5 wraps in `:is(.a .b) > .x` — that `:is()`-wrapping rule is a
 * known tree2 gap deferred to a later rung. This is still a faithful
 * composition workload for the perf thesis.
 */

import {
  rules,
  ruleset,
  decl as tDecl,
  sel as tSel,
  el,
  spaced as tSpaced,
  dimension,
  amp,
  mixin,
  call,
  ref,
  list,
  vardecl,
  any,
} from '../tree/index.js';
import * as t2 from '../tree2/index.js';
import type { Root as T2Root, Statement as T2Statement } from '../tree2/index.js';

/* ------------------------------------------------------------- tree2 side */

const kw = (name: string, k: string) => t2.decl(name, t2.word(k));
const px = (name: string, n: number) => t2.decl(name, t2.dim(n, 'px'));
const ampCompound = (...rest: string[]) => t2.complex([{ compound: t2.compound('&', ...rest) }]);

export function buildFlatNew(n: number): T2Root {
  const children: T2Statement[] = [];
  for (let i = 0; i < n; i++) {
    children.push(t2.rule(`.c${i}`, [kw('color', 'red'), px('width', 10)]));
  }
  return t2.root(children);
}

export function buildCompNew(blocks: number): T2Root {
  const children: T2Statement[] = [];
  for (let i = 0; i < blocks; i++) {
    children.push(
      t2.rule(`.block${i}`, [
        kw('color', 'red'),
        t2.rule(ampCompound(':hover'), [kw('color', 'blue')]),
        t2.rule(ampCompound('.active'), [px('width', 10)]),
        t2.rule('.child', [
          px('height', 5),
          t2.rule(ampCompound(':focus'), [kw('color', 'green')]),
          t2.rule('.grand', [px('top', 0)]),
        ]),
      ]),
    );
  }
  return t2.root(children);
}

/* ------------------------------------------------------------- legacy side */

const tKw = (name: string, k: string) => tDecl({ name, value: tSpaced([el(k)]) });
const tPx = (name: string, n: number) => tDecl({ name, value: tSpaced([dimension([n, 'px'])]) });

export function buildFlatOld(n: number): unknown {
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push(ruleset({ selector: tSel([el(`.c${i}`)]), rules: [tKw('color', 'red'), tPx('width', 10)] }));
  }
  return rules(list);
}

export function buildCompOld(blocks: number): unknown {
  const list = [];
  for (let i = 0; i < blocks; i++) {
    list.push(
      ruleset({
        selector: tSel([el(`.block${i}`)]),
        rules: [
          tKw('color', 'red'),
          ruleset({ selector: tSel([amp(), el(':hover')]), rules: [tKw('color', 'blue')] }),
          ruleset({ selector: tSel([amp(), el('.active')]), rules: [tPx('width', 10)] }),
          ruleset({
            selector: tSel([el('.child')]),
            rules: [
              tPx('height', 5),
              ruleset({ selector: tSel([amp(), el(':focus')]), rules: [tKw('color', 'green')] }),
              ruleset({ selector: tSel([el('.grand')]), rules: [tPx('top', 0)] }),
            ],
          }),
        ],
      }),
    );
  }
  return rules(list);
}

/* ---------------------------------------- mixin-heavy (the benchmark pattern) */

// A single mixin `.card(@c)` defined ONCE, called under N distinct parents with
// distinct args — each call places a body with 2 nested compositions
// (`.inner`, `&:hover`). This is exactly how benchmark.less generates its ~70k
// compositions: one canonical body, many placements.
const COLORS = ['red', 'blue', 'green'];

export function buildMixinNew(calls: number): T2Root {
  const def = t2.mixinDef(
    '.card',
    [{ name: 'c', default: t2.word('red') }],
    [
      t2.decl('color', t2.varRef('c')),
      t2.rule('.inner', [px('width', 10)]),
      t2.rule(ampCompound(':hover'), [px('border', 1)]),
    ],
  );
  const children: T2Statement[] = [def];
  for (let i = 0; i < calls; i++) {
    children.push(t2.rule(`.item${i}`, [t2.mixinCall('.card', [t2.word(COLORS[i % COLORS.length]!)])]));
  }
  return t2.root(children);
}

export function buildMixinOld(calls: number): unknown {
  const def = mixin({
    name: '.card',
    params: list([vardecl({ name: 'c', value: any('red') }, { paramVar: true })]),
    rules: [
      tDecl({ name: 'color', value: ref({ key: 'c' }, { type: 'variable' }) }),
      ruleset({ selector: tSel([el('.inner')]), rules: [tPx('width', 10)] }),
      ruleset({ selector: tSel([amp(), el(':hover')]), rules: [tPx('border', 1)] }),
    ],
  });
  const list2: Array<ReturnType<typeof mixin> | ReturnType<typeof ruleset>> = [def];
  for (let i = 0; i < calls; i++) {
    list2.push(
      ruleset({
        selector: tSel([el(`.item${i}`)]),
        rules: [
          call({
            name: ref({ key: '.card' }, { type: 'mixin' }),
            args: list([any(COLORS[i % COLORS.length]!)]),
          }),
        ],
      }),
    );
  }
  return rules(list2);
}

/** Rough tree2 node count for reporting. */
export function countNodesNew(root: T2Root): number {
  let n = 0;
  const visit = (node: unknown): void => {
    n++;
    const o = node as { body?: unknown[]; children?: unknown[] };
    if (Array.isArray(o.children)) for (const c of o.children) visit(c);
    if (Array.isArray(o.body)) for (const c of o.body) visit(c);
  };
  visit(root);
  return n;
}
