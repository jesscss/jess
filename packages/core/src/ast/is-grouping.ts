/**
 * `:is()` grouping — the one owner of the rule that decides which selector
 * branches may share an `:is()`, used by both places that group:
 *
 * - the serializer's nesting fold (`opaqueJoin`, `collapseNesting: 'native' |
 *   'compact'`), which works on the parsed selector AST; and
 * - extend's own groups (the `all` graft and sibling compaction, ledger X3 and
 *   EXTEND-SEMANTICS §7c), which work on the extend engine's selector IR.
 *
 * It owns three things: a branch's Selectors-4 §17 specificity, whether the
 * branch may sit inside `:is()` at all, and the partition of a branch list into
 * groups. A group keeps native specificity, matching and invalid-selector
 * behaviour only when every member has the same specificity (`:is()` scores its
 * most specific argument), no member carries a pseudo-element, every
 * pseudo-class is a standard one every major engine implements (`:is()` is a
 * forgiving list: it drops a branch a browser does not understand, where a plain
 * list drops the whole rule), and — unless the group leads the whole selector —
 * every member is one compound (`A :is(x y)` lets `x` sit above `A`; the caller
 * says which, through `compoundOnly`). A token is scored from the parser token it
 * was built from, never from serialized text.
 */

import type { SelectorBranch, SimpleToken } from './nodes.js';
import type { Branch, Compound, Simple } from './extend/ir.js';

/*
 * Specificity packed as `a·2³² + b·2¹⁶ + c`, so two branches compare with `===`
 * and `:is()`'s max-of-arguments is a numeric max. Each component must stay
 * below 65536 or the packing aliases; no authored selector gets near that.
 */
const SPECIFICITY_ID = 2 ** 32;
const SPECIFICITY_CLASS = 2 ** 16;
const SPECIFICITY_TYPE = 1;

/*
 * Pseudo-classes a group may carry, keyed with their colon: standard (Selectors
 * 4/5, HTML) AND implemented by every major engine, with a FIXED `(0,1,0)`
 * specificity. A vendor-prefixed, unknown, or not-yet-implemented pseudo-class
 * keeps its list distributed. Absent on purpose:
 * - pseudo-elements, single- or double-colon;
 * - `:scope`: inside `@scope` a selector without `:scope` gains an implicit
 *   `:scope ` prefix, so `A :is(:scope, .x)` would drop the one `A .x` carries;
 * - every functional pseudo-class. Its argument reaches core as joined text, so
 *   neither the `of S` specificity of `:nth-child()` nor the argument's validity
 *   (`:lang(en, fr)` is invalid in Chromium) can be read here. A functional
 *   spelling of a name listed here (`:hover(x)`) misses the Set.
 * The argument-scored `:is()`/`:not()`/`:has()`/`:where()` are structured
 * pseudos, handled by name in {@link tokenSpecificity}.
 */
const GROUPABLE_PSEUDO_CLASSES = new Set([
  ':active', ':any-link', ':autofill', ':checked', ':default', ':defined',
  ':disabled', ':empty', ':enabled', ':first-child', ':first-of-type', ':focus',
  ':focus-visible', ':focus-within', ':fullscreen', ':hover', ':in-range',
  ':indeterminate', ':invalid', ':last-child', ':last-of-type', ':link', ':modal',
  ':only-child', ':only-of-type', ':optional', ':out-of-range',
  ':placeholder-shown', ':popover-open', ':read-only', ':read-write', ':required',
  ':root', ':target', ':user-invalid', ':user-valid', ':valid', ':visited'
]);

function pseudoClassSpecificity(text: string): number {
  return GROUPABLE_PSEUDO_CLASSES.has(text) || GROUPABLE_PSEUDO_CLASSES.has(text.toLowerCase()) ? SPECIFICITY_CLASS : -1;
}

/**
 * Specificity of one parsed simple token, or -1 when it cannot sit in a group.
 * `inHas` is set inside a `:has()` argument, where another `:has()` is invalid.
 */
function tokenSpecificity(sim: SimpleToken, inHas: boolean): number {
  if (sim.interp !== null) {
    return -1;
  }
  if (sim.type === 'PseudoSelector') {
    /* Only the four selector functions: `::not(…)` and `:matches()` stay out. */
    const name = sim.name.toLowerCase();
    if (sim.args === null || (name !== ':is' && name !== ':not' && name !== ':where' && (name !== ':has' || inHas))) {
      return -1;
    }
    let max = 0;
    for (const branch of sim.args.selectors) {
      const s = astBranchSpecificity(branch, false, inHas || name === ':has');
      if (s < 0) {
        return -1;
      }
      if (s > max) {
        max = s;
      }
    }
    return name === ':where' ? 0 : max;
  }
  const text = sim.text!;
  const first = text.charCodeAt(0);
  if (first === 46 /* . */) {
    return SPECIFICITY_CLASS;
  }
  if (first === 91 /* [ */) {
    /*
     * The parser keeps an attribute selector as its authored text. Out: a
     * namespace prefix (`[ns|a]`, invalid when undeclared; `|=` is the dash
     * operator) and the `s` flag, which Chromium does not implement. A final
     * `s` after a space may instead be a bare name or value (`[ s ]`, `[a= s]`);
     * that only loses a group.
     */
    const bar = text.indexOf('|');
    const eq = text.indexOf('=');
    let end = text.length - 2;
    if (text.charCodeAt(end) === 32) {
      end--;
    }
    const beforeFlag = text.charCodeAt(end - 1);
    return (bar !== -1 && text.charCodeAt(bar + 1) !== 61 /* = */ && (eq === -1 || bar < eq))
      || ((text.charCodeAt(end) | 32) === 115 /* s */ && (beforeFlag === 32 || beforeFlag === 34 /* " */ || beforeFlag === 39 /* ' */))
      ? -1
      : SPECIFICITY_CLASS;
  }
  if (first === 35 /* # */) {
    return SPECIFICITY_ID;
  }
  if (first === 58 /* : */) {
    return pseudoClassSpecificity(text);
  }
  if (first === 42 /* * */) {
    return text.length === 1 ? 0 : -1;
  }
  const lower = first | 32;
  if (((lower >= 97 && lower <= 122) || first === 45 /* - */ || first === 95 /* _ */ || first >= 128) && !text.includes('|')) {
    return SPECIFICITY_TYPE;
  }

  /*
   * `&`, a placeholder's `\\`, escapes, digits, and a namespace prefix: `svg|*`
   * is universal, and `ns|a` is invalid when `ns` is undeclared.
   */
  return -1;
}

/**
 * The specificity a parsed selector branch carries into a group, or -1 when it
 * must stay out. `compoundOnly` is set when something precedes the `:is()`. A
 * selector-function argument may carry combinators.
 */
function astBranchSpecificity(branch: SelectorBranch, compoundOnly: boolean, inHas: boolean): number {
  if (branch.type === 'SimpleSelector' || branch.type === 'PseudoSelector') {
    return tokenSpecificity(branch, inHas);
  }
  if (compoundOnly && branch.type !== 'CompoundSelector') {
    return -1;
  }
  let sum = 0;
  for (const part of branch.value) {
    if (typeof part === 'string') {
      if (part === '|' || part === '||') {
        return -1;
      }
      continue;
    }
    const s = astBranchSpecificity(part, false, inHas);
    if (s < 0) {
      return -1;
    }
    sum += s;
  }
  return sum;
}

/**
 * The nesting fold's group key for one child branch of `A <child list>`. The
 * guarded fold (`'native'`) keys on specificity; the unguarded fold
 * (`'compact'`, group-max specificity) gives every descendant branch one key.
 * Either way a branch that leads with a combinator (`> .col`) is a relative
 * selector, invalid inside `:is()`, and joins `A` on its own. The namespace pipe
 * (`|h1`) is part of the compound, not a combinator.
 */
export function nestingGroupKey(branch: SelectorBranch, guarded: boolean): number {
  if (guarded) {
    return astBranchSpecificity(branch, true, false);
  }
  const comb = branch.type === 'RelativeSelector' ? branch.value[0] : undefined;
  return comb !== undefined && comb !== ' ' && comb !== '|' ? -1 : 0;
}

function irCompoundSpecificity(compound: Compound, compoundOnly: boolean): number {
  let sum = 0;
  for (const simple of compound.value) {
    const s = irSimpleSpecificity(simple, compoundOnly);
    if (s < 0) {
      return -1;
    }
    sum += s;
  }
  return sum;
}

/*
 * An extend group nested in a member is spliced in with that member when the outer
 * group splits, so its own members face the outer group's position (`compoundOnly`).
 * An authored or nesting `:is()` is the author's selector and only adds its score.
 */
function irSimpleSpecificity(simple: Simple, compoundOnly: boolean): number {
  if (simple.t === 'is') {
    let max = 0;
    for (const branch of simple.branches) {
      const s = extendBranchSpecificity(branch, simple.fold && compoundOnly);
      if (s < 0) {
        return -1;
      }
      if (s > max) {
        max = s;
      }
    }
    return max;
  }

  /*
   * A token the parser did not build one-to-one (a `&` replaced by its parent's text,
   * a dynamic extender's composed text) has no `src`. Its kind could only be read back
   * out of serialized text, so it stays out of every group.
   */
  const src = simple.src;
  return src === undefined ? -1 : 'value' in src ? irCompoundSpecificity(src, false) : tokenSpecificity(src, false);
}

/**
 * The specificity an extend IR branch carries into a group, or -1 when it must
 * stay out. `compoundOnly` as for the nesting fold. A member never leads with a
 * combinator: a relative selector is invalid inside `:is()`.
 */
export function extendBranchSpecificity(branch: Branch, compoundOnly: boolean): number {
  const segments = branch.segments;
  if (compoundOnly && segments.length !== 1) {
    return -1;
  }
  let sum = 0;
  for (let k = 0; k < segments.length; k++) {
    const segment = segments[k]!;
    const comb = segment.combinator;
    if (k === 0 ? comb !== ' ' : comb === '|' || comb === '||') {
      return -1;
    }
    const s = irCompoundSpecificity(segment.compound, compoundOnly);
    if (s < 0) {
      return -1;
    }
    sum += s;
  }
  return sum;
}

/* The distinct keys seen so far by {@link partitionGroups}, one slot per group;
 * reused by every call (nothing runs inside one) so a partition allocates only the
 * sizes it returns. */
const groupKeys: number[] = [];

/**
 * Partition a branch list into `:is()` groups, in place. On entry `keys[i]` is
 * branch `i`'s group key (its specificity, or one shared value when specificity
 * is not a gate); a negative key cannot join a group. Branches with equal keys
 * share a group however far apart they are, because order inside one selector
 * list changes neither the cascade nor specificity. On return `keys[i]` is the
 * branch's group number, numbered in order of first appearance, so a caller
 * emits group `g` at the first `i` where `keys[i] === g`. Returns each group's
 * size; a group of one is emitted as the plain branch.
 *
 * ponytail: linear search of the distinct-key table, O(n·groups). Lists are a
 * handful of branches; a key→group Map if a long list of distinct keys shows up.
 */
export function partitionGroups(keys: number[]): number[] {
  groupKeys.length = 0;
  const sizes: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    let group = key < 0 ? -1 : groupKeys.indexOf(key);
    if (group === -1) {
      group = groupKeys.length;
      groupKeys.push(key);
      sizes.push(0);
    }
    sizes[group]!++;
    keys[i] = group;
  }
  return sizes;
}
