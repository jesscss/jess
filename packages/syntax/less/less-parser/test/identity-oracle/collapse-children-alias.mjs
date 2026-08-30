/**
 * `collapseChildrenAlias` — shared by every dialect's byte-identity oracle.
 *
 * It lived inside `less-parser/test/oracle-byte-identity.mjs` while Less was the
 * only dialect with a gate. It is not Less-specific and never was: the
 * `{ rules, children: rules }` aliasing it undoes comes from
 * `packages/syntax/css/css-parser/src/cst.ts`, which every dialect's public CST
 * goes through. When the SCSS oracle arrived the choice was to move this here or
 * to carry a second copy, and a second copy of a graph rewrite whose failure
 * mode is "the digest silently changed" is exactly the duplication this repo's
 * grammar work is trying to burn down.
 *
 * The move is behaviour-preserving by construction: the body below is
 * byte-identical to what the Less oracle carried, and `HARNESS_DIGEST` is
 * computed from a frozen canary rather than from file contents, so the
 * committed Less baseline stays comparable across the move.
 */

/**
 * Stand-in for `node.children` when it is the SAME array object as
 * `node.rules`.
 *
 * jess's public CST deliberately aliases the two —
 * `packages/syntax/css/css-parser/src/cst.ts` returns `{ rules, children: rules }`
 * — and the canonical projection abbreviates only genuine back-edges into the
 * CURRENT path: a node reachable by two non-ancestor paths is written out once
 * per path. With the alias in place every node's whole subtree is written
 * twice, so digesting a CST costs 2^depth. That is what made this gate spend
 * hundreds of seconds and gigabytes and then refuse with `CanonicalBudgetError`
 * instead of producing a verdict.
 *
 * Collapsing it loses no information, and it is exactly what
 * `CanonicalBudgetError` tells you to do ("Deduplicate the shared structure").
 * The marker is a distinct tagged class, so it cannot collide with anything a
 * grammar can emit, and the substitution is conditional on the identity check:
 * if `children` ever stops being the same object as `rules`, it is digested
 * verbatim and the difference shows up as a move.
 */
class ChildrenAliasesRules {}
const CHILDREN_ALIAS = Object.freeze(new ChildrenAliasesRules());

/**
 * Replace every `children` that is identical to its sibling `rules` with
 * {@link CHILDREN_ALIAS}.
 *
 * Structure-sharing: a subtree with no alias anywhere under it is returned
 * unchanged, so a value with no aliasing at all — the AST surface — passes
 * through as the very same object and its digest is provably untouched by this
 * function. Results are memoised by identity, so the rewrite is linear even
 * though what it undoes is not.
 *
 * A CYCLE is refused rather than handled. Rewriting one arm of a back-edge
 * while the ancestor it points at is still being copied would leave the copy's
 * back-edge aimed at the ORIGINAL graph — which the projection would then walk
 * as fresh, uncollapsed structure, reintroducing the exact blowup this removes
 * and changing the digest while it was at it. jess's parse results are acyclic;
 * if that ever stops being true, this must be told what to do about it rather
 * than quietly guess. Because it runs as a `projectValue`, the refusal lands on
 * the `undigested` channel — the tool declining to answer, which is what it is.
 */
export function collapseChildrenAlias(value) {
  const done = new Map();
  const active = new Set();

  const walk = (v) => {
    if (v === null || typeof v !== 'object') {
      return v;
    }
    if (done.has(v)) {
      return done.get(v);
    }
    if (active.has(v)) {
      throw new Error(
        'collapseChildrenAlias: the parse result is CYCLIC. Collapsing the `children`/`rules` alias cannot '
        + 'preserve a back-edge without deciding whether it should point at the original graph or the rewritten '
        + 'one, and both answers change the digest. Refusing rather than picking one silently.'
      );
    }
    active.add(v);

    let out = v;
    if (Array.isArray(v)) {
      const copy = new Array(v.length);
      let changed = false;
      for (let n = 0; n < v.length; n++) {
        copy[n] = walk(v[n]);
        if (copy[n] !== v[n]) {
          changed = true;
        }
      }
      if (changed) {
        out = copy;
      }
    } else if (v instanceof Map) {
      const copy = new Map();
      let changed = false;
      for (const [k, item] of v) {
        const nk = walk(k);
        const nv = walk(item);
        copy.set(nk, nv);
        if (nk !== k || nv !== item) {
          changed = true;
        }
      }
      if (changed) {
        out = copy;
      }
    } else if (v instanceof Set) {
      const copy = new Set();
      let changed = false;
      for (const item of v) {
        const nv = walk(item);
        copy.add(nv);
        if (nv !== item) {
          changed = true;
        }
      }
      if (changed) {
        out = copy;
      }
    } else if (v instanceof Date || v instanceof RegExp) {
      /*
       * Leaves under the projection: it writes their time / source + flags and
       * never descends. There is nothing under them to collapse.
       */
      out = v;
    } else {
      /*
       * The prototype is carried over, because the projection tags an object by
       * its constructor name and copying onto a bare `{}` would move the digest
       * of any class-instance node. Properties are DEFINED rather than
       * assigned: assignment runs an inherited setter, which can drop the key
       * from `Object.keys` — silently deleting a field from the digest — or
       * throw against a getter-only accessor.
       */
      const copy = Object.create(Object.getPrototypeOf(v));
      let changed = false;
      for (const k of Object.keys(v)) {
        const original = v[k];
        const aliased = k === 'children' && typeof original === 'object' && original !== null
          && original === v.rules;
        const replacement = aliased ? CHILDREN_ALIAS : walk(original);
        Object.defineProperty(copy, k, {
          value: replacement,
          writable: true,
          enumerable: true,
          configurable: true
        });
        if (replacement !== original) {
          changed = true;
        }
      }
      if (changed) {
        out = copy;
      }
    }

    active.delete(v);
    done.set(v, out);
    return out;
  };

  return walk(value);
}
