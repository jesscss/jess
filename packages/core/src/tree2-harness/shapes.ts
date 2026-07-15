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
import { rules, ruleset, decl as tDecl, sel, el, spaced as tSpaced, comment as tComment, dimension } from '../tree/index.js';
import { Context } from '../context.js';
import { renderNodeToString } from '../tree/util/render-buffer.js';

// NEW side (clean-room tree2).
import { root, rule, decl, word, dim, comment, serialize, type Root } from '../tree2/index.js';

export interface Shape {
  name: string;
  expected: string;
  buildNew: () => Root;
  /** Returns a freshly-constructed legacy root each call (build cost included). */
  buildOld: () => unknown;
}

/** Render a legacy root to a string (handles the MaybePromise contract). */
export function renderOld(node: unknown): string {
  const out = renderNodeToString(node as Parameters<typeof renderNodeToString>[0], new Context());
  if (typeof out === 'string') {
    return out;
  }
  throw new Error('tree render returned a Promise for a static shape; harness expects sync');
}

/** Serialize a tree2 root without position tracking (fast path). */
export function renderNewFast(node: Root): string {
  return serialize(node).css;
}

/** Serialize a tree2 root WITH sourcemap position tracking. */
export function renderNewTracked(node: Root): string {
  return serialize(node, { trackPositions: true }).css;
}

/* ------------------------------------------------------------------ rungs */

// Rung 1: one rule + one declaration + a simple keyword value.
const rung1: Shape = {
  name: 'rung1: one rule / one decl / keyword value',
  expected: '.test {\n  color: red;\n}\n',
  buildNew: () => root([rule('.test', [decl('color', word('red'))])]),
  buildOld: () =>
    rules([
      ruleset({ selector: sel([el('.test')]), rules: [tDecl({ name: 'color', value: tSpaced([el('red')]) })] }),
    ]),
};

// Rung 2: multiple declarations + a dimension value + a comment (trivia).
const rung2: Shape = {
  name: 'rung2: multi decl / dimension / comment trivia',
  expected: '.box {\n  /* hi */\n  margin: 0px;\n  padding: 10px;\n  color: red;\n}\n',
  buildNew: () =>
    root([
      rule('.box', [
        comment('/* hi */'),
        decl('margin', dim(0, 'px')),
        decl('padding', dim(10, 'px')),
        decl('color', word('red')),
      ]),
    ]),
  buildOld: () =>
    rules([
      ruleset({
        selector: sel([el('.box')]),
        rules: [
          tComment('/* hi */'),
          tDecl({ name: 'margin', value: tSpaced([dimension([0, 'px'])]) }),
          tDecl({ name: 'padding', value: tSpaced([dimension([10, 'px'])]) }),
          tDecl({ name: 'color', value: tSpaced([el('red')]) }),
        ],
      }),
    ]),
};

export const shapes: Shape[] = [rung1, rung2];
