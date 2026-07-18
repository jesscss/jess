/**
 * Clean-room tree2 eval + byte-faithful serializer.
 *
 * This is the decisive rung: tree2 does NOT pre-compose a tree and then print
 * it — it PRODUCES the compositions during a single eval+emit walk. The design
 * is departure #4 (canonical-body + placement-overlay):
 *
 *   - A mixin DEFINITION's body is stored ONCE.
 *   - A mixin CALL is a cheap OVERLAY: a binding frame (param -> arg value node)
 *     plus the current parent-selector context. The call expands by WALKING the
 *     shared body in place — no node is cloned, there is no `cloneForPlacement`
 *     / `inherit` analog. Selector composition happens via the interned-string
 *     primitive; declaration values resolve param refs through the frame.
 *
 * So the eval path stays O(placements) with a tiny constant: each placed nested
 * selector costs one interned-string build, each declaration one frame lookup.
 *
 * Scope is intentionally minimal (mixin defs + positional param bindings +
 * static/spaced values + `@param` substitution). Operations, guards, extend,
 * @media, imports, real variable scoping beyond params are deferred rungs.
 *
 * Entry points:
 *   - `serialize(root)`                     — fast path, no position tracking.
 *   - `serialize(root, { trackPositions })` — + node->offset sourcemap map.
 *   - `composeStats(root)`                  — untimed op-count instrumentation.
 */

import { renderCombinator } from './node.js';
import type { Node, NodeType } from './node.js';
import {
  any,
  dimension,
  isLiteralNode,
  isTypedLiteral,
  compoundCanonical,
  compoundHasInterp,
  complexCanonical,
  complexHasInterp,
  complexHasAmpersand,
} from './nodes.js';
import type {
  Any,
  Color,
  Complex,
  Compound,
  Declaration,
  DetachedCall,
  DetachedRuleset,
  Dimension,
  For,
  FunctionCall,
  Interp,
  Keyword,
  MapAccessor,
  MixinCall,
  MixinDef,
  Quoted,
  RawInline,
  Root,
  Rule,
  Simple,
  SelectorList,
  StyleImport,
  Statement,
  ValueNode,
  VarIndirect,
} from './nodes.js';
// [atrule] block + statement at-rule node types
import type { AtRuleBlock, AtRuleStatement } from './at-rule.js';
// typed synchronous value evaluator seam + boundary-clean value domain.
import {
  DEFAULT_MODES,
  emitValue,
  isLiteral,
  literal,
  type EvalModes,
  type List as ValueList,
  type Value,
  type ValueEvaluator,
  type ValueObj,
} from './value-eval.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { colorFromSrc, dimensionFromFields, quotedFromFields, materializeAny } from './literal-tag.js'; // [value node model]
import { calcInner } from './value-operate.js'; // [calc]
import { makeKeyword, makeBool, makeList } from './value-factory.js'; // [calc]
import { selectDefinitions, type Selection, type DefaultResolver, type CallArg } from './mixin-dispatch.js'; // [guards]
import { evalGuard, type GuardNode, type ValueResolver, type TypedResolver } from './guard.js'; // [guards]
import { computeExtends, type ExtendResults } from './extend.js'; // [extend]

/* ---------------------------------------------------- MaybePromise glue */

function mapMaybe<T, U>(m: MaybePromise<T>, f: (t: T) => MaybePromise<U>): MaybePromise<U> {
  return isThenable(m) ? m.then(f) : f(m);
}

function combineAll<T, U>(arr: Array<MaybePromise<T>>, f: (ts: T[]) => MaybePromise<U>): MaybePromise<U> {
  for (let i = 0; i < arr.length; i++) {
    if (isThenable(arr[i])) return Promise.all(arr).then(f);
  }
  return f(arr as T[]);
}

export interface Position {
  node: Node;
  type: NodeType;
  start: number;
  end: number;
}

export interface SerializeOptions {
  trackPositions?: boolean;
  /**
   * Injected TYPED synchronous value evaluator (the boundary-safe seam).
   * When present, tree2's `Operation` / `FunctionCall` value nodes are COMPUTED
   * through it over materialized typed value objects; when absent they fall back
   * to un-evaluated source assembly (tree2 does no math itself). tree2 depends
   * only on the `ValueEvaluator` interface.
   */
  evaluator?: ValueEvaluator;
  /** Configured math/unit/function modes (defaults to `DEFAULT_MODES`). */
  modes?: EvalModes;
  /**
   * [nested/R0] Selector collapse policy (arch E1). `true` (default, 4.x /
   * `collapseNesting:true`) flattens the authored block structure into composed
   * selector strings. `false` (the Less v5 DEFAULT) preserves the authored block
   * structure: a parent rule contains its nested child rules verbatim (each child
   * emits its OWN local selector — `&`/`> .x`/`.b, .c` stay literal), placed
   * mixin bodies splice inline under the call site, and `@media` bodies keep
   * their inner rules nested. Same single walk, second emit form.
   */
  collapseNesting?: boolean;
  /**
   * [resolver] OPTIONAL resolution mode. Default (unset) is STRICT: a
   * value-position variable/lookup that resolves to nothing is a hard eval error
   * (`ReferenceError`). When `true`, a miss instead passes the sigil through as a
   * literal sentinel (no throw) — for opt-in callers that inspect STRUCTURE with
   * intentionally-unbound refs (e.g. serializing a mixin-def body or an interp
   * shape in isolation), and the `isdefined` family.
   */
  optional?: boolean;
}

export interface SerializeResult {
  css: string;
  /** Present only when `trackPositions` is set. */
  positions?: Position[];
}

/**
 * `serialize` stays SYNCHRONOUS for all-sync value graphs and lifts to
 * `Promise<SerializeResult>` ONLY when a genuinely async built-in (a color-format
 * fn / file-IO fn) forces a leaf onto the async branch — the `isThenable` fork,
 * NOT a global record pre-pass.
 */
export type SerializeReturn = MaybePromise<SerializeResult>;

const INDENT = '  ';

/* ------------------------------------------------------------------- scope */

/**
 * A binding frame (the placement overlay). `mixins` holds definitions visible
 * at this level; `vars` holds param bindings for a mixin call. Frames chain to
 * their lexical parent for lookup.
 */
/**
 * A value bound to a `@name`. Usually a {@link ValueNode}; a `@p: .mk-map()`
 * binding carries a {@link MixinCall} whose OUTPUT the name accesses (`@p[text]`),
 * dispatched lazily on read (see {@link resolveBaseDeclMap}).
 */
type Binding = ValueNode | MixinCall;

export interface Frame {
  parent: Frame | null;
  // [guards] a name maps to ALL same-name defs (overloads), in definition order.
  mixins: Map<string, MixinDef[]> | null;
  // [resolver] a name maps to its SOURCE-ORDERED stack of declared value nodes
  // (last = most recent). A regular `@x`/`$x` read walks this stack BACKWARD,
  // skipping any value node currently in the active exclusion set (see
  // `resolveVarRef`), so `@a: @a + 1` falls back to an earlier same-name entry
  // instead of self-referencing. The stack — not a collapsed last-wins map — is
  // what makes per-declaration cycle exclusion expressible.
  vars: Map<string, Binding[]> | null;
  // [scope-leak] variables UNLOCKED into this frame by a mixin call in its body
  // (`leakBodyVars`). v5 "outer-binding-wins": the mixin-injected variable is NOT
  // hoisted into the ordinary `vars` scope — it is consulted ONLY after the whole
  // lexical chain (`vars` up every `parent`, plus `fallback`) misses. So a name
  // that ANY enclosing scope already binds resolves to that lexical binding
  // (`.tiny-scope`'s `@mix` → root `blue`), while a name bound NOWHERE else falls
  // through to the leaked value (`.heightIsSet`'s `@height` → the leaked `1024px`).
  // This drops the 4.x mixin-injected-variable hoist (which put the leak in `vars`
  // and let it shadow the outer binding → `#989`). See DESIGN-DECISIONS R2.
  leaked?: Map<string, Binding[]> | null;
  // secondary scope consulted after the `parent` chain is exhausted (the
  // detached-ruleset definition closure — caller-first, definition-fallback).
  fallback?: Frame | null;
  // rulesets visible at this level, keyed by their own-local selector
  // string (namespace path descent). Lazily built only when a namespaced call or
  // map/namespace accessor needs it.
  rulesets?: Map<string, Rule[]> | null;
  // [dedup] source-ordered dispatch candidates keyed by name: parametric MixinDefs
  // AND paren-less ruleset-mixins INTERLEAVED in authored order (unlike `mixins`,
  // which groups all parametric defs). Lazily built once from `statements` and
  // cached; published (unlocked) defs are merged in at lookup from `mixins`.
  orderedMixins?: Map<string, MixinDef[]> | null;
  // the statements this frame was built from (for lazy rulesets / decl-map).
  statements?: Statement[] | null;
}

// [guards] collect ALL definitions per name (overloaded dispatch), not last-wins.
function collectMixins(statements: Statement[]): Map<string, MixinDef[]> | null {
  let map: Map<string, MixinDef[]> | null = null;
  for (const s of statements) {
    if (s.type === 'MixinDef') {
      const list = (map ??= new Map()).get(s.name);
      if (list) list.push(s);
      else map.set(s.name, [s]);
    }
  }
  return map;
}

/**
 * Collect variable declarations in a scope into a per-name SOURCE-ORDERED STACK
 * of value nodes. Less variable semantics: LAST-wins within a scope (a later
 * `@x` overrides an earlier one) and LAZY (a reference resolves a variable
 * declared textually later in the same scope). Keeping the FULL ordered stack —
 * not a collapsed last-wins map — is what lets a self-referential declaration
 * (`@a: @a + 1`) fall back to an earlier same-name entry once its own node is
 * excluded (see `resolveVarRef`). The whole scope's stacks are built up-front so
 * a forward reference sees a complete index before any value is emitted.
 */
function collectVars(statements: Statement[]): Map<string, Binding[]> | null {
  let map: Map<string, Binding[]> | null = null;
  for (const s of statements) {
    if (s.type === 'VarDeclaration') {
      const stack = (map ??= new Map()).get(s.name);
      if (stack) stack.push(s.value);
      else map.set(s.name, [s.value]);
    }
  }
  return map;
}

/** Wrap a single-value binding map (mixin/function PARAMS) as per-name stacks so
 * it shares the STACK read path with regular declarations. A param is a 1-entry
 * stack; a body decl of the same name (merged AFTER, see `mergeVars`) sits later
 * in the stack and wins the backward walk — body-shadows-param falls out for
 * free. */
function asStacks(m: Map<string, ValueNode> | null): Map<string, Binding[]> | null {
  if (!m) return null;
  const out = new Map<string, Binding[]>();
  for (const [k, v] of m) out.set(k, [v]);
  return out;
}

// collect the rulesets defined directly in a scope, keyed by own-local
// selector string (namespace-path descent). Built lazily on first path lookup.
function collectRulesets(statements: Statement[]): Map<string, Rule[]> | null {
  let map: Map<string, Rule[]> | null = null;
  const add = (key: string, s: Rule): void => {
    const list = (map ??= new Map()).get(key);
    if (list) { if (!list.includes(s)) list.push(s); }
    else map.set(key, [s]);
  };
  for (const s of statements) {
    if (s.type === 'Rule') {
      for (const c of s.selector.selectors) {
        const key = complexCanonical(c);
        add(key, s);
        // A leading combinator (`#theme { > .mixin {} }` → key `> .mixin`) is a
        // child-descent placement; a namespace-accessor call (`#theme > .mixin()`)
        // dispatches by the bare own-local selector, so also key the stripped form.
        const stripped = key.replace(/^[>+~]\s*/u, '');
        if (stripped !== key) add(stripped, s);
      }
    }
  }
  return map;
}

function frameRulesets(frame: Frame): Map<string, Rule[]> | null {
  if (frame.rulesets !== undefined) return frame.rulesets;
  const built = frame.statements ? collectRulesets(frame.statements) : null;
  frame.rulesets = built;
  return built;
}

// [guards] collect every visible same-name def up the scope chain (nearest
// scope first), so overload resolution sees all candidates. after the
// `parent` chain, consult the first `fallback` seen (detached-ruleset closure).
function lookupMixinCandidates(frame: Frame | null, name: string): MixinDef[] {
  let out: MixinDef[] | null = null;
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const hit = f.mixins?.get(name);
    if (hit) {
      if (!out) out = hit.slice();
      else out.push(...hit);
    }
    if (f.fallback && !fb) fb = f.fallback;
  }
  if (fb) {
    const more = lookupMixinCandidates(fb, name);
    if (more.length) {
      if (!out) out = more;
      else out.push(...more);
    }
  }
  return out ?? [];
}

/**
 * [guards] Source-ordered candidate set for `name` within ONE frame: explicit
 * parametric `MixinDef`s AND paren-less rulesets callable as zero-arg mixins,
 * INTERLEAVED in authored order. Less expands every matching body in definition
 * order, and a braceless `.m {…}` sits at its source position AMONG the `.m(…)`
 * overloads — not lumped after all of them (the bug the old `[...defs, ...rules]`
 * concat produced). A frame with no `statements` list (e.g. a decl-map closure)
 * has no rule-mixins and falls back to its explicit-def map.
 */
/**
 * [dedup] Build (once, cached) a frame's source-ordered candidate map: for every
 * name, its parametric `MixinDef`s and paren-less ruleset-mixins in the order they
 * were authored. One O(statements) pass — the same cost class as
 * {@link collectMixins} / {@link collectRulesets} — so per-call lookup stays O(1)
 * (a map `get`), not a per-call statement walk.
 */
function frameOrderedMixins(f: Frame, e: EvalCtx): Map<string, MixinDef[]> | null {
  if (f.orderedMixins !== undefined) return f.orderedMixins;
  const st = f.statements;
  if (!st) return (f.orderedMixins = null);
  let map: Map<string, MixinDef[]> | null = null;
  for (const s of st) {
    if (s.type === 'MixinDef') {
      const list = (map ??= new Map()).get(s.name);
      if (list) list.push(s);
      else map.set(s.name, [s]);
    } else if (s.type === 'Rule') {
      // The names this rule answers to as a zero-arg mixin: each selector's
      // canonical form plus its leading-combinator-stripped form (mirrors the keys
      // `collectRulesets` builds). Collect UNIQUE keys first so a rule with two
      // selectors that canonicalize alike adds ONE candidate, not two.
      // [mixin-interp] an INTERPOLATED selector (`.@{name}`) keys under its RESOLVED
      // name in this frame (`.@{a1}` with `@a1: foo` answers to `.foo()`), so a call
      // dispatches on the concrete name the parser could not know statically.
      let keys: Set<string> | null = null;
      for (const c of s.selector.selectors) {
        const key = complexHasInterp(c) ? resolveComplex(c, f, e) : complexCanonical(c);
        (keys ??= new Set<string>()).add(key);
        const stripped = key.replace(/^[>+~]\s*/u, '');
        if (stripped !== key) keys.add(stripped);
      }
      if (keys) for (const key of keys) {
        // one synthesized candidate per name, interleaved at the rule's source position.
        // [guards] a guarded ruleset called as a zero-arg mixin filters on its guard.
        const rm: MixinDef = {
          type: 'MixinDef', name: key, params: [], body: s.body, ruleMixin: true,
          ...(s.guard !== undefined ? { guard: s.guard } : {}),
        };
        const list = (map ??= new Map()).get(key);
        if (list) list.push(rm); else map.set(key, [rm]);
      }
    }
  }
  return (f.orderedMixins = map);
}

/**
 * [dedup] A frame's source-ordered candidate list for `name`: the cached
 * interleaved parametric-def/ruleset-mixin list, plus any dynamically PUBLISHED
 * defs (detached-ruleset scope unlocking via `@rs()`, which pushes into `mixins`
 * without touching `statements`) appended.
 */
function frameCandidatesInOrder(f: Frame, name: string, e: EvalCtx): MixinDef[] {
  const mapDefs = f.mixins?.get(name);
  if (!f.statements) return mapDefs?.slice() ?? [];
  const base = frameOrderedMixins(f, e)?.get(name);
  if (!mapDefs) return base ? base.slice() : [];
  const out = base ? base.slice() : [];
  // Append published defs (in `mixins` but not authored in `statements`).
  for (const d of mapDefs) if (!out.includes(d)) out.push(d);
  return out;
}

/**
 * [guards] All source-ordered candidates for a bare `.m()` call up the scope chain
 * (nearest frame first), then the detached-ruleset `fallback` closure. The
 * interleaving replacement for the old `[...lookupMixinCandidates, ...lookupRuleMixins]`
 * concat, which dispatched every rule-mixin after every parametric def and so
 * mis-ordered overloaded output (`A B C border` instead of `A B border C`).
 */
function lookupCandidates(
  frame: Frame | null,
  name: string,
  e: EvalCtx,
  homes?: Map<MixinDef, Frame>, // [closure] def → the frame it was DEFINED in
): MixinDef[] {
  let out: MixinDef[] | null = null;
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const hit = frameCandidatesInOrder(f, name, e);
    if (hit.length) {
      if (homes) for (const d of hit) if (!homes.has(d)) homes.set(d, f);
      if (!out) out = hit.slice(); else out.push(...hit);
    }
    if (f.fallback && !fb) fb = f.fallback;
  }
  if (fb) {
    // The [closure] fallback chain (caller scope) can rejoin the parent (definition)
    // chain at a shared ancestor, so a def already collected must NOT be dispatched
    // twice: merge the fallback candidates by identity, first occurrence wins.
    const more = lookupCandidates(fb, name, e, homes);
    for (const d of more) if (!out || !out.includes(d)) (out ??= []).push(d);
  }
  return out ?? [];
}

/**
 * [mixin-match] Split a selector-token string into mixin-match ATOMS (`.foo` /
 * `#bar`), dropping combinators and the parent-ref `&` — Less resolves a mixin
 * call/definition on element VALUES only (`Selector.mixinElements`), so
 * combinator (` ` vs `>` vs compound-`.`) is irrelevant to the match and `&`
 * contributes nothing. `&.support` → [`.support`]; `.a.b` and `.a .b` both →
 * [`.a`, `.b`]. */
function selectorAtoms(text: string): string[] {
  const m = text.match(/[#.][\w-]+|&[\w-]*|[\w-]+/gu);
  if (!m) return [];
  const out: string[] = [];
  for (const a of m) {
    if (a === '&') continue;
    out.push(a.charAt(0) === '&' ? a.slice(1) : a);
  }
  return out;
}

/** [mixin-match] The element-value atom list of a `Complex` selector (head +
 * each tail compound), used to match a namespaced/compound mixin call. */
function complexAtoms(c: Complex): string[] {
  const out: string[] = [];
  for (const a of selectorAtoms(compoundCanonical(c.head))) out.push(a);
  for (const seg of c.tail) for (const a of selectorAtoms(compoundCanonical(seg.compound))) out.push(a);
  return out;
}

/** [mixin-match] The flat element-value atom list of a namespaced/compound mixin
 * CALL (`.a.b.c()` / `#ns > .m()` / `.do.re.mi()`), path segments then name. */
function callAtoms(call: MixinCall): string[] {
  const out: string[] = [];
  for (const p of call.path) for (const a of selectorAtoms(p.sel)) out.push(a);
  for (const a of selectorAtoms(call.name)) out.push(a);
  return out;
}

/** True iff `pref` is a prefix of `full` (element-value equality). */
function atomsArePrefix(pref: string[], full: string[]): boolean {
  if (pref.length > full.length) return false;
  for (let i = 0; i < pref.length; i++) if (pref[i] !== full[i]) return false;
  return true;
}

/**
 * [mixin-match] Recursively collect the mixin candidates a namespaced/compound
 * call resolves to WITHIN one scope's own rulesets (Less `Ruleset.find`): a
 * ruleset whose element atoms are a prefix of `remaining` either terminates the
 * match (its whole element run is consumed → its body is a zero-arg mixin) or
 * descends (a proper prefix → recurse into its body with the tail). A parametric
 * `MixinDef` terminates when its name atoms equal `remaining` exactly. Each
 * pushed candidate records its DEFINITION scope in `homes` (closure/guard scope).
 */
function findPathInScope(
  scope: Frame,
  remaining: string[],
  homes: Map<MixinDef, Frame>,
  out: MixinDef[],
  e: EvalCtx,
): void {
  const st = scope.statements;
  if (!st) return;
  for (const s of st) {
    if (s.type === 'MixinDef') {
      const nEl = selectorAtoms(s.name);
      if (nEl.length === remaining.length && atomsArePrefix(nEl, remaining)) {
        out.push(s);
        if (!homes.has(s)) homes.set(s, scope);
      }
    } else if (s.type === 'Rule') {
      for (const c of s.selector.selectors) {
        // [mixin-interp] an interpolated selector resolves in THIS scope before its
        // element atoms are taken, so a compound/namespaced call matches on the
        // concrete name (`#@{c1}-foo > .@{c2}()` answers `#foo-foo > .bar()`).
        const el = complexHasInterp(c) ? selectorAtoms(resolveComplex(c, scope, e)) : complexAtoms(c);
        if (el.length === 0 || !atomsArePrefix(el, remaining)) continue;
        if (el.length === remaining.length) {
          const rm: MixinDef = {
            type: 'MixinDef',
            name: complexHasInterp(c) ? resolveComplex(c, scope, e) : complexCanonical(c),
            params: [], body: s.body, ruleMixin: true,
            ...(s.guard !== undefined ? { guard: s.guard } : {}),
          };
          out.push(rm);
          homes.set(rm, scope);
        } else {
          const child: Frame = {
            parent: scope,
            mixins: collectMixins(s.body),
            vars: collectVars(s.body),
            statements: s.body,
          };
          findPathInScope(child, remaining.slice(el.length), homes, out, e);
        }
        break; // one selector of a rule matches the prefix at most once
      }
    }
  }
}

/**
 * [mixin-match] Source-ordered candidates for a namespaced/compound call, found
 * by element-value descent. Walk the scope chain from the call site; the FIRST
 * frame whose own rulesets yield a match wins (Less iterates `context.frames`
 * and uses the first that `find`s the selector). Supersedes the old
 * one-key-per-segment `descendNamespacePath` + `ownCandidates`, which could not
 * match a compound def (`.jo.ki()`), an `&`-nested step (`.amp.support()`), or a
 * call whose compound run spans a descendant-nested definition
 * (`.do.re.mi.fa.sol.la.si()`). */
function findPathCandidates(frame: Frame, call: MixinCall, e: EvalCtx, homes: Map<MixinDef, Frame>): MixinDef[] {
  const elements = callAtoms(call);
  if (elements.length === 0) return [];
  for (let f: Frame | null = frame; f; f = f.parent) {
    const out: MixinDef[] = [];
    findPathInScope(f, elements, homes, out, e);
    if (out.length) return out;
    if (f.fallback) {
      findPathInScope(f.fallback, elements, homes, out, e);
      if (out.length) return out;
    }
  }
  return [];
}

/**
 * [parent-exclusion] Is `body` (a ruleset-mixin's source Rule body array) held by
 * an ENCLOSING frame on the active expansion stack — i.e. is this candidate the
 * mixin/ruleset we are already inside?
 *
 * This is the mixin half of the ONE exclusion principle this file uses to break
 * self-reference: a self-reference that cannot make PROGRESS is EXCLUDED from
 * candidacy, so resolution falls through to a real (progressing) binding rather
 * than re-entering itself.
 *   - Variable half — `resolveVarStack` / `resolvePropRef` `continue` past any
 *     value node in `e.excluded` (the declaration whose value is currently being
 *     evaluated), so `@a: @a + 1` skips its own node and binds an earlier `@a`.
 *   - Mixin half (here) — a NON-PARAMETRIC ruleset self-call excludes its own
 *     enclosing frame from the candidate set, so `.recursion { .recursion(); }`
 *     re-binds to a same-name parametric def (or no-ops) instead of re-entering
 *     its own body. A non-parametric re-entry can carry no new args and so makes
 *     no progress; skipping it is exactly right. This is NOT "recursion
 *     detection" — it is the enclosing frame declining to be its own candidate.
 *     Parametric recursion (`.loop(@n - 1)`) DOES progress (new args) and is
 *     never excluded here; guards terminate it, and the depth backstop in
 *     `expandCall` catches a non-terminating (bad-guard) runaway.
 *
 * The frame chain (`parent`, then the detached-ruleset `fallback` closure)
 * reflects the dynamic nesting — a Rule placement (`flatten`) and a mixin
 * expansion (`expandCall`) both seed the child frame's `statements` with the body
 * being walked — so an identity hit means we are inside that very ruleset. Mirrors
 * less@4's `mixin === context.frames[f]` check, scoped to ruleset-mixins.
 */
function parentExcludes(frame: Frame | null, body: Statement[]): boolean {
  for (let f = frame; f; f = f.parent) {
    if (f.statements === body) return true;
    if (f.fallback && parentExcludes(f.fallback, body)) return true;
  }
  return false;
}

/**
 * The nearest last-wins binding for `name` (top of the nearest non-empty stack).
 * Used by the detached-ruleset / namespace paths that need the CURRENT value node
 * (e.g. to test `.type === 'DetachedRuleset'`); it does not honor exclusion
 * because those callers resolve a name to a concrete ruleset binding, not a lazy
 * self-referential value. The regular value read uses `resolveVarRef` instead.
 */
function lookupVarStack(frame: Frame | null, name: string, leaked: boolean): Binding | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const stack = (leaked ? f.leaked : f.vars)?.get(name);
    if (stack && stack.length > 0) {
      const hit = stack[stack.length - 1]!;
      // capture a detached ruleset's definition (home) frame on first use.
      if (hit.type === 'DetachedRuleset' && hit.defFrame === null) hit.defFrame = f;
      return hit;
    }
    if (f.fallback && !fb) fb = f.fallback;
  }
  if (fb) return lookupVarStack(fb, name, leaked);
  return undefined;
}

function lookupVar(frame: Frame | null, name: string): Binding | undefined {
  // [scope-leak] lexical `vars` first up the whole chain; the low-priority
  // mixin-leaked scope is consulted only when no lexical binding exists.
  return lookupVarStack(frame, name, false) ?? lookupVarStack(frame, name, true);
}

/**
 * [resolver] Resolve a regular `@name`/`$name` read to its winning declaration
 * value node PLUS the frame that owns it, honoring the active EXCLUSION set. The
 * backward `for` walk over each frame's per-name stack `continue`s past any value
 * node currently being evaluated (in `e.excluded`); the first survivor wins, else
 * it ascends to `parent` (then the detached-ruleset `fallback` closure). This is
 * the cycle guard: `@a: @a + 1` excludes its own node → skips it → falls back to
 * an earlier `@a` (or misses); `@a: @b; @b: @a` accumulates both exclusions and
 * terminates at any depth. There is NO depth cap. The value is returned with its
 * OWNING frame so it evaluates in its declaration scope. */
function resolveVarStack(
  frame: Frame | null,
  name: string,
  e: EvalCtx,
  leaked: boolean,
): { value: Binding; frame: Frame } | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const stack = (leaked ? f.leaked : f.vars)?.get(name);
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const v = stack[i]!;
        if (!e.excluded.has(v)) return { value: v, frame: f };
      }
    }
    if (f.fallback && !fb) fb = f.fallback;
  }
  if (fb) return resolveVarStack(fb, name, e, leaked);
  return undefined;
}

function resolveVarRef(frame: Frame | null, name: string, e: EvalCtx): { value: Binding; frame: Frame } | undefined {
  // [scope-leak] v5 outer-binding-wins: resolve against the lexical `vars` scope
  // (own frame → every `parent` → `fallback`) FIRST; only when that whole chain
  // misses do we consult the low-priority mixin-leaked scope.
  return resolveVarStack(frame, name, e, false) ?? resolveVarStack(frame, name, e, true);
}

/**
 * [property-accessor] Resolve a `$name` property accessor to the winning
 * declaration of CSS property `name` in scope. Less "property accessors" read the
 * LAST declaration of the property in the enclosing ruleset (last-wins, lazy) and
 * cascade up the ruleset chain (`$color` in a nested rule reads the parent
 * ruleset's final `color`). The source declaration's `!important` rides along in
 * the returned value node's own bytes (a non-merge declaration keeps it verbatim).
 * Only DIRECT declarations a frame carries in `statements` are considered — the
 * backward stack walk skips any declaration whose value is currently on the
 * exclusion set, which breaks the self-reference `color: $color` (its own value
 * node is excluded during evaluation, so the accessor falls back to an earlier /
 * ancestor `color`). Returns the value node and its owning frame; `undefined` when
 * no such property is in scope. */
function resolvePropRef(
  frame: Frame | null,
  name: string,
  e: EvalCtx,
): { value: ValueNode; frame: Frame } | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const st = f.statements;
    if (st) {
      for (let i = st.length - 1; i >= 0; i--) {
        const s = st[i]!;
        if (s.type !== 'Declaration') continue;
        if (e.excluded.has(s.value)) continue;
        let nm: string;
        if (typeof s.name === 'string') {
          nm = s.name;
        } else {
          // A declaration with an INTERPOLATED name — guard against re-entering it
          // while resolving the very property its own name interpolates (`${prop-name}`).
          if (e.propNames.has(s)) continue;
          e.propNames.add(s);
          nm = declName(s, f, e);
          e.propNames.delete(s);
        }
        if (nm === name) return { value: s.value, frame: f };
      }
    }
    if (f.fallback && !fb) fb = f.fallback;
  }
  if (fb) return resolvePropRef(fb, name, e);
  return undefined;
}

/**
 * [resolver] Evaluate a resolved variable's value node while it is EXCLUDED for
 * the sync span of the eval — added before the (possibly recursive) evaluation
 * begins, removed the instant that call returns SYNCHRONOUSLY (the `finally` runs
 * on the sync return, NOT on a later promise settle — so accumulation is correct
 * down a sync descent, and two overlapping async reads of the same decl do not
 * falsely block each other). `run` returns whatever the caller's fold produces. */
function withExcluded<T>(e: EvalCtx, node: Binding, run: () => T): T {
  e.excluded.add(node);
  try {
    return run();
  } finally {
    e.excluded.delete(node);
  }
}

/**
 * [resolver] An unresolved value-position reference. STRICT (default): a miss is
 * a hard eval error (`ReferenceError`) — the single consolidated site for what
 * were five hardcoded ``@${name}`` passthroughs. OPTIONAL (`e.optional`, set by
 * `isdefined` / opt-in callers): a miss returns the literal sigil string as a
 * sentinel, no throw. */
/**
 * Evaluate a variable BINDING in a value position. A `@p: .mk-map()` mixin-call
 * binding is not byte-serializable there — it is only accessible/callable (`@p[k]`,
 * `@p()`), so like a detached ruleset reaching a value position it folds to empty
 * bytes; every other binding is an ordinary value node. */
function evalBinding(b: Binding, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  return b.type === 'MixinCall' ? literal('') : evalValue(b, frame, e);
}

function unresolvedRef(name: string, e: EvalCtx): Value {
  if (!e.optional) throw new ReferenceError(`variable @${name} is undefined`);
  return literal(`@${name}`);
}

/**
 * [guards] A SYNC byte resolver bound to a frame — resolves a value node to its
 * (variable-resolved) byte source. Used by mixin dispatch to eagerly resolve args
 * in the caller frame (pattern-match by bytes) and `@arguments`/rest joining.
 * Dispatch positions are sync (no async fns appear in guard/pattern positions);
 * a stray async value there raises rather than being silently mis-dispatched.
 */
function makeResolver(frame: Frame | null, e: EvalCtx): ValueResolver {
  return (v: ValueNode) => {
    const b = evalBytes(v, frame, e);
    if (isThenable(b)) throw new Error('async value in a synchronous dispatch position');
    return b;
  };
}

/**
 * [R2/guards] A TYPED resolver: materializes a value node to a typed `ValueObj`
 * (guard leaves compare typed values / call type-fns). Sync for the same reason.
 */
function makeTypedResolver(frame: Frame | null, e: EvalCtx): TypedResolver {
  return (v: ValueNode) => {
    const val = evalTyped(v, frame, e);
    if (isThenable(val)) throw new Error('async value in a synchronous guard position');
    return val;
  };
}

/* ---------------------------------------------------- typed value eval */

/** The evaluator + modes carried through the value lane (a slim view of Emit). */
interface EvalCtx {
  ev: ValueEvaluator | null;
  modes: EvalModes;
  // [resolver] value nodes currently being evaluated (per-declaration cycle
  // guard). A backward stack walk `continue`s past any node in this set; it
  // accumulates down a sync descent and releases on sync-phase completion.
  excluded: Set<Binding>;
  // [resolver] when true, a variable/lookup miss returns a sentinel instead of
  // throwing (`isdefined` / opt-in callers). Default (unset) is STRICT: miss
  // throws `ReferenceError`.
  optional?: boolean;
  // [calc] `calc(…)` nesting depth. While > 0, dimension math is gated to the
  // safe-unit subset and cross-unit ops preserve as `calc(…)` sub-expressions.
  calcDepth?: number;
  // [property-interp] declarations whose INTERPOLATED name (`${prop}: …` /
  // `@{v}: …`) is being resolved up-stack. `resolvePropRef` skips a candidate whose
  // name is already in flight, breaking the self-reference `${prop-name}: red` where
  // `prop-name`'s own accessor would otherwise re-enter this decl's name forever.
  propNames: Set<Declaration>;
}

/** Force a computed `Value` to a typed object. A computed STRING carries no parse
 * tag → the evaluator sniffs (untagged fallback); a materialized object passes through. */
function force(e: EvalCtx, v: Value): ValueObj {
  if (!isLiteral(v)) return v;
  if (!e.ev) return { type: 'Keyword', text: v, bytes: v };
  return e.ev.materialize(v);
}

/**
 * Materialize a value-literal LEAF node to a typed `ValueObj`, driven by the node
 * `type` (task #44 — no side-car tag). Each typed leaf builds from its own fields
 * (`Color`/`Dimension`/`Quoted`), never re-classifying `src`; the opaque `Any` leaf
 * (alone) sniffs its bytes. When no evaluator is injected every leaf degrades to a
 * bare keyword of its `src` (the former `forceLiteral` no-`ev` behavior).
 */
function materializeNode(node: Keyword | Color | Dimension | Quoted | Any, e: EvalCtx): ValueObj {
  if (!e.ev) return { type: 'Keyword', text: node.src, bytes: node.src };
  switch (node.type) {
    case 'Keyword': return { type: 'Keyword', text: node.src, bytes: node.src };
    case 'Color': return colorFromSrc(node.src);
    case 'Dimension': return dimensionFromFields(node.number, node.unit, node.src);
    case 'Quoted': return quotedFromFields(node.value, node.quote, node.escaped, node.src);
    case 'Any': return materializeAny(node.src);
  }
}

/**
 * TYPED fold: materialize a value node to a typed `ValueObj` for an OPERATED
 * / compared / typed-param position — sourcing the literal's TYPE from the parse
 * (the node's own `type`), NOT by re-classifying bytes. A typed leaf
 * (`Keyword`/`Color`/`Dimension`/`Quoted`) builds directly from its fields; the
 * opaque `Any` leaf sniffs. Variable refs / parens are transparent.
 */
function evalTyped(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<ValueObj> {
  switch (node.type) {
    case 'Keyword':
    case 'Color':
    case 'Dimension':
    case 'Quoted':
    case 'Any':
      return materializeNode(node, e);
    case 'VarRef': {
      const hit = resolveVarRef(frame, node.name, e);
      if (!hit) return force(e, unresolvedRef(node.name, e));
      const bound = hit.value;
      return withExcluded(e, bound, () =>
        bound.type === 'MixinCall'
          ? force(e, literal(''))
          : evalTyped(bound, hit.frame, e),
      );
    }
    case 'Paren':
      return evalTyped(node.inner, frame, e);
    case 'List': {
      // A comma-list materializes to the value-domain `List`, its items materialized
      // LAZILY here (only now that the list is actually consumed typed — indexed by
      // `extract`, counted by `length`, or compared). The structure the parser owns
      // is handed to the value layer directly — no re-splitting a joined string.
      const typed = node.items.map((it) => evalTyped(it, frame, e));
      return combineAll(typed, (vals) => makeList(vals, node.sep));
    }
    default:
      // Computed / joined shapes (Operation, FunctionCall, Concat, SpacedValue,
      // Interp, VarIndirect, MapAccessor, …): fold to a Value then force. A
      // computed string has no parse tag → the evaluator sniffs.
      return mapMaybe(evalValue(node, frame, e), (v) => force(e, v));
  }
}

/**
 * v5 comma value-list separator normalization. `raw` is the verbatim source
 * between two trimmed items (may include spacing before the comma, the comma,
 * and spacing after). An inline separator — any authored spacing, incl. none —
 * collapses to the canonical `, `. A separator whose trailing run carries a
 * NEWLINE keeps the authored multi-line layout (the newline + following
 * indentation) so a wrapped list stays wrapped. This governs SEPARATORS only;
 * each list item's own value token is still emitted source-verbatim.
 */
function normalizeListSep(raw: string): string {
  const after = raw.slice(raw.indexOf(',') + 1);
  const nl = after.indexOf('\n');
  return nl === -1 ? ', ' : `,${after.slice(nl)}`;
}

/**
 * Fold a value AST node bottom-up to a typed `Value` (a bare-string literal
 * for the static ~98% case, or a materialized `ValueObj` for a computed
 * operation/function). Lifts to `MaybePromise` only when a function call returns
 * a genuine thenable.
 */
function evalValue(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  switch (node.type) {
    // Every value LITERAL is inert here: emit its verbatim `src` as a bare string.
    // CORRECTION 5 — return `literal(node.src)` (a BARE STRING), never the node
    // object: an AST literal node must not leak into the `Value = ValueObj | string`
    // lane (a downstream `v.type==='Color'` would misread it as a value object).
    case 'Keyword':
    case 'Color':
    case 'Dimension':
    case 'Quoted':
    case 'Any':
      return literal(node.src);
    case 'VarRef': {
      const hit = resolveVarRef(frame, node.name, e);
      if (!hit) return unresolvedRef(node.name, e);
      return withExcluded(e, hit.value, () => evalBinding(hit.value, hit.frame, e));
    }
    case 'PropRef': {
      // A `$name` property accessor: resolve the winning `name` declaration in
      // scope and fold its value. The resolved value node carries any `!important`
      // verbatim in its own bytes (a non-merge declaration keeps it), so the flag
      // rides along for free — `$color` of `color: red !important` → `red !important`.
      // An unresolvable property (only reachable after a not-yet-modelled expansion)
      // keeps the verbatim `$name` bytes rather than throwing (no regression).
      const hit = resolvePropRef(frame, node.name, e);
      if (!hit) return literal(node.bytes);
      return withExcluded(e, hit.value, () => evalValue(hit.value, hit.frame, e));
    }
    case 'Sequence':
      return joinBytes(node.parts, '', frame, e);
    case 'SpacedValue':
      return joinBytes(node.parts, ' ', frame, e);
    case 'List': {
      // Emit each item's bytes joined by the v5-NORMALIZED comma separator. Authored
      // inline spacing around a comma is NOT preserved — it collapses to `, ` (the
      // `.css` acceptance goldens pin this: css-escapes turns a source `'a','b', c`
      // into `'a', 'b', c`). A separator that carries a NEWLINE keeps the authored
      // multi-line layout (newline + indentation), so a wrapped comma list such as a
      // multi-line `box-shadow` stays wrapped (see css-3.css). Each ITEM's own token
      // still emits verbatim; only the inter-item separator is normalized.
      const items = node.items.map((it) => evalValue(it, frame, e));
      return combineAll(items, (vals) => {
        let out = emitValue(vals[0]!);
        for (let i = 1; i < vals.length; i++)
          out += normalizeListSep(node.separators[i - 1]!) + emitValue(vals[i]!);
        return literal(out);
      });
    }
    case 'Paren':
      // Transparent to computed bytes: a materialized (operated) inner strips the
      // paren (matching the legacy oracle); an un-forced literal keeps its parens.
      return mapMaybe(evalValue(node.inner, frame, e), (v) =>
        isLiteral(v) ? literal(`(${v})`) : v,
      );
    case 'Condition':
      // [condition-grammar] The logical fns (`if`/`boolean`/…) read a condition's
      // `guard` DIRECTLY (see `evalLogical`), so a `Condition` reaching this value
      // lane is an UN-consumed condition — an ordinary/unknown call's arg that merely
      // happened to carry a top-level operator (e.g. a mis-parsed `url(…charset=utf-8…)`).
      // Emit it VERBATIM, exactly as it was spelled, rather than collapsing it to a bool.
      return literal(node.src);
    case 'Operation': {
      if (!e.ev) {
        // Fallback: un-evaluated, variable-resolved source assembly (no math).
        const l = evalValue(node.left, frame, e);
        const r = evalValue(node.right, frame, e);
        return combineAll([l, r], ([lv, rv]) =>
          literal(`${emitValue(lv)} ${node.operator} ${emitValue(rv)}`),
        );
      }
      const ev = e.ev;
      // Operands are materialized TYPED (tag sourced from the parse), not re-sniffed.
      const l = evalTyped(node.left, frame, e);
      const r = evalTyped(node.right, frame, e);
      // Inside `calc(…)`, flag the modes so cross-unit math preserves (guard 3).
      const m: EvalModes = (e.calcDepth ?? 0) > 0 ? { unitMode: e.modes.unitMode, inCalc: true } : e.modes;
      return combineAll([l, r], ([lv, rv]) => ev.operate(node.operator, lv, rv, m));
    }
    case 'FunctionCall':
      return evalCall(node, frame, e);
    case 'Interp':
      return evalInterp(node, frame, e);
    case 'VarIndirect': {
      // Resolve the name expression to bytes (unquoted), then read that variable
      // through the normal exclusion-aware stack walk (`@@name` = two chained reads).
      return mapMaybe(evalBytes(node.nameRef, frame, e), (raw) => {
        const nm = stripOuterQuotes(raw);
        const hit = resolveVarRef(frame, nm, e);
        if (!hit) return unresolvedRef(nm, e);
        return withExcluded(e, hit.value, () => evalBinding(hit.value, hit.frame, e));
      });
    }
    case 'MapAccessor':
      return evalMapAccessor(node, frame, e);
    case 'DetachedRuleset':
      // A detached ruleset reaching a value/arg position is not byte-serializable:
      // it can only be *called* (`@dr()`). less.js drops such an argument to an
      // ordinary function (`fn({…})` → `fn()`), so it folds to empty bytes here
      // rather than throwing. (Full `if()`/`isruleset()`/`isdefined()` DR handling —
      // which evaluates and can RETURN a detached ruleset — is the deferred
      // condition-grammar / FnCtx capability wave, not this path.)
      return literal('');
  }
}

/** Resolve an interpolation template to bytes (literals + spliced refs). */
function evalInterp(node: Interp, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const pieces: Array<MaybePromise<string>> = [];
  for (const part of node.parts) {
    if ('lit' in part) pieces.push(part.lit);
    else {
      const bytes = evalBytes(part.ref, frame, e);
      pieces.push(part.unquote ? mapMaybe(bytes, stripOuterQuotes) : bytes);
    }
  }
  return combineAll(pieces, (strs) => literal(resolveEmergentInterp(strs.join(''), frame, e)));
}

/** A Less identifier byte (`@{name}` name class: `-_A-Za-z0-9` + non-ASCII). */
function isInterpNameByte(c: number): boolean {
  return c === 0x2d /* - */ || c === 0x5f /* _ */
    || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c >= 0x80;
}

/**
 * Re-resolve any `@{ident}` token that EMERGED after a first-pass splice, matching
 * less.js's iterative `Quoted.eval` (`@{box-@{suffix}}` → `@{box-large}` → `100px`;
 * `@{box}-@{suffix}}` where `@box` is `@{box` → `@{box-large}` → `100px`). Each
 * clean `@{name}` whose variable resolves is replaced with its unquoted bytes; the
 * scan repeats until the string stops changing. A token whose variable is NOT in
 * scope (or resolves asynchronously) is left literal — a non-resolving emergent
 * token never turns a value into an error. Short-circuits when no `@{` remains.
 */
function resolveEmergentInterp(input: string, frame: Frame | null, e: EvalCtx): string {
  let cur = input;
  while (cur.indexOf('@{') !== -1) {
    let out = '';
    let i = 0;
    let changed = false;
    const n = cur.length;
    while (i < n) {
      if (cur.charCodeAt(i) === 0x40 /* @ */ && i + 1 < n && cur.charCodeAt(i + 1) === 0x7b /* { */) {
        let j = i + 2;
        if (j < n && cur.charCodeAt(j) === 0x2d /* - */) j++;
        const nameStart = j;
        while (j < n && isInterpNameByte(cur.charCodeAt(j))) j++;
        if (j > nameStart && j < n && cur.charCodeAt(j) === 0x7d /* } */) {
          const name = cur.slice(i + 2, j).trim();
          const hit = resolveVarRef(frame, name, e);
          if (hit) {
            const val = withExcluded(e, hit.value, () => evalBinding(hit.value, hit.frame, e));
            if (!isThenable(val)) {
              out += stripOuterQuotes(emitValue(val));
              i = j + 1;
              changed = true;
              continue;
            }
          }
        }
      }
      out += cur[i]!;
      i++;
    }
    if (!changed) break;
    cur = out;
  }
  return cur;
}

/** Strip ONE matching layer of surrounding `'…'` / `"…"` quotes. */
function stripOuterQuotes(s: string): string {
  if (s.length >= 2) {
    const a = s[0];
    if ((a === '"' || a === "'") && s[s.length - 1] === a) return s.slice(1, -1);
  }
  return s;
}

/* --------------------------------------------------- map / namespace */

/** One resolved declaration in a map/namespace body (name → value in a frame). */
interface DeclEntry {
  name: string;
  value: ValueNode;
  frame: Frame | null;
}

/** Collect a body's declarations into a name→value map (+ ordered list). */
function evalToDeclMap(statements: Statement[], frame: Frame | null, e: EvalCtx): {
  byName: Map<string, DeclEntry>;
  list: DeclEntry[];
} {
  const byName = new Map<string, DeclEntry>();
  const list: DeclEntry[] = [];
  for (const s of statements) {
    // A map/namespace body member is either a CSS declaration (`text: white`,
    // looked up by property name / `$prop`) or a variable declaration
    // (`@color: blue`, looked up by variable name / `@var`). The accessor key
    // model (`accessorKey`) collapses `$prop`/`@var`/bare into one name-keyed
    // lookup, so both member kinds share the one `byName` map (source-order,
    // last-wins), mirroring Less's per-name last-declaration-wins.
    if (s.type === 'Declaration') {
      const name = typeof s.name === 'string' ? s.name : evalBytesSync(s.name, frame, e);
      const entry: DeclEntry = { name, value: s.value, frame };
      byName.set(name, entry); // last-wins
      list.push(entry);
    } else if (s.type === 'VarDeclaration' && s.value.type !== 'MixinCall') {
      // A `@var:` member (a mixin-CALL-bound member is not directly serializable as
      // a map value — unreachable in the modelled fixtures — so it is skipped).
      const entry: DeclEntry = { name: s.name, value: s.value, frame };
      byName.set(s.name, entry); // last-wins
      list.push(entry);
    }
  }
  return { byName, list };
}

/** Resolve a map/namespace accessor's base to a declaration map + its frame. */
function resolveBaseDeclMap(
  base: ValueNode,
  frame: Frame | null,
  e: EvalCtx,
): { byName: Map<string, DeclEntry>; list: DeclEntry[] } | null {
  // A `#namespace` / `.map` selector base → the union of matching rulesets' decls.
  // The base is an opaque selector fragment (`Any`) or a bare ident (`Keyword`).
  if (base.type === 'Any' || base.type === 'Keyword') {
    const sel = base.src;
    for (let f = frame; f; f = f.parent) {
      const rules = f.rulesets !== undefined || f.statements ? frameRulesets(f)?.get(sel) : undefined;
      if (rules && rules.length) {
        const bodyFrame: Frame = {
          parent: f,
          mixins: null,
          vars: collectVars(rules.flatMap((r) => r.body)),
        };
        return evalToDeclMap(rules.flatMap((r) => r.body), bodyFrame, e);
      }
    }
    return null;
  }
  // Any other base resolves to a ruleset body through the shared resolver: a
  // direct `DetachedRuleset`, a `@var` bound to one (or, transitively, to another
  // `@map[k]` accessor — the chained-accessor case `@scheme: @m[@k]; @scheme[@c]`),
  // or a `@map[k]` accessor whose matched member is a detached ruleset. Its body
  // decls (both `prop:` and `@var:` members, via `evalToDeclMap`) are the map.
  const rs = resolveForRuleset(base, frame, e);
  if (rs) {
    const bodyFrame: Frame = {
      parent: rs.frame,
      mixins: collectMixins(rs.body),
      vars: collectVars(rs.body),
    };
    return evalToDeclMap(rs.body, bodyFrame, e);
  }
  // A base `@var` bound to a mixin CALL (`@p: .mk-map(); @p[text]`): dispatch the
  // call and treat its EMITTED declarations as the map (the same reconstruction the
  // `each(.mixin(), …)` iterable uses — `forItemsFromMixinCall`).
  if (base.type === 'VarRef' && frame) {
    const bound = lookupVar(frame, base.name);
    if (bound && bound.type === 'MixinCall') return declMapFromMixinCall(bound, frame, e);
  }
  return null;
}

/** Dispatch a mixin CALL and collect its emitted declarations as a member map
 *  (`prop:` and `@var:` members), for a `@p: .mk-map()`-bound accessor base. Mirrors
 *  {@link forItemsFromMixinCall}; nested rules are captured and discarded (a map is
 *  its declarations). Needs a scratch {@link Emit} — the capture is thrown away. */
function declMapFromMixinCall(
  call: MixinCall,
  frame: Frame,
  e: EvalCtx,
): { byName: Map<string, DeclEntry>; list: DeclEntry[] } {
  const em = scratchEmit(e);
  const collected: Leaf[] = [];
  const noop = (): void => {};
  // Collect EVERY declaration (`forceLeading` → all decls to `collected`), discard
  // nested rules (they defer to `trailing`, which is never drained here).
  const discard: Partition = { encounteredContainer: false, trailing: [], pending: [], emitBlock: noop };
  expandCall(call, null, null, frame, collected, noop, discard, em, false, false, true);
  const byName = new Map<string, DeclEntry>();
  const list: DeclEntry[] = [];
  for (const leaf of collected) {
    const n = leaf.node;
    let name: string;
    if (n.type === 'Declaration') name = typeof n.name === 'string' ? n.name : evalBytesSync(n.name, leaf.frame, em);
    else if (n.type === 'VarDeclaration') name = n.name;
    else continue;
    const value = n.value;
    // A mixin body that itself binds a `@x: .other()` re-nests a mixin call; it is
    // not directly value-serializable, so skip it as a map member (unreachable in
    // the modelled fixtures — keeps the member map value-typed).
    if (value.type === 'MixinCall') continue;
    const entry: DeclEntry = { name, value, frame: leaf.frame };
    byName.set(name, entry);
    list.push(entry);
  }
  return { byName, list };
}

function evalMapAccessor(node: MapAccessor, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const map = resolveBaseDeclMap(node.base, frame, e);
  // The base does not resolve to a map/ruleset in the current ast/ scope (e.g. it
  // is bound by a not-yet-modelled mixin-call / `each` result) — keep the verbatim
  // accessor bytes rather than throwing, so the value never regresses (it resolves
  // once the base binding is modelled).
  if (!map) return literal(node.bytes);
  let matched: DeclEntry | undefined;
  if (node.keyIsProp) {
    const key = typeof node.key === 'number' ? String(node.key) : evalBytesSync(node.key, frame, e);
    matched = map.byName.get(key);
    // A property-style key whose resolved value is a bare integer is a 1-based list
    // index (`@list[@i]` where `@i` is numeric), not a property name.
    if (!matched && isIntegerString(key)) {
      const i = parseInt(key, 10);
      matched = map.list[i < 0 ? map.list.length + i : i - 1];
    }
  } else {
    const idx = node.key as number;
    const i = idx < 0 ? map.list.length + idx : idx - 1; // 1-based; negative from end
    matched = map.list[i];
  }
  if (!matched) return literal(node.bytes);
  return evalValue(matched.value, matched.frame, e);
}

/**
 * Follow a `@var` → … → `@var` binding chain to the concrete value node it names
 * (non-throwing; stops at the first non-`VarRef`). Returns `undefined` if any link
 * is unbound. Used by the detached-ruleset introspection functions, which must
 * inspect the BINDING (a `DetachedRuleset` node) rather than materialize it.
 */
function resolveBindingNode(node: Binding, frame: Frame | null): Binding | undefined {
  let cur: Binding | undefined = node;
  const seen = new Set<Binding>();
  while (cur && cur.type === 'VarRef') {
    if (seen.has(cur)) return undefined; // cyclic
    seen.add(cur);
    cur = lookupVar(frame, cur.name);
  }
  return cur;
}

/**
 * `isdefined(@x)` / `isruleset(@x)`: detached-ruleset introspection that inspects
 * the BINDING without byte-materializing it (a `DetachedRuleset` arg is not
 * value-serializable, and `isdefined` must swallow an unbound reference rather
 * than throw `@x is undefined`). Returns the `true`/`false` literal, or `undefined`
 * when `node` is not one of these calls (fall through to normal dispatch).
 */
function evalIntrospection(node: FunctionCall, frame: Frame | null): Value | undefined {
  if (node.args.length !== 1) return undefined;
  const arg = node.args[0]!;
  if (node.name === 'isdefined') {
    // Defined iff the single argument resolves to a bound value. A non-`VarRef`
    // argument (a literal / call) is inherently defined.
    const bound = arg.type === 'VarRef' ? resolveBindingNode(arg, frame) : arg;
    return literal(bound !== undefined ? 'true' : 'false');
  }
  if (node.name === 'isruleset') {
    const bound = resolveBindingNode(arg, frame);
    return literal(bound?.type === 'DetachedRuleset' ? 'true' : 'false');
  }
  return undefined;
}

/** True when every char of `s` is an ASCII digit (optionally a leading `-`). */
function isIntegerString(s: string): boolean {
  let i = s.charCodeAt(0) === 0x2d /* - */ ? 1 : 0;
  if (i >= s.length) return false;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return false;
  }
  return true;
}

/**
 * `calc(…)` fold: evaluate the single argument in calc mode, then decide the
 * wrapper. A cross-unit sub-expression arrives already `calc(…)`-wrapped (kept
 * as-is); a preserved non-calc keyword op (`100% - 3`) is wrapped; a fully
 * computed value (`10px * 2` → `20px`) drops the wrapper (less.js `calc()`
 * collapse to a bare Dimension).
 */
function evalCalc(node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const ce: EvalCtx = { ...e, calcDepth: (e.calcDepth ?? 0) + 1 };
  return mapMaybe(evalTyped(node.args[0]!, frame, ce), (v) => {
    if (v.type === 'Keyword') return calcInner(v.bytes) !== null ? v : makeKeyword(`calc(${v.bytes})`);
    return v;
  });
}

/** Evaluate a function call: materialize the modeled arg list, then `ev.call`. */
/** Guard-eval deps sourced from an evaluation context (a value-position condition,
 *  like a CSS ruleset guard, never depends on a mixin `default()` decision). */
function guardDeps(frame: Frame | null, e: EvalCtx): {
  resolveTyped: TypedResolver; ev: ValueEvaluator | null; modes: EvalModes; isDefault: () => boolean;
} {
  return { resolveTyped: makeTypedResolver(frame, e), ev: e.ev, modes: e.modes, isDefault: () => false };
}

/** The `GuardNode` an argument of a logical fn contributes: a structured
 *  `Condition` carries its own guard tree; any other value is a bare TRUTH test
 *  (`if((iscolor(@x)), …)`, `if(true, …)`) — the same rule a bare guard value uses. */
function condGuard(node: ValueNode): GuardNode {
  return node.type === 'Condition' ? node.guard : { g: 'truth', value: node };
}

/** The Less logical / conditional fns whose argument is a boolean CONDITION (a
 *  guard tree), not an ordinary value — dispatched here (not via `ev.call`) so the
 *  condition evaluates through the guard evaluator and `if` stays branch-lazy. */
const LOGICAL_FNS = new Set(['if', 'boolean', 'not', 'and', 'or']);

/** Evaluate a logical / conditional fn (`if`/`boolean`/`not`/`and`/`or`). `if` is
 *  LAZY — only the taken branch folds; an absent else is empty bytes. */
function evalLogical(name: string, node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const deps = guardDeps(frame, e);
  const truthOf = (a: ValueNode | undefined): boolean => a !== undefined && evalGuard(condGuard(a), deps);
  switch (name) {
    case 'if': {
      const branch = truthOf(node.args[0]) ? node.args[1] : node.args[2];
      return branch === undefined ? literal('') : evalValue(branch, frame, e);
    }
    case 'not': return makeBool(!truthOf(node.args[0]));
    case 'and': return makeBool(node.args.every((a) => evalGuard(condGuard(a), deps)));
    case 'or': return makeBool(node.args.some((a) => evalGuard(condGuard(a), deps)));
    default: return makeBool(truthOf(node.args[0])); // boolean
  }
}

function evalCall(node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const intro = evalIntrospection(node, frame);
  if (intro !== undefined) return intro;
  if (e.ev && node.args.length === 1 && node.name.toLowerCase() === 'calc') {
    return evalCalc(node, frame, e);
  }
  const sep = node.modern ? ' ' : ',';
  if (!e.ev) {
    const items = node.args.map((a) => evalValue(a, frame, e));
    return combineAll(items, (vals) => {
      const inner = vals.map(emitValue).join(sep === ' ' ? ' ' : ', ');
      return literal(`${node.name}(${inner})`);
    });
  }
  const lname = node.name.toLowerCase();
  if (LOGICAL_FNS.has(lname)) return evalLogical(lname, node, frame, e);
  const ev = e.ev;
  // Args are materialized TYPED (each arg's tag sourced from its parse node).
  const typed = node.args.map((a) => evalTyped(a, frame, e));
  return combineAll(typed, (vals) => {
    const list: ValueList = { type: 'List', items: vals, sep, bytes: '' };
    return ev.call(node.name, list, e.modes);
  });
}

/** Join value parts to bytes (Concat = '', SpacedValue = ' '); stays a literal. */
function joinBytes(
  parts: ValueNode[],
  sep: string,
  frame: Frame | null,
  e: EvalCtx,
): MaybePromise<Value> {
  const items = parts.map((p) => evalValue(p, frame, e));
  return combineAll(items, (vals) => literal(vals.map(emitValue).join(sep)));
}

/** Fold a value node and return its emitted bytes. */
function evalBytes(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  return mapMaybe(evalValue(node, frame, e), emitValue);
}

/** Bytes for a synchronous position (at-rule prelude); async there is out of scope. */
function evalBytesSync(node: ValueNode, frame: Frame | null, e: EvalCtx): string {
  const b = evalBytes(node, frame, e);
  if (isThenable(b)) throw new Error('async value in an at-rule prelude is unsupported');
  return b;
}

/* ---------------------------------------------------- selector composition */

/**
 * [nesting] Cartesian-expand every `&` in `canon` independently over the FULL
 * `parents` array — plain parent×child nesting expands, it does NOT compact to
 * `:is(a, b, …)`. Each `&` is its own odometer digit with the LEFTMOST `&`
 * most-significant, so `& > &` over parents `[p0,p1]` emits
 * `p0>p0, p0>p1, p1>p0, p1>p1` (see the 16-row `& > &` golden in selectors.less).
 */
function joinAmpersand(canon: string, parents: string[]): string[] {
  const segs = canon.split('&');
  const holes = segs.length - 1; // number of `&` occurrences (>= 1 here)
  const n = parents.length;
  if (n === 1) return [segs.join(parents[0]!)];
  const total = n ** holes;
  const out: string[] = new Array(total);
  for (let i = 0; i < total; i++) {
    let s = segs[0]!;
    for (let h = 0; h < holes; h++) {
      const digit = Math.floor(i / n ** (holes - 1 - h)) % n;
      s += parents[digit]! + segs[h + 1]!;
    }
    out[i] = s;
  }
  return out;
}

/** Resolve one interpolated simple token's text in `frame`. */
function resolveSimpleText(sim: Simple, frame: Frame | null, e: EvalCtx): string {
  if (sim.interp !== null) return evalBytesSync(sim.interp, frame, e);
  return sim.text ?? '';
}

function resolveCompound(c: Compound, frame: Frame | null, e: EvalCtx): string {
  if (!compoundHasInterp(c)) return compoundCanonical(c);
  let s = '';
  for (const sim of c.simples) s += resolveSimpleText(sim, frame, e);
  return s;
}

/** The concrete canonical string of a (possibly interpolated) complex, in
 * the entering frame. Static selectors keep the cached `canonical()` fast path. */
function resolveComplex(c: Complex, frame: Frame | null, e: EvalCtx): string {
  if (!complexHasInterp(c)) return complexCanonical(c);
  let s = resolveCompound(c.head, frame, e);
  if (c.leadingComb !== undefined && c.leadingComb !== ' ') {
    s = renderCombinator(c.leadingComb).trimStart() + s;
  }
  for (const seg of c.tail) {
    s += renderCombinator(seg.comb) + resolveCompound(seg.compound, frame, e);
  }
  return s;
}

/** Compose ONE child complex over ALL `parents`, cartesian-expanded (child-major,
 * parent-minor). `&`-bearing children expand each `&` over every parent; `&`-less
 * children take an implicit descendant prefix, one branch per parent. */
function composeOne(parents: string[], child: Complex, frame: Frame | null, e: EvalCtx): string[] {
  const canon = resolveComplex(child, frame, e);
  if (complexHasAmpersand(child)) return joinAmpersand(canon, parents);
  return parents.map((p) => p + ' ' + canon);
}

function compose(parents: string[], child: SelectorList, frame: Frame | null, e: EvalCtx): string[] {
  const out: string[] = [];
  for (const c of child.selectors) {
    for (const s of composeOne(parents, c, frame, e)) out.push(s);
  }
  return out;
}

/**
 * [nesting] The EMITTED-header branches for `child` under `parents`. Identical to
 * `compose` EXCEPT an `&`-less child under MULTIPLE parents compacts to a single
 * `:is(p0, p1, …) child` prefix (alpha v5 header form), instead of one cartesian
 * branch per parent. `compose` (the parent-list carried into further `&` nesting)
 * stays fully cartesian — the two forms diverge only for `&`-less multi-parent.
 * Only called with `parents.length >= 2` (callers use `compose` for the rest).
 */
function composeHeader(parents: string[], child: SelectorList, frame: Frame | null, e: EvalCtx): string[] {
  const out: string[] = [];
  const isPrefix = `:is(${parents.join(', ')}) `;
  for (const c of child.selectors) {
    const canon = resolveComplex(c, frame, e);
    if (complexHasAmpersand(c)) {
      for (const s of joinAmpersand(canon, parents)) out.push(s);
    } else {
      out.push(isPrefix + canon);
    }
  }
  return out;
}

/** True if ANY branch of the list references `&` (routes the rule to the cartesian
 * `&`-substitution header instead of the compact `&`-less join). */
function selectorListHasAmpersand(list: SelectorList): boolean {
  for (const c of list.selectors) if (complexHasAmpersand(c)) return true;
  return false;
}

/** [nesting] Compact a branch list into ONE opaque selector unit: a single branch
 * stays bare, a multi-branch comma list wraps in `:is(a, b, …)`. This is the
 * accumulated-ancestor form carried into deeper `&`-less nesting. */
function wrapIsList(branches: string[]): string {
  return branches.length === 1 ? branches[0]! : `:is(${branches.join(', ')})`;
}

/** [nesting] Join opaque ancestor `A` with an all-`&`-less child list, prefix
 * factored: `A` is emitted ONCE and the multi-branch child list wraps in a single
 * `:is(...)` (never cartesian-distributed, never repeated inside the `:is()`).
 * `#…#deux` + `#fourth,#five,#six` → `#…#deux :is(#fourth, #five, #six)`; a single
 * child joins plainly (`A child`, honouring its leading combinator). */
function opaqueJoin(a: string, child: SelectorList, frame: Frame | null, e: EvalCtx): string {
  const canons = child.selectors.map((c) => resolveComplex(c, frame, e));
  if (canons.length === 1) return a + ' ' + canons[0]!;
  return a + ' :is(' + canons.join(', ') + ')';
}

function ownStrings(list: SelectorList, frame: Frame | null, e: EvalCtx): string[] {
  const out: string[] = [];
  for (const c of list.selectors) out.push(resolveComplex(c, frame, e));
  return out;
}

/** [atrule-bubbling] Flat-mode own selectors at a ROOT context (no parent): like
 * `ownStrings`, but a `&` with no enclosing parent resolves to EMPTY (Less drops
 * a parentless ampersand), so `.outOfMedia &` at the top of a bubbled at-rule
 * becomes `.outOfMedia`. Non-ampersand selectors keep the fast canonical path. */
function rootStrings(list: SelectorList, frame: Frame | null, e: EvalCtx): string[] {
  const out: string[] = [];
  for (const c of list.selectors) {
    if (complexHasAmpersand(c)) out.push(resolveComplex(c, frame, e).split('&').join('').trim());
    else out.push(resolveComplex(c, frame, e));
  }
  return out;
}

/* ------------------------------------------------------------- emit engine */

interface Emit extends EvalCtx {
  chunks: string[];
  off: number;
  positions: Position[] | null;
  // typed value evaluator + configured modes (from EvalCtx: `ev`, `modes`).
  // async patches: a leaf whose value forced an async built-in reserves a
  // placeholder chunk index; the promise resolves the bytes after the sync walk.
  pending: Array<{ i: number; p: Promise<string> }>;
  // [atrule] current block-nesting depth (0 = top level). At-rule bodies raise it
  // so declarations/selectors inside a block indent one level deeper.
  depth: number;
  // [nested/R0] false => preserve authored nesting (Less v5 default); true =>
  // flatten to composed selector strings (4.x / collapseNesting:true).
  collapse: boolean;
  // [extend] per-rule extend overrides, or null when the document has no
  // `:extend()` (zero-cost gate: emit is byte-identical to the no-extend path).
  extends: ExtendResults | null;
  // [extend] set while emitting a hoisted (flattened) nested subtree via the flat
  // path, so headers use the compacted nested-hoist form. Never set in flat mode.
  hoistMode: boolean;
  // [adjacent-merge] the most recently CLOSED rule block, or null. v5 merges
  // consecutive same-selector SIBLING rulesets nested under a common parent into
  // one block (e.g. `P { &-2 {a} &-2 {b} }` → `P-2 { a; b }`). The next block
  // merges into this one when ALL hold: (1) same `parentKey` — the identical parent-
  // expansion the two rulesets are children of (a fresh composed-selector array per
  // parent expansion; `null` for top-level source rules, which NEVER merge even when
  // adjacent+identical — cf. repeated top-level `.whitespace`); (2) byte-identical
  // `header` at the same `depth`; (3) nothing emitted since it closed (`endChunks`
  // still the chunk-stream tail — a strict-adjacency guard). On a match the prior
  // block's `}` is rewound and this body appended inside it (source order, no cross-
  // block dedup). ONE preallocated record, mutated per block flush (no per-block
  // allocation); its seed `parentKey: null` matches nothing (merge needs pk !== null).
  lastBlock: { parentKey: object | null; header: string; depth: number; endChunks: number };
  // [recursion-backstop] current NESTED mixin-expansion depth (0 at the top of a
  // document walk). `expandCall` bumps it around each expansion and raises a clean
  // `RangeError` once it reaches `MAX_MIXIN_DEPTH` — catching a bad-guard runaway
  // before a native stack overflow. Threaded through `scratchEmit`.
  mixinDepth: number;
}

/**
 * A throwaway {@link Emit} over an {@link EvalCtx}, for a capture-only expansion (a
 * `@p: .mk-map()` binding read as an accessor base — {@link declMapFromMixinCall}).
 * Its chunk/patch state is discarded; it shares the eval seam (`ev`/`modes`) and
 * the `excluded` cycle-guard set with the live context. */
function scratchEmit(e: EvalCtx): Emit {
  return {
    ev: e.ev,
    modes: e.modes,
    excluded: e.excluded,
    propNames: e.propNames,
    optional: e.optional,
    calcDepth: e.calcDepth,
    chunks: [],
    off: 0,
    positions: null,
    pending: [],
    depth: 0,
    collapse: true,
    extends: null,
    hoistMode: false,
    lastBlock: { parentKey: null, header: '', depth: -1, endChunks: -1 }, // [adjacent-merge]
    mixinDepth: 0, // [recursion-backstop] fresh scratch walk; own runaway backstop
  };
}

/**
 * [whitespace] Re-indent a multi-line value's continuation lines. A value whose
 * source spans several lines keeps its interior newlines, but Less never lets a
 * continuation line sit LEFT of the property's continuation column: each line
 * after the first whose leading whitespace is shallower than `contIndent` is
 * clamped up to it, while a deeper source indent is preserved verbatim. No-op
 * (single scan, no split) for the single-line values that dominate.
 */
function reindentContinuations(bytes: string, contIndent: string): string {
  if (bytes.indexOf('\n') === -1) return bytes;
  const lines = bytes.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    let ws = 0;
    while (ws < line.length && (line[ws] === ' ' || line[ws] === '\t')) ws++;
    if (ws < contIndent.length) lines[i] = contIndent + line.slice(ws);
  }
  return lines.join('\n');
}

/** Normalize a declaration's `!important` on resolved value bytes: a trailing
 * `!important` (any case, `!` and `important` optionally spaced) is respaced to a
 * single leading space (`100%!important` → `100% !important`) and kept verbatim
 * (never doubled — `20px ! important` stays as-is); an absent one is appended.
 * Only applied when the declaration carries `!important`. */
function normalizeImportant(bytes: string): string {
  const m = /(\s*)(!\s*important)\s*$/iu.exec(bytes);
  return m ? bytes.slice(0, m.index) + ' ' + m[2] : bytes + ' !important';
}

/** Emit a value at a leaf/prelude site: sync `put`, or reserve an async slot.
 * `contIndent`, when given, re-indents multi-line value continuation lines.
 * `emitImportant` normalizes/appends the declaration's `!important` onto the
 * resolved bytes (see {@link normalizeImportant}). Returns the emitted sync bytes,
 * or `null` when the value deferred to an async slot. */
function putValue(e: Emit, node: ValueNode, frame: Frame | null, positionNode?: Node, contIndent?: string, emitImportant?: boolean, firstOnNewLine?: boolean): string | null {
  const b = evalBytes(node, frame, e);
  const finish = (s: string): string => {
    // [whitespace] `firstOnNewLine` folds the value's first line into a leading
    // (indented) continuation, so a value authored on its own line after `:`
    // re-emits with that layout (multi-line `grid-template-areas`).
    const lead = firstOnNewLine ? `\n${s}` : s;
    const r = contIndent !== undefined ? reindentContinuations(lead, contIndent) : lead;
    return emitImportant ? normalizeImportant(r) : r;
  };
  if (isThenable(b)) {
    const i = e.chunks.length;
    e.chunks.push('');
    e.pending.push({ i, p: Promise.resolve(mapMaybe(b, finish)) });
    return null;
  }
  const bytes = finish(b);
  const valStart = e.off;
  put(e, bytes);
  if (e.positions && positionNode) {
    e.positions.push({ node: positionNode, type: positionNode.type, start: valStart, end: e.off });
  }
  return bytes;
}

/* ------------------------------------------------------------- [extend] */

function put(e: Emit, s: string): void {
  e.chunks.push(s);
  if (e.positions) e.off += s.length;
}

/** A grouped leaf (declaration/comment) plus the frame its values resolve in.
 * `important` is a call-level `!important` override propagated from a
 * `.m() !important` placement onto every declaration the body emits. */
interface Leaf {
  node: Statement;
  frame: Frame | null;
  important?: boolean;
  // [dedup] the leaf was emitted from RESTRICTED mixin output (a real parametric
  // `MixinDef` expansion, or anything nested under one). Such duplicates are kept
  // verbatim — only unrestricted (authored / ruleset-mixin) duplicates collapse.
  protectedDup?: boolean;
}

/** The resolved property name of a declaration (interp names resolve sync). */
function declName(node: Declaration, frame: Frame | null, e: EvalCtx): string {
  return typeof node.name === 'string' ? node.name : evalBytesSync(node.name, frame, e);
}

export function serialize(root: Root, options?: SerializeOptions): SerializeReturn {
  const e: Emit = {
    chunks: [],
    off: 0,
    positions: options?.trackPositions ? [] : null,
    ev: options?.evaluator ?? null, // typed value evaluator
    modes: options?.modes ?? DEFAULT_MODES,
    excluded: new Set(), // [resolver] per-declaration cycle guard
    propNames: new Set(), // [property-interp] interpolated-name re-entrancy guard
    optional: options?.optional ?? false, // [resolver] strict (default) vs optional miss
    pending: [], // async patches
    depth: 0, // [atrule]
    collapse: options?.collapseNesting !== false, // [nested/R0] default = flatten
    extends: computeExtends(root), // [extend] null when no `:extend()` anywhere
    hoistMode: false, // [extend]
    lastBlock: { parentKey: null, header: '', depth: -1, endChunks: -1 }, // [adjacent-merge]
    mixinDepth: 0, // [recursion-backstop] runaway mixin-expansion depth guard
  };
  const rootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.children),
    vars: collectVars(root.children),
    statements: root.children,
  };
  const start = e.off;
  // [charset] Hoist the first document-level `@charset` ahead of all body
  // content; inline occurrences are dropped during the walk (dedupe).
  emitHoistedCharset(root.children, rootFrame, e);
  // [import:hoist] Plain-CSS `@import`s are not inlined; Less hoists them to the
  // document top (after `@charset`) in source-encounter order and emits them as
  // literal `@import …;`. The resolution pass marked each with `hoist`; emit them
  // here and skip them at their in-place position below.
  emitHoistedImports(root.children, e);
  if (!e.collapse) {
    // [nested/R0] Less v5 default: preserve authored block structure. The root's
    // children are the top-level content level (indent 0).
    emitNestedBody(root.children, rootFrame, e);
  } else
  for (const child of root.children) {
    switch (child.type) {
      case 'Rule':
        flatten(child, null, null, rootFrame, e);
        break;
      case 'MixinDef':
      case 'VarDeclaration':
        break; // definitions emit nothing
      case 'MixinCall': {
        const group: Leaf[] = [];
        const flush = (): void => {
          if (group.length) flushBlock([], group, e);
          group.length = 0;
        };
        expandCall(child, null, null, rootFrame, group, flush, null, e);
        flush();
        break;
      }
      case 'DetachedCall': {
        // a top-level detached-ruleset call (e.g. unlocking mixins).
        const group: Leaf[] = [];
        const flush = (): void => {
          if (group.length) flushBlock([], group, e);
          group.length = 0;
        };
        expandDetachedCall(child, null, null, rootFrame, group, flush, null, e);
        flush();
        break;
      }
      case 'For': {
        // a top-level `each(...)` loop — its body emits at the document level.
        const group: Leaf[] = [];
        const flush = (): void => {
          if (group.length) flushBlock([], group, e);
          group.length = 0;
        };
        expandFor(child, null, null, rootFrame, group, flush, null, e);
        flush();
        break;
      }
      case 'Declaration':
      case 'Comment':
        emitLeaf({ node: child, frame: rootFrame }, e, true);
        break;
      // [atrule] top-level at-rules
      case 'AtRuleBlock':
        emitAtRuleBlock(child, rootFrame, e);
        break;
      case 'AtRuleStatement':
        emitAtRuleStatement(child, rootFrame, e);
        break;
      // [import:inline] raw verbatim bytes spliced by `@import (inline)`.
      case 'RawInline':
        emitRawInline(child, e);
        break;
      // [import] an unresolved import the resolution pass left in place. A
      // css-passthrough import (`hoist`) was already emitted at the document top.
      case 'StyleImport':
        if (!child.hoist) emitStyleImport(child, e);
        break;
    }
  }
  if (e.positions) e.positions.push({ node: root, type: root.type, start, end: e.off });
  const finalize = (): SerializeResult =>
    e.positions ? { css: e.chunks.join(''), positions: e.positions } : { css: e.chunks.join('') };
  // lift to async ONLY if a genuinely-async built-in reserved a placeholder.
  if (e.pending.length > 0) {
    return Promise.all(
      e.pending.map((x) => x.p.then((b) => { e.chunks[x.i] = b; })),
    ).then(finalize);
  }
  return finalize();
}

/**
 * [guards] Whether a rule's `when (...)` guard passes in the scope where the rule
 * is defined (`frame`). An unguarded rule always emits; a CSS ruleset guard never
 * uses `default()` (that is a mixin-dispatch decision), so `isDefault` is `false`.
 */
function ruleGuardPasses(rule: Rule, frame: Frame, e: Emit): boolean {
  if (!rule.guard) return true;
  return evalGuard(rule.guard, {
    resolveTyped: makeTypedResolver(frame, e),
    ev: e.ev,
    modes: e.modes,
    isDefault: () => false,
  });
}

/**
 * [guards/&-merge] Whether `rule`'s selector composes to EXACTLY the enclosing
 * block's composed selector (`parent`) — a bare `&` that reproduces the parent
 * (`& { … }` / `& when (…) { … }`). Such a rule is a same-block continuation, not
 * a new rule. A rule carrying `:extend()` is never treated this way (it needs its
 * own header for the extend override). Position tracking is off (a projection).
 */
function isSelfComposed(rule: Rule, parent: string[], frame: Frame, e: Emit): boolean {
  if (rule.extendInstructions !== undefined) return false;
  const composed = compose(parent, rule.selector, frame, e);
  if (composed.length !== parent.length) return false;
  for (let i = 0; i < composed.length; i++) if (composed[i] !== parent[i]) return false;
  return true;
}

/**
 * [import:reference] Filter a rule's composed header down to its VISIBLE branches.
 * Returns `null` when the rule emits nothing (every branch hidden) — the caller then
 * skips the block entirely. A rule with no hidden branch (the overwhelming common
 * case: any document with no `(reference)` import) returns `header` unchanged, so the
 * serializer stays byte-identical.
 *
 *  - extend folded a per-branch mask (`hiddenByRule`, aligned 1:1 with the FLAT
 *    header): keep the branches whose mask bit is false. This also handles a VISIBLE
 *    rule that received a hidden extender branch (drop just that branch).
 *  - no mask, but the rule itself is `reference` and extend never changed it: all its
 *    (seed-only) branches are hidden → drop the whole rule.
 */
function visibleHeader(rule: Rule, header: string[], e: Emit): string[] | null {
  const ext = e.extends;
  const mask = ext?.hiddenByRule.get(rule);
  if (mask && mask.length === header.length) {
    const vis = header.filter((_, i) => mask[i] !== true);
    return vis.length > 0 ? vis : null;
  }
  if (rule.reference === true && ext?.flatByRule.has(rule) !== true) return null;
  return header;
}

function flatten(rule: Rule, parent: string[] | null, ancestor: string | null, frame: Frame, e: Emit, imp = false): void {
  // [guards] a guarded ruleset emits its block only when the guard is true.
  if (!ruleGuardPasses(rule, frame, e)) return;
  const rawComposed =
    parent === null ? rootStrings(rule.selector, frame, e) : compose(parent, rule.selector, frame, e);
  // [nesting] `rawComposed` is the fully-cartesian parent-list carried into nested
  // `&` composition (each `&` substitutes over every parent branch). The EMITTED
  // header + the OPAQUE ancestor carried into `&`-less children diverge from it:
  //   - top level (no parent): header is the own selector list.
  //   - a rule with ANY `&` branch keeps the cartesian `&`-substitution header
  //     (the `selectors`-fixture cartesian form) — unchanged.
  //   - an all-`&`-less nested rule COMPACT-joins: the accumulated ancestor `A` is
  //     emitted ONCE and its multi-branch child list wraps in a single `:is(...)`
  //     (`#…#deux :is(#fourth, #five, #six)`), never cartesian-distributed.
  // `childAncestor` is the single opaque unit deeper `&`-less levels concatenate
  // onto (a multi-branch header collapses to `:is(...)`).
  let headerComposed: string[];
  let childAncestor: string;
  if (parent === null) {
    headerComposed = rawComposed;
    childAncestor = wrapIsList(rawComposed);
  } else if (selectorListHasAmpersand(rule.selector)) {
    headerComposed = parent.length < 2 ? rawComposed : composeHeader(parent, rule.selector, frame, e);
    childAncestor = wrapIsList(headerComposed);
  } else {
    const joined = opaqueJoin(ancestor ?? wrapIsList(parent), rule.selector, frame, e);
    headerComposed = [joined];
    childAncestor = joined;
  }
  // [extend] the rule's HEADER uses its fully-extended composed branches;
  // children still compose against the RAW composed selector and extend
  // independently (the composed model needs no parent-child override). Absent an
  // extend override the header is byte-identical to the no-extend serializer.
  const header0 = e.hoistMode
    ? e.extends?.hoistHeader.get(rule) ?? e.extends?.flatByRule.get(rule) ?? headerComposed
    : e.extends?.flatByRule.get(rule) ?? headerComposed;
  // [import:reference] drop the header branches that originate ONLY from hidden
  // `(reference)` rules; a rule left with no visible branch emits nothing (its body
  // still emits when the rule is pulled in as a mixin — a separate expansion path).
  const header = visibleHeader(rule, header0, e);
  if (header === null) return;
  const childFrame: Frame = {
    parent: frame,
    mixins: collectMixins(rule.body),
    vars: collectVars(rule.body),
    statements: rule.body,
  };
  const group: Leaf[] = [];
  const flush = (): void => {
    if (group.length) {
      // [adjacent-merge] `parent` (the parent expansion this rule was composed
      // against) keys sibling merges: two nested rulesets with the same parent ref
      // and header merge; top-level rules (`parent === null`) never do.
      flushBlock(header, group, e, rule.selector, parent);
      group.length = 0;
    }
  };
  // [partition] Reproduce the alpha v5 flattened order (legacy
  // `flattenVisibleRulesForRender`): a ruleset's LEADING declarations — those
  // before the FIRST nested rule, plus any hoisted from a parametric-mixin body
  // (`forceLeading`) — form the block emitted at the header; nested rules and any
  // declarations that FOLLOW them emit AFTER, in source order, each trailing run of
  // declarations opening a FRESH same-selector block. `emitBlock` reuses the header
  // + adjacent-merge key for those trailing blocks.
  const emitBlock = (leaves: Leaf[]): void => {
    if (leaves.length) flushBlock(header, leaves, e, rule.selector, parent);
  };
  const partition: Partition = { encounteredContainer: false, trailing: [], pending: [], emitBlock };
  walkBody(rule.body, rawComposed, childAncestor, childFrame, group, flush, partition, e, imp, false, false, true);
  flush();
  flushPending(partition);
  for (const emit of partition.trailing) emit();
}

/** [partition] Move any buffered trailing-leaf run into `trailing` as one block. */
function flushPending(p: Partition): void {
  if (p.pending.length) {
    const batch = p.pending;
    p.pending = [];
    p.trailing.push(() => p.emitBlock(batch));
  }
}

/** [partition] Buffer a leaf into the leading `group` or the trailing `pending`
 * run, per the same leading/trailing rule declarations follow. */
function addLeaf(group: Leaf[], partition: Partition | null, leaf: Leaf, forceLeading: boolean): void {
  if (partition && partition.encounteredContainer && !forceLeading) partition.pending.push(leaf);
  else group.push(leaf);
}

/**
 * [partition] The alpha v5 leading/trailing split (legacy
 * `flattenVisibleRulesForRender`). A ruleset's LEADING declarations — those before
 * the first nested rule, plus declarations hoisted out of a parametric-mixin body
 * (`forceLeading`) — go straight to the header `group`. Once a nested rule
 * (`encounteredContainer`) is seen, later declarations buffer in `pending` and,
 * interleaved with the nested rules in source order, are drained from `trailing`
 * after the leading block flushes — each `pending` run becoming its own trailing
 * same-selector block via `emitBlock`. Passing `null` (top level, at-rule bodies)
 * keeps every rule inline in source order (no split).
 */
interface Partition {
  encounteredContainer: boolean;
  /** Ordered emitters after the first nested rule: rule flattens + trailing-leaf blocks. */
  trailing: Array<() => void>;
  /** Buffered trailing declarations awaiting the next boundary (a run → one block). */
  pending: Leaf[];
  /** Emit a run of leaves as ONE block reusing this ruleset's header + merge key. */
  emitBlock: (leaves: Leaf[]) => void;
}

/**
 * Walk a body, expanding mixin calls inline against the shared canonical body.
 * `forceLeading` HOISTS this body's declarations into the leading block even past a
 * nested rule — set when expanding a PARAMETRIC mixin (its body is a bare-`&`
 * transparent wrapper in less@4, whose leaves force-lead; a plain ruleset-mixin
 * does NOT hoist, so its declarations split at container boundaries like authored
 * ones).
 */
function walkBody(
  statements: Statement[],
  composed: string[] | null,
  ancestor: string | null, // [nesting] opaque accumulated ancestor for `&`-less child joins
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  partition: Partition | null,
  e: Emit,
  imp = false, // call-level !important override
  protectedDup = false, // [dedup] emitting inside restricted mixin output
  forceLeading = false, // [partition] hoist this body's decls into the leading block
  ownBody = false, // [coalesce] this is the ruleset's OWN directly-authored body
): void {
  for (const node of statements) {
    switch (node.type) {
      case 'Declaration':
        // [coalesce] A ruleset's OWN directly-authored declarations that follow a
        // nested child rule merge back INTO the ruleset's leading block instead of
        // opening a second same-selector block — BUT only when that leading block
        // exists (there were own decls before the first nested rule). So:
        //   - `#operations{ a; b; .spacing{} c; d }` (own decls both sides of the
        //     nested rule) → one `#operations{a;b;c;d}` then `#operations .spacing{}`.
        //   - `#first > .one{ >#second{…} font-size; … }` (own decls ONLY after the
        //     nested rule, no leading block) → the decls stay a TRAILING block at their
        //     source position (`rulesets`).
        // A declaration produced by a MIXIN expansion (`!ownBody`) is NOT coalesced
        // this way: it emits at its spliced position, so `.extended{ .a(); .amp() /*
        // nests*/; .b() /*decl*/ }` keeps `.b`'s decl as a trailing `.extended` block
        // after the nested output (`mixins`). Parametric-mixin bodies (`forceLeading`)
        // already hoist and are unaffected.
        if (
          partition && partition.encounteredContainer && !forceLeading
          && (group.length === 0 || !ownBody)
        ) {
          partition.pending.push({
            node,
            frame,
            ...(imp ? { important: true } : {}),
            ...(protectedDup ? { protectedDup: true } : {}),
          });
        } else {
          group.push({
            node,
            frame,
            ...(imp ? { important: true } : {}),
            ...(protectedDup ? { protectedDup: true } : {}),
          });
        }
        break;
      case 'Comment':
        // [partition] A comment keeps its authored position relative to nested
        // rules: before the first → leading block; after → its own trailing run.
        addLeaf(group, partition, {
          node,
          frame,
          ...(imp ? { important: true } : {}),
          ...(protectedDup ? { protectedDup: true } : {}),
        }, forceLeading);
        break;
      case 'Rule': {
        // a null `composed` (top-level mixin/detached call) keeps nested
        // rules at the top level (own-strings), not composed against `[]`.
        const rule = node;
        const rFrame = frame;
        const rComposed = composed;
        const rAncestor = ancestor;
        // [guards/&-merge] A nested rule whose selector composes to EXACTLY the
        // enclosing block's selector (a bare `&`, e.g. `& when (@c) { … }`) is not
        // a separate rule: its (guard-passing) body flows into THIS block, in place,
        // rather than opening a duplicate same-selector block. This yields the v5
        // single-block output (`.x { width; color; height }`) for `.x { width; &
        // when(c){color} & when(c){height} }`.
        if (composed !== null && isSelfComposed(rule, composed, frame, e)) {
          if (ruleGuardPasses(rule, frame, e)) {
            const selfFrame: Frame = {
              parent: frame,
              mixins: collectMixins(rule.body),
              vars: collectVars(rule.body),
              statements: rule.body,
            };
            walkBody(rule.body, composed, ancestor, selfFrame, group, flush, partition, e, imp, protectedDup, forceLeading, ownBody);
          }
          break;
        }
        // [partition] A nested rule is a BOUNDARY: with a partition it defers to
        // `trailing` (after the leading block + any prior trailing run), so later
        // declarations open a FRESH same-selector block (v5 order
        // `.x{a} .x .y{} .x{b}` for `.x{ a; .y{} b }`). Without a partition (top
        // level / at-rule body) it flushes and emits inline, in source order.
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => flatten(rule, rComposed, rAncestor, rFrame, e, imp));
        } else {
          flush();
          flatten(rule, rComposed, rAncestor, rFrame, e, imp);
        }
        break;
      }
      case 'MixinCall':
        expandCall(node, composed, ancestor, frame, group, flush, partition, e, imp, protectedDup, forceLeading);
        break;
      case 'DetachedCall':
        expandDetachedCall(node, composed, ancestor, frame, group, flush, partition, e, protectedDup, forceLeading);
        break;
      case 'For':
        expandFor(node, composed, ancestor, frame, group, flush, partition, e, imp, protectedDup, forceLeading);
        break;
      // [atrule-bubbling] an at-rule nested inside a ruleset body PROJECTS to this
      // block level (flat mode already emits everything at `e.depth`), carrying the
      // enclosing composed selector as its body context so a bubbleable at-rule
      // wraps the ruleset's selector inside. The decl group flushes first so the
      // at-rule sits after the ruleset's own block, matching Less's bubbling order.
      case 'AtRuleBlock': {
        // [atrule-nested] `@starting-style` / unknown at-rules stay INSIDE this
        // block (no bubble): buffer with the decl group so they emit in source
        // order within the parent ruleset. Everything else bubbles out — a bubbling
        // at-rule is a container, so (partitioned) it defers to `trailing` after the
        // leading block, matching the legacy flatten order.
        if (staysNested(node.name)) { addLeaf(group, partition, { node, frame }, forceLeading); break; }
        const atNode = node, atFrame = frame, atComposed = composed;
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => emitAtRuleBlock(atNode, atFrame, e, atComposed));
        } else {
          flush();
          emitAtRuleBlock(node, frame, e, composed);
        }
        break;
      }
      case 'AtRuleStatement': {
        if (staysNested(node.name)) { addLeaf(group, partition, { node, frame }, forceLeading); break; }
        const atNode = node;
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => emitAtRuleStatement(atNode, frame, e));
        } else {
          flush();
          emitAtRuleStatement(node, frame, e);
        }
        break;
      }
      // [import:inline] raw verbatim bytes spliced by `@import (inline)`.
      case 'RawInline': {
        const riNode = node;
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => emitRawInline(riNode, e));
        } else {
          flush();
          emitRawInline(node, e);
        }
        break;
      }
      case 'MixinDef':
      case 'VarDeclaration':
        break;
    }
  }
}

/**
 * Merge mixin/function PARAM bindings and body-local var stacks into one frame
 * map. Params seed each name's stack; body decls are appended AFTER so a
 * body-level `$a: …` sits later in the stack and shadows a same-named param on
 * the backward walk (Defect C — BODY WINS). No shared stack is mutated: a merged
 * name gets a fresh concatenated array. */
function mergeVars(
  params: Map<string, ValueNode> | null,
  body: Map<string, Binding[]> | null,
): Map<string, Binding[]> | null {
  if (!params) return body;
  const out = asStacks(params)!;
  if (body) {
    for (const [k, stack] of body) {
      const seed = out.get(k);
      if (seed) out.set(k, [...seed, ...stack]);
      else out.set(k, stack.slice());
    }
  }
  return out;
}

/**
 * [recursion-backstop] Maximum depth of NESTED mixin expansions. Parametric
 * self-recursion is meant to be terminated by its guard; a bad guard produces a
 * runaway that would blow the JS call stack. This high backstop turns that into a
 * clean, catchable `RangeError` far above any legitimate guarded recursion depth
 * (real Less recurses a handful to low-hundreds of levels) yet with comfortable
 * headroom below the native stack ceiling. Each expansion level costs many JS
 * frames (`expandCall` → `walkBody` → nested `expandCall`), so the measured native
 * ceiling is ~1000 levels and varies with the caller's starting stack depth; 500
 * leaves ~2× margin so the clean error ALWAYS fires before a native overflow,
 * regardless of context. It is a runaway BACKSTOP, not a recursion cap — see
 * `expandCall`.
 */
const MAX_MIXIN_DEPTH = 500;

/**
 * Expand a mixin call: [guards] resolve the overloaded definitions that match
 * (arity + literal pattern + named/default params + guards), then WALK each
 * matching shared def body in place under the current composed selector. No
 * clone, no per-placement node build.
 */
function expandCall(
  call: MixinCall,
  composed: string[] | null,
  ancestor: string | null,
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  partition: Partition | null, // [partition] nested-ruleset sink (see walkBody)
  e: Emit,
  imp = false,
  protectedDup = false, // [dedup] already inside restricted mixin output
  forceLeading = false, // [partition] inherited leading-hoist context
): void {
  // A namespaced/compound call (`#ns .a .b()`, `.jo.ki()`, `.amp.support()`)
  // resolves by ELEMENT-VALUE descent through the scope's own rulesets (Less
  // `Ruleset.find` / `Selector.mixinElements`): combinators and `&` are ignored,
  // a compound run can span a descendant-nested definition, and the name resolves
  // ONLY inside the matched namespace body — it does NOT fall through to same-name
  // defs in the enclosing/root scope. A bare `.m()` still walks the scope chain
  // accumulating same-name overloads.
  // Explicit `MixinDef`s AND paren-less/plain rulesets callable as zero-arg mixins
  // (Less: `.foo {}` is a mixin) are both candidates, in definition order.
  // [closure] track each candidate's DEFINITION frame: a mixin body resolves its
  // free variables in the scope where the mixin was WRITTEN, not the call site
  // (less@4 `MixinDefinition.frames`). The path finder records the descended
  // definition scope; a bare `.m()` may resolve a def in an ANCESTOR frame.
  const namespaced = call.path.length > 0;
  const homes = new Map<MixinDef, Frame>();
  const rawCandidates = namespaced
    ? findPathCandidates(frame, call, e, homes)
    : lookupCandidates(frame, call.name, e, homes);
  // [parent-exclusion] A paren-less ruleset callable as a zero-arg mixin
  // (`ruleMixin`) is EXCLUDED from its own candidate set while its body is on the
  // active expansion stack — the enclosing frame declines to be its own candidate.
  // `.recursion { .recursion(); }` re-binds to a same-name parametric def (or
  // no-ops) instead of re-entering its own body forever: a non-parametric re-entry
  // carries no new args and makes no progress. This is the mixin half of the file's
  // one exclusion principle (the variable half lives in `resolveVarStack` /
  // `e.excluded`); see `parentExcludes`. It mirrors less@4 mixin-call.js
  // `isRecursive` (a candidate that is NOT a parametric MixinDefinition and equals a
  // ruleset currently in `context.frames` is skipped). A ruleMixin's synthesized
  // `body` IS the source Rule's own body array, and the frame built to expand that
  // Rule carries the SAME array as `statements`, so identity on the array is the
  // rule identity. Parametric recursion DOES progress (new args) and is never
  // excluded here — guards terminate it, and the depth backstop below is the sole
  // error path for a non-terminating (bad-guard) runaway.
  const candidates = rawCandidates.some((d) => d.ruleMixin === true)
    ? rawCandidates.filter((d) => d.ruleMixin !== true || !parentExcludes(frame, d.body))
    : rawCandidates;
  if (candidates.length === 0) return; // unknown mixin: minimal scope emits nothing
  const selected = dispatch(candidates, call, frame, e, homes);
  const bodyImp = imp || call.important; // propagate call-level !important
  // [recursion-backstop] Parametric self-recursion (`.loop(@n - 1)`) is terminated
  // by its guard; a MALFORMED guard (`.loop(@n) { .loop(@n + 1) }`) never stops and
  // would otherwise blow the JS stack. Each nested expansion adds one level here; a
  // high backstop (`MAX_MIXIN_DEPTH`) raises a clean, catchable error well before a
  // native stack overflow. This is NOT the parent-exclusion skip above and NOT a low
  // cap — legit deep guarded recursion runs unaffected far below the limit.
  if (e.mixinDepth >= MAX_MIXIN_DEPTH) {
    throw new RangeError('maximum mixin recursion depth exceeded');
  }
  e.mixinDepth++;
  try {
    for (const { def, bindings } of selected) {
      captureArgDefFrames(bindings, frame); // detached-ruleset args: literal home
      // [closure] free variables resolve in the mixin's DEFINITION scope FIRST, with
      // the call-site scope as a fallback — less@4 evaluates a mixin body under
      // `definitionFrames.concat(callerFrames)`. `parent` = the definition frame (so
      // a `@var` written in the mixin's home scope wins over a same-name caller var,
      // e.g. `mixins-closure`); `fallback` = the caller chain, which also keeps the
      // DYNAMIC expansion stack reachable for the ruleset-mixin parent-exclusion
      // check (`parentExcludes`) and lets the body see caller-published mixins. A
      // namespaced call already descends to the definition scope (home is confined
      // to the namespace), so it takes no caller fallback.
      const homeFrame = homes.get(def) ?? frame;
      const callFrame: Frame = {
        parent: homeFrame,
        mixins: collectMixins(def.body),
        vars: mergeVars(bindings, collectVars(def.body)),
        statements: def.body,
        ...(namespaced || homeFrame === frame ? {} : { fallback: frame }),
      };
      // [dedup] a real parametric MixinDef produces RESTRICTED output (its overloaded
      // duplicates survive); a synthesized ruleset-mixin does not, unless it is already
      // nested inside restricted output (chain-sticky, matching isFromRestrictedMixinOutput).
      const bodyProtected = protectedDup || def.ruleMixin !== true;
      // [partition] A PARAMETRIC mixin body is a bare-`&` transparent wrapper in
      // less@4, so its declarations force-lead into the caller's leading block even
      // past nested rules (`mixins-important`). A ruleset-mixin body is a plain
      // splice — it inherits the caller's context so its declarations split at
      // container boundaries like authored ones (`mixins`).
      const bodyForceLeading = forceLeading || def.ruleMixin !== true;
      // [adjacent-merge] each mixin expansion is a DISTINCT parent expansion: give
      // its body a FRESH composed-array identity (same values → byte-identical
      // composition) so nested rulesets from two separate calls of the same body do
      // NOT reopen-merge (`.class .inner {} .class .inner {}` stay two blocks —
      // `mixins-important`), while two nested siblings within ONE expansion still
      // share it and merge.
      const bodyComposed = composed === null ? null : composed.slice();
      walkBody(def.body, bodyComposed, ancestor, callFrame, group, flush, partition, e, bodyImp, bodyProtected, bodyForceLeading);
      // [scope-leak] after expansion the mixin's own `@x:` declarations unlock into
      // the caller scope (visible to later siblings), matching less@4.
      leakBodyVars(frame, def.body, callFrame, e);
      // [ruleset-unlock] a ruleset (or nested mixin def) declared inside the called
      // body ALSO unlocks into the caller scope, so a later sibling can call it as a
      // mixin (less@4 splices the body's evaluated rules as siblings of the call, and
      // `Ruleset.find` then resolves against them). `.importRuleset()` defining
      // `.imported` makes `.imported()` callable afterward (`scope` fixture). Reuse
      // the callee frame's already-synthesized def+ruleMixin map (explicit MixinDefs
      // and paren-less rulesets, interleaved) rather than re-scanning the body.
      publishMixins(frame, frameOrderedMixins(callFrame, e));
    }
  } finally {
    e.mixinDepth--;
  }
}

/**
 * Descend a namespace path (`#ns > .a`) to the scope frame in which the
 * final mixin dispatches. Each segment resolves a ruleset by own-local selector
 * and layers its body as a new scope. Returns `null` if any segment is unknown.
 */
function descendNamespacePath(path: MixinCall['path'], frame: Frame): Frame | null {
  let scope: Frame | null = frame;
  for (const seg of path) {
    let rules: Rule[] | undefined;
    for (let f: Frame | null = scope; f; f = f.parent) {
      const hit = f.rulesets !== undefined || f.statements ? frameRulesets(f)?.get(seg.sel) : undefined;
      if (hit && hit.length) {
        rules = hit;
        break;
      }
    }
    if (!rules) return null;
    const bodies = rules.flatMap((r) => r.body);
    scope = {
      parent: scope,
      mixins: collectMixins(bodies),
      vars: collectVars(bodies),
      statements: bodies,
    };
  }
  return scope;
}

/** Detached-ruleset args capture their literal home frame (the caller). */
function captureArgDefFrames(bindings: Map<string, ValueNode> | null, callerFrame: Frame): void {
  if (!bindings) return;
  for (const v of bindings.values()) {
    if (v.type === 'DetachedRuleset' && v.defFrame === null) v.defFrame = callerFrame;
  }
}

/**
 * [scope-leak] Less mixin-call variable unlocking: a `@x:` declared in a called
 * mixin body becomes visible in the CALLER scope (less@4 evaluates the body and
 * splices its evaluated declarations as siblings of the call, so
 * `.heightIsSet { height: @height }` after `.setHeight(...)` sees the `@height`
 * the mixin defined). The value is snapshotted in the CALLEE frame (params bound)
 * and pushed onto the caller frame's LEAKED per-name stack — a scope of LOWER
 * priority than the ordinary lexical `vars` chain. v5 "outer-binding-wins": the
 * unlocked value only wins where no enclosing scope already binds the name; a name
 * an outer scope already declares keeps that lexical binding (v5 drops the 4.x
 * hoist that let `@mix: #989` shadow the root `@mix: blue` — see `resolveVarRef`).
 * A detached ruleset / typed literal binds by reference (closure / value type must
 * survive); everything else byte-flattens exactly as a crossed mixin arg does. An
 * async leak (a color/IO fn in the value) is exotic in a leaked position and is
 * left un-snapshotted rather than forcing the walk async.
 */
function leakBodyVars(callerFrame: Frame, body: Statement[], callFrame: Frame, e: EvalCtx): void {
  for (const s of body) {
    if (s.type !== 'VarDeclaration') continue;
    const v = s.value;
    // A mixin-CALL-bound var (`@p: .m()`) is not byte-snapshottable; leave it to
    // resolve lazily at its call site rather than snapshotting a leaked copy.
    if (v.type === 'MixinCall') continue;
    let snap: ValueNode;
    if (v.type === 'DetachedRuleset' || isTypedLiteral(v)) {
      snap = v;
    } else {
      const b = evalBytes(v, callFrame, e);
      if (isThenable(b)) continue;
      snap = any(b);
    }
    const map = (callerFrame.leaked ??= new Map());
    const stack = map.get(s.name);
    if (stack) stack.push(snap);
    else map.set(s.name, [snap]);
  }
}

/** Merge extra mixin defs into a frame's map in place (scope unlocking). */
function publishMixins(frame: Frame, extra: Map<string, MixinDef[]> | null): void {
  if (!extra) return;
  if (!frame.mixins) {
    frame.mixins = new Map(extra);
    return;
  }
  for (const [name, defs] of extra) {
    const list = frame.mixins.get(name);
    if (list) list.push(...defs);
    else frame.mixins.set(name, defs.slice());
  }
}

/** Build the overlay frame for a detached-ruleset call (definition scope has
 * priority; caller scope is the fallback). Publishes the ruleset's mixin defs
 * into the CALLER frame (Less scope unlocking). Returns null if the variable is
 * not bound to a detached ruleset. */
function detachedCallFrame(varName: string, frame: Frame): { dr: DetachedRuleset; callFrame: Frame } | null {
  const bound = lookupVar(frame, varName);
  if (!bound || bound.type !== 'DetachedRuleset') return null;
  const dr = bound;
  const def = (dr.defFrame as Frame | null) ?? frame;
  const own = collectMixins(dr.body);
  const callFrame: Frame = {
    parent: def, // definition scope has priority
    mixins: own,
    vars: collectVars(dr.body),
    fallback: frame, // caller scope is the fallback
    statements: dr.body,
  };
  publishMixins(frame, own); // unlocking: caller sees the ruleset's mixins
  return { dr, callFrame };
}

/** Expand a detached-ruleset call (`@ruleset();`) — splice its body through
 * the overlay frame, in the flattened walk. */
function expandDetachedCall(
  call: DetachedCall,
  composed: string[] | null,
  ancestor: string | null,
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  partition: Partition | null, // [partition] nested-ruleset sink (see walkBody)
  e: Emit,
  protectedDup = false, // [dedup] inherit restriction from the enclosing context
  forceLeading = false, // [partition] inherited leading-hoist context
): void {
  const r = detachedCallFrame(call.varName, frame);
  if (!r) return;
  walkBody(r.dr.body, composed, ancestor, r.callFrame, group, flush, partition, e, false, protectedDup, forceLeading);
}

/* --------------------------------------------------------------- [each/For] */

/** One iterable item: its value node plus the map KEY (`null` for a plain list,
 *  where the key defaults to the 1-based index). */
interface ForItem {
  value: ValueNode;
  key: ValueNode | null;
}

/**
 * Split `text` at the TOP level on `,` (comma list) else a whitespace run (space
 * list), skipping anything nested in `()[]{}` or inside a quoted string. Mirrors
 * Less's value model: a comma binds looser than a space, so a top-level comma
 * makes a comma list, otherwise the whitespace runs make a space list. Returns the
 * trimmed non-empty pieces (a single-element array when there is no separator).
 */
function splitListBytes(text: string): string[] {
  const comma = hasTopLevelComma(text);
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (end: number): void => {
    const piece = text.slice(start, end).trim();
    if (piece !== '') parts.push(piece);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== '') {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && (comma ? c === ',' : c === ' ' || c === '\t' || c === '\n' || c === '\r')) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  return parts;
}

/** Whether `text` has a top-level `,` (outside any `()[]{}` group / quoted string). */
function hasTopLevelComma(text: string): boolean {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== '') {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === ',') return true;
  }
  return false;
}

/**
 * If the iterable resolves to a MAP (a detached ruleset — inline, a var bound to
 * one, or a `@map[key]` accessor selecting one), return its declaration body + the
 * frame those declarations belong to; else `null` (a list iterable). A map iterates
 * its Declaration / VarDeclaration entries: key = the entry name, value = its value
 * node. Comments are skipped.
 */
function resolveForRuleset(
  node: ValueNode,
  frame: Frame | null,
  e: EvalCtx,
): { body: Statement[]; frame: Frame | null } | null {
  if (node.type === 'DetachedRuleset') {
    return { body: node.body, frame: (node.defFrame as Frame | null) ?? frame };
  }
  if (node.type === 'VarRef') {
    const bound = lookupVar(frame, node.name);
    if (!bound) return null;
    if (bound.type === 'DetachedRuleset') {
      return { body: bound.body, frame: (bound.defFrame as Frame | null) ?? frame };
    }
    // The binding is itself an indirection to a ruleset — a `@var` alias chain or
    // a `@map[k]` accessor (`@scheme: @color-schemes[@@name]; each(@scheme, …)` /
    // `@scheme[@color]`). Follow it through the same resolver.
    if (bound.type === 'VarRef' || bound.type === 'MapAccessor' || bound.type === 'Paren') {
      return resolveForRuleset(bound, frame, e);
    }
    return null;
  }
  if (node.type === 'MapAccessor') {
    const map = resolveBaseDeclMap(node.base, frame, e);
    if (!map) return null;
    const key = typeof node.key === 'number' ? undefined : evalBytesSync(node.key, frame, e);
    const matched = key !== undefined ? map.byName.get(key) : undefined;
    if (matched && matched.value.type === 'DetachedRuleset') {
      return { body: matched.value.body, frame: (matched.value.defFrame as Frame | null) ?? matched.frame };
    }
    // A var-valued map entry bound to a detached ruleset (`@map[k]` → `@x: { … }`).
    if (matched && matched.value.type === 'VarRef') {
      const bound = lookupVar(matched.frame, matched.value.name);
      if (bound && bound.type === 'DetachedRuleset') {
        return { body: bound.body, frame: (bound.defFrame as Frame | null) ?? matched.frame };
      }
    }
    return null;
  }
  return null;
}

/** Follow a `VarRef` / `Paren` chain to the underlying value node + its owning
 *  frame, so an `each()` iterable's list-vs-scalar shape reads off the DECLARED
 *  node (a literal `Any` list) rather than its flattened bytes. */
function resolveForNode(
  node: ValueNode,
  frame: Frame | null,
  e: EvalCtx,
): { node: ValueNode; frame: Frame | null } {
  let cur = node;
  let f = frame;
  for (;;) {
    if (cur.type === 'Paren') { cur = cur.inner; continue; }
    if (cur.type === 'VarRef') {
      const hit = resolveVarRef(f, cur.name, e);
      // A mixin-CALL binding is not a plain list/scalar iterable node; stop at the
      // `VarRef` (the list-fallback then treats it as a single item — the mixin-call
      // iterable proper is handled up front in `forItems`).
      if (!hit || hit.value.type === 'MixinCall') return { node: cur, frame: f };
      cur = hit.value;
      f = hit.frame;
      continue;
    }
    return { node: cur, frame: f };
  }
}

/**
 * Resolve an `each(.mixin(), …)` iterable: the ITERABLE is a mixin CALL whose
 * OUTPUT is iterated. Dispatch the call, collect its emitted declarations, and
 * present them as map items (key = declaration name, value = its value node) —
 * exactly the shape a detached-ruleset map iterates. Nested rulesets in the mixin
 * body are captured but discarded (a map iterates declarations, not rules).
 */
function forItemsFromMixinCall(call: MixinCall, frame: Frame, e: Emit): ForItem[] {
  const collected: Leaf[] = [];
  const noop = (): void => {};
  // Collect EVERY declaration (`forceLeading` → all decls to `collected`), discard
  // nested rules (they defer to `trailing`, which is never drained here).
  const discard: Partition = { encounteredContainer: false, trailing: [], pending: [], emitBlock: noop };
  expandCall(call, null, null, frame, collected, noop, discard, e, false, false, true);
  const items: ForItem[] = [];
  for (const leaf of collected) {
    const n = leaf.node;
    if (n.type === 'Declaration') {
      const name = typeof n.name === 'string' ? n.name : evalBytesSync(n.name, leaf.frame, e);
      items.push({ value: n.value, key: any(name) });
    } else if (n.type === 'VarDeclaration' && n.value.type !== 'MixinCall') {
      items.push({ value: n.value, key: any(n.name) });
    }
  }
  return items;
}

/** The ordered items an `each()` iterable expands to. */
function forItems(node: ValueNode | MixinCall, frame: Frame | null, e: Emit): ForItem[] {
  // [each mixin-call iterable] `.mixin()` output → iterate its declarations.
  if (node.type === 'MixinCall') {
    return frame === null ? [] : forItemsFromMixinCall(node, frame, e);
  }
  const map = resolveForRuleset(node, frame, e);
  if (map) {
    const items: ForItem[] = [];
    for (const s of map.body) {
      if (s.type === 'Declaration') {
        const name = typeof s.name === 'string' ? s.name : evalBytesSync(s.name, map.frame, e);
        items.push({ value: s.value, key: any(name) });
      } else if (s.type === 'VarDeclaration' && s.value.type !== 'MixinCall') {
        items.push({ value: s.value, key: any(s.name) });
      }
    }
    return items;
  }
  // A list iterable. A LITERAL word — an authored list (`1 2 3`, `a, b`) or a var
  // bound to one — is byte-split into its top-level items (Less's Expression/Value
  // list model, which the flattened value domain does not preserve structurally). A
  // COMPUTED value evaluates: a genuine `List` (`range(…)`) iterates its typed
  // items; any other single value (an escaped `e("…")`, a scalar) is ONE item — it
  // is not a list, so it is never split.
  const { node: base, frame: baseFrame } = resolveForNode(node, frame, e);
  if (base.type === 'Any' || base.type === 'Keyword') {
    return splitListBytes(base.src).map((b) => ({ value: any(b), key: null }));
  }
  const v = evalTyped(base, baseFrame, e);
  if (isThenable(v)) throw new Error('async value in an each() iterable is unsupported');
  if (v.type === 'List') return v.items.map((it) => ({ value: any(it.bytes), key: null }));
  return [{ value: any(v.bytes), key: null }];
}

/**
 * Expand a Less `each()` loop: emit the callback `rules` once per iterable item,
 * binding the loop variables (`@value`/`@key`/`@index`, or the anonymous-mixin
 * param names) in each iteration's scope. The statement-emitting counterpart to
 * {@link expandCall}: it walks the SAME shared `group`/`flush` so a `+`/`+_` merge
 * accumulates across iterations (`index+: @index` → `1, 2, 3`).
 */
function expandFor(
  node: For,
  composed: string[] | null,
  ancestor: string | null,
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  partition: Partition | null, // [partition] nested-ruleset sink (see walkBody)
  e: Emit,
  imp = false,
  protectedDup = false,
  forceLeading = false, // [partition] inherited leading-hoist context
): void {
  const items = forItems(node.iterable, frame, e);
  for (let i = 0; i < items.length; i++) {
    const { value, key } = items[i]!;
    const index = dimension(i + 1);
    const bindings = new Map<string, ValueNode>();
    if (node.valueName) bindings.set(node.valueName, value);
    if (node.keyName) bindings.set(node.keyName, key ?? index);
    if (node.indexName) bindings.set(node.indexName, index);
    const loopFrame: Frame = {
      parent: frame,
      mixins: collectMixins(node.rules),
      vars: mergeVars(bindings, collectVars(node.rules)),
      statements: node.rules,
    };
    walkBody(node.rules, composed, ancestor, loopFrame, group, flush, partition, e, imp, protectedDup, forceLeading);
  }
}

/**
 * [guards] Resolve the overloaded definitions that match a call. Args resolve to
 * BYTES in the caller frame (pattern-match); guard leaves compare TYPED values
 * in the callee frame through the injected `ValueEvaluator`.
 */
function dispatch(
  candidates: MixinDef[],
  call: MixinCall,
  frame: Frame,
  e: EvalCtx,
  homes?: Map<MixinDef, Frame>, // [closure] def → its DEFINITION frame (guard scope)
): Selection[] {
  const resolveCaller = makeResolver(frame, e);
  // [closure] a guard resolves free variables in the mixin's DEFINITION scope, with
  // the params overlaid and the call site as a fallback — the same frame layering
  // `expandCall` builds for the body. Absent a home (composeStats / detached call)
  // it falls back to the caller frame (`parent: frame`).
  const makeCalleeTyped = (def: MixinDef, bindings: Map<string, ValueNode> | null): TypedResolver => {
    const home = homes?.get(def);
    return makeTypedResolver(
      home && home !== frame
        ? { parent: home, mixins: null, vars: asStacks(bindings), fallback: frame }
        : { parent: frame, mixins: null, vars: asStacks(bindings) },
      e,
    );
  };
  // A DEFAULT param value resolves with the params bound so far in scope (Less:
  // `@hover-background: darken(@background, …)` reads the `@background` param)
  // overlaid on the mixin's DEFINITION scope, with the call site as a fallback —
  // the same frame layering `makeCalleeTyped` builds for guards. So a default like
  // `@parameter: @parameterDefault` reads the def-scope `@parameterDefault`, not a
  // same-name variable redeclared in the caller (`scope` fixture #allAreUsedHere).
  const resolveDefault: DefaultResolver = (v, boundSoFar, def) => {
    const home = homes?.get(def);
    const overlay: Frame = home && home !== frame
      ? { parent: home, mixins: null, vars: asStacks(boundSoFar), fallback: frame }
      : { parent: frame, mixins: null, vars: asStacks(boundSoFar) };
    const b = evalBytes(v, overlay, e);
    if (isThenable(b)) throw new Error('async value in a synchronous dispatch position');
    return b;
  };
  // [spread] `.mixin(@args...)` splats a list variable into positional args at the
  // call site (Less variadic forwarding) BEFORE binding, so overloads select on the
  // splatted arity.
  const call1 = expandSpreadArgs(call, resolveCaller);
  // an arg that is a variable bound to a detached ruleset must bind BY
  // REFERENCE (its body/closure survives); substitute the resolved node so the
  // eager byte-resolver never tries to serialize a ruleset as a value.
  const call2 = substituteDetachedVarArgs(call1, frame);
  return selectDefinitions(candidates, call2, resolveCaller, makeCalleeTyped, e.ev, e.modes, resolveDefault);
}

/** [spread] Replace each `@args...` spread arg with the POSITIONAL args it splats
 * to: resolve the list variable's bytes in the caller frame and split it on the
 * top-level list separator (comma, else whitespace). A spread of an empty/missing
 * value contributes no args. Non-spread args pass through unchanged. */
function expandSpreadArgs(call: MixinCall, resolveCaller: ValueResolver): MixinCall {
  if (!call.args.some((a) => a.spread)) return call;
  const args: CallArg[] = [];
  for (const a of call.args) {
    if (!a.spread) { args.push(a); continue; }
    const bytes = resolveCaller(a.value).trim();
    if (bytes === '') continue;
    for (const piece of splitListBytes(bytes)) args.push({ value: any(piece) });
  }
  return { type: 'MixinCall', name: call.name, args, path: call.path, important: call.important };
}

/** Replace `@rs` args (a VarRef bound to a detached ruleset) with the
 * resolved `DetachedRuleset` node so it binds by reference. */
function substituteDetachedVarArgs(call: MixinCall, frame: Frame): MixinCall {
  let changed = false;
  const args = call.args.map((a) => {
    if (a.value.type === 'VarRef') {
      const bound = lookupVar(frame, a.value.name);
      if (bound && bound.type === 'DetachedRuleset') {
        changed = true;
        return { ...a, value: bound };
      }
    }
    return a;
  });
  return changed ? { type: 'MixinCall', name: call.name, args, path: call.path, important: call.important } : call;
}

function flushBlock(sel: string[], group: Leaf[], e: Emit, selNode?: SelectorList, parentKey?: object | null): void {
  // [atrule] indent by the current block depth (0 at top level == prior behavior).
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  const header = idt ? sel.join(',\n' + idt) : sel.join(',\n');
  // [adjacent-merge] v5 merges consecutive same-selector SIBLING rulesets nested
  // under a common parent (see `Emit.lastBlock`): a non-null parent-expansion key
  // matching the prior block's, same header+depth, and strict adjacency (nothing
  // emitted since it closed) reopen the prior block rather than starting a new one.
  const pk = parentKey ?? null;
  const lb = e.lastBlock;
  const reopen = pk !== null && lb.parentKey === pk
    && lb.depth === e.depth && lb.header === header && lb.endChunks === e.chunks.length;
  if (reopen) {
    popClose(e, idt); // remove the prior block's trailing `}` (and its indent)
  } else {
    if (idt) put(e, idt);
    const selStart = e.off;
    put(e, header);
    if (e.positions && selNode) {
      e.positions.push({ node: selNode, type: selNode.type, start: selStart, end: e.off });
    }
    put(e, ' {\n');
  }
  // a leaf group with any `+`/`+_` merge folds; otherwise the byte-identical
  // per-leaf path (zero-cost gate), after collapsing duplicate declarations.
  if (groupHasMerge(group)) mergeFold(group, e, INDENT.repeat(e.depth + 1));
  else {
    const kept = dedupGroup(group, e);
    for (const leaf of kept) emitLeaf(leaf, e);
  }
  if (idt) put(e, idt);
  put(e, '}\n');
  // [adjacent-merge] update the single record in place (no per-block allocation).
  lb.parentKey = pk;
  lb.header = header;
  lb.depth = e.depth;
  lb.endChunks = e.chunks.length;
}

/** [adjacent-merge] Rewind the trailing block-close chunks emitted by `flushBlock`
 * (`}\n`, preceded by the block's indent chunk when nested) so a following body can
 * append inside the just-closed block. Only called when `lastBlock.endChunks`
 * proves those chunks are the current tail. */
function popClose(e: Emit, idt: string): void {
  const close = e.chunks.pop()!; // '}\n'
  if (e.positions) e.off -= close.length;
  if (idt) {
    const ind = e.chunks.pop()!; // the block-indent chunk
    if (e.positions) e.off -= ind.length;
  }
}

/**
 * [dedup] Less duplicate-declaration handling: within one block, for each
 * (name, value, !important) key keep only the LAST occurrence and drop earlier
 * exact duplicates — EXCEPT leaves flagged `protectedDup` (restricted overloaded-
 * mixin output), which are always kept. A cheap gate counts resolved names first
 * and bails when no property repeats, so a block without duplicates resolves no
 * value bytes (perf-neutral common path). Merge (`+`/`+_`) groups take the fold
 * path and never reach here.
 */
function dedupGroup(group: Leaf[], e: Emit): Leaf[] {
  if (group.length < 2) return group;
  // Gate: resolve each declaration NAME (cheap for string names); dedup only runs
  // if some property name occurs more than once in the block.
  const names: (string | null)[] = new Array(group.length).fill(null);
  const nameCounts = new Map<string, number>();
  let repeats = false;
  for (let i = 0; i < group.length; i++) {
    const n = group[i]!.node;
    if (n.type !== 'Declaration') continue;
    const nm = declName(n, group[i]!.frame, e);
    names[i] = nm;
    const c = (nameCounts.get(nm) ?? 0) + 1;
    nameCounts.set(nm, c);
    if (c > 1) repeats = true;
  }
  if (!repeats) return group;
  // Reverse keep-last: a key already recorded from a LATER position collapses this
  // (earlier) occurrence, unless it is protected restricted-mixin output.
  const seen = new Set<string>();
  let suppressed: Set<number> | null = null;
  for (let i = group.length - 1; i >= 0; i--) {
    const leaf = group[i]!;
    const n = leaf.node;
    if (n.type !== 'Declaration') continue;
    const nm = names[i]!;
    if ((nameCounts.get(nm) ?? 0) < 2) continue; // unique name → nothing to collapse
    const val = evalBytesSync(n.value, leaf.frame, e);
    const important = n.important || leaf.important === true;
    const key = `${nm}\x00${val}\x00${important ? '!' : ''}`;
    if (seen.has(key) && leaf.protectedDup !== true) {
      (suppressed ??= new Set<number>()).add(i);
    } else {
      seen.add(key);
    }
  }
  if (!suppressed) return group;
  const out: Leaf[] = [];
  for (let i = 0; i < group.length; i++) if (!suppressed.has(i)) out.push(group[i]!);
  return out;
}

/* --------------------------------------------------------------- merge */

function groupHasMerge(group: Leaf[]): boolean {
  for (const l of group) if (l.node.type === 'Declaration' && l.node.merge !== null) return true;
  return false;
}

/**
 * Emit a leaf group, folding `+`/`+_` merge declarations. v5 LAST-occurrence
 * anchor: a merged property's combined line sits at its LAST member's position;
 * members keep source order; any member's `!important` promotes the whole line.
 * Non-merge decls and comments emit in place (unchanged). `idt` is the leaf
 * indentation of the enclosing block. Deliberate v5 divergence from less.js
 * `_mergeRules` (which anchors FIRST); see CUTOVER-STATUS.md.
 */
function mergeFold(group: Leaf[], e: Emit, idt: string, emitOne: (l: Leaf, e: Emit) => void = emitLeaf): void {
  // Resolve each declaration's name once.
  const names: (string | null)[] = group.map((l) =>
    l.node.type === 'Declaration' ? declName(l.node, l.frame, e) : null,
  );
  // Merge groups: resolved name → member indices (source order).
  const mergeGroups = new Map<string, number[]>();
  for (let i = 0; i < group.length; i++) {
    const n = group[i]!.node;
    if (n.type === 'Declaration' && n.merge !== null) {
      const key = names[i]!;
      const arr = mergeGroups.get(key);
      if (arr) arr.push(i);
      else mergeGroups.set(key, [i]);
    }
  }
  for (let i = 0; i < group.length; i++) {
    const leaf = group[i]!;
    const n = leaf.node;
    if (n.type === 'Declaration' && n.merge !== null) {
      const indices = mergeGroups.get(names[i]!)!;
      if (i !== indices[indices.length - 1]) continue; // earlier members emit nothing; anchor at LAST
      let combined = '';
      let important = false;
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k]!;
        const dn = group[idx]!.node as Declaration;
        const bytes = evalBytesSync(dn.value, group[idx]!.frame, e);
        important ||= dn.important || group[idx]!.important === true;
        if (k === 0) combined = bytes;
        else combined += (dn.merge === ',' ? ', ' : ' ') + bytes;
      }
      emitMergedLine(e, names[i]!, combined, important, idt);
    } else {
      emitOne(leaf, e);
    }
  }
}

/** Emit one folded `name: combined[ !important];` line. */
function emitMergedLine(e: Emit, name: string, combined: string, important: boolean, idt: string): void {
  const start = e.off;
  put(e, idt);
  put(e, name);
  put(e, ': ');
  put(e, combined);
  if (important) put(e, ' !important');
  put(e, ';\n');
  if (e.positions) e.positions.push({ node: any(combined), type: 'Any', start, end: e.off });
}

function emitLeaf(leaf: Leaf, e: Emit, atRoot = false): void {
  const { node, frame } = leaf;
  const start = e.off;
  // [atrule] a declaration/comment sits one level in from its container's depth.
  // A leaf emitted directly at the document root (not inside any block) sits flush
  // left at depth 0 rather than one level in.
  const idt = atRoot ? INDENT.repeat(e.depth) : e.depth > 0 ? INDENT.repeat(e.depth + 1) : INDENT;
  if (node.type === 'Declaration') {
    put(e, idt);
    put(e, declName(node, frame, e)); // resolve interpolated property name
    const onNewLine = node.valueOnNewLine === true;
    put(e, onNewLine ? ':' : ': ');
    const important = node.important === true || leaf.important === true;
    putValue(e, node.value, frame, node.value, idt + INDENT, important, onNewLine); // [whitespace] continuation indent
    if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
    put(e, ';\n');
  } else if (node.type === 'Comment') {
    put(e, idt);
    put(e, node.text);
    put(e, '\n');
    if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
  } else if (node.type === 'AtRuleBlock') {
    // [atrule-nested] a stay-nested at-rule buffered into a decl group: emit one
    // block level deeper than the containing declarations.
    e.depth++;
    emitAtRuleBlock(node, frame, e);
    e.depth--;
  } else if (node.type === 'AtRuleStatement') {
    e.depth++;
    emitAtRuleStatement(node, frame, e);
    e.depth--;
  }
}

/* ------------------------------------------------------------ [atrule] emit */

/** A statement at-rule: `@name prelude;` with prelude bytes kept literal. */
/** [charset] `@charset` is a document-prelude construct, not an inline at-rule. */
function isCharset(node: AtRuleStatement): boolean {
  return node.name.toLowerCase() === '@charset';
}

/**
 * [charset] Emit the FIRST document-level `@charset` at the top of the output.
 * Every inline occurrence (including this one) is dropped by
 * `emitAtRuleStatement`, so the single hoisted copy is the whole output — the
 * dedupe. Mirrors legacy jess / Less 4.x: first charset wins, rest dropped.
 */
function emitHoistedCharset(children: Statement[], frame: Frame, e: Emit): void {
  for (const c of children) {
    if (c.type === 'AtRuleStatement' && isCharset(c as AtRuleStatement)) {
      emitAtRuleStatementRaw(c as AtRuleStatement, frame, e);
      return;
    }
  }
}

/**
 * [import:hoist] Emit every css-passthrough `@import` (marked `hoist` by the
 * resolution pass) at the document top, in source-encounter order, as literal
 * `@import …;` bytes. Recurses into nested ruleset / at-rule bodies so an import
 * that resolved inside a nested block still hoists to the top (matching Less).
 */
function emitHoistedImports(children: Statement[], e: Emit): void {
  const imports: StyleImport[] = [];
  collectHoistedImports(children, imports);
  for (const imp of imports) {
    const start = e.off;
    put(e, imp.raw);
    put(e, '\n');
    if (e.positions) e.positions.push({ node: imp, type: imp.type, start, end: e.off });
  }
}

function collectHoistedImports(statements: Statement[], out: StyleImport[]): void {
  for (const s of statements) {
    if (s.type === 'StyleImport') {
      if (s.hoist) out.push(s);
    } else if (s.type === 'Rule' || s.type === 'AtRuleBlock') {
      collectHoistedImports(s.body, out);
    }
  }
}

function emitAtRuleStatement(node: AtRuleStatement, frame: Frame, e: Emit): void {
  // [charset] Inline `@charset` occurrences are dropped; `serialize` hoists the
  // first to the document top (dedupe).
  if (isCharset(node)) return;
  emitAtRuleStatementRaw(node, frame, e);
}

function emitAtRuleStatementRaw(node: AtRuleStatement, frame: Frame, e: Emit): void {
  const start = e.off;
  if (e.depth > 0) put(e, INDENT.repeat(e.depth));
  put(e, node.name);
  if (node.prelude !== null) {
    // A statement prelude resolves only `@{…}` interpolation (`@charset
    // "UTF-@{Eight}"`); a bare-`@var` / static prelude is a verbatim `Any`.
    const p = evalBytesSync(node.prelude, frame, e).replace(/^\s+/u, '');
    if (p.length > 0) {
      put(e, ' ');
      put(e, p);
    }
  }
  put(e, ';\n');
  if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
}

/**
 * [import:inline] Emit `@import (inline)` raw bytes verbatim: the target file's
 * exact text, unparsed and unindented, followed by a single newline separating it
 * from the next statement (mirrors Less's inline splice — an `Anonymous` value
 * printed as-is with a trailing rule separator).
 *
 * [import:inline-media] With a media postlude, the splice is wrapped in an
 * `@media <media> { … }` block: Less wraps the inline `Anonymous` in a media
 * ruleset, so the raw first line is indented one level and the block closes with a
 * `\n}` — reproducing the media-feature colon spacing (`(min-width:…)` →
 * `(min-width: …)`) Less's media parser reprints.
 */
function emitRawInline(node: RawInline, e: Emit): void {
  const start = e.off;
  if (node.media != null) {
    const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
    put(e, idt);
    put(e, '@media ');
    put(e, normalizeMediaFeatures(node.media));
    put(e, ' {\n');
    put(e, INDENT.repeat(e.depth + 1));
    put(e, node.text);
    put(e, '\n');
    put(e, idt);
    put(e, '}\n');
  } else {
    put(e, node.text);
    put(e, '\n');
  }
  if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
}

/**
 * [import:inline-media] Reprint a media-query prelude's feature colons with
 * Less's `name: value` spacing (`(min-width:600px)` → `(min-width: 600px)`),
 * matching Less's media parser which re-emits each feature with a space after the
 * colon. Only the feature colon immediately inside a paren is touched; other text
 * (media types, `and`/`or`, values) is preserved verbatim.
 */
function normalizeMediaFeatures(prelude: string): string {
  return prelude.replace(/\(\s*([-\w]+)\s*:\s*/gu, '($1: ');
}

/**
 * [import] Emit an UNRESOLVED `@import` verbatim. The import-resolution pass
 * normally replaces every `StyleImport` before serialize runs, so this reaches
 * the emitter only for a CSS-passthrough / deferred import the pass left in
 * place — where re-emitting the authored `@import …;` bytes is the correct output.
 * A trailing newline separates it from the next statement (the authored `raw`
 * ends at the `;`), matching every other statement emitter.
 */
function emitStyleImport(node: StyleImport, e: Emit): void {
  const start = e.off;
  put(e, node.raw);
  put(e, '\n');
  if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
}

/**
 * [atrule-bubbling] Conditional-group at-rules whose bodies participate in
 * selector nesting: when such an at-rule is bubbled OUT of a ruleset, the
 * enclosing composed selector PROPAGATES inside — direct declarations wrap in a
 * ruleset with that selector and nested rulesets compose against it. Every other
 * (directive) at-rule — `@font-face`, `@keyframes`, `@page`, `@counter-style`,
 * `@property`, `@viewport`, `@font-feature-values`, … — bubbles to the same
 * level but does NOT take a selector context (its declarations / keyframe
 * selectors stay bare). Matches Less's media/atrule bubbling.
 */
const BUBBLEABLE_ATRULES: ReadonlySet<string> = new Set([
  '@media',
  '@supports',
  '@document',
  '@-moz-document',
  '@container',
  '@layer',
  '@scope',
]);
function isBubbleable(name: string): boolean {
  return BUBBLEABLE_ATRULES.has(name.toLowerCase());
}

/**
 * [atrule-nested] Directive at-rules that BUBBLE out of a ruleset to the same
 * level WITHOUT taking a selector context (their declarations / keyframe
 * selectors stay bare). Distinct from the conditional-group family
 * ({@link BUBBLEABLE_ATRULES}) which projects the enclosing selector inside.
 */
const DIRECTIVE_ATRULES: ReadonlySet<string> = new Set([
  '@font-face',
  '@keyframes',
  '@-webkit-keyframes',
  '@-moz-keyframes',
  '@-o-keyframes',
  '@page',
  '@viewport',
  '@-ms-viewport',
  '@counter-style',
  '@property',
  '@font-feature-values',
  '@host',
  '@-x-document',
  '@namespace',
]);

/**
 * [atrule-nested] An at-rule that STAYS NESTED inside its parent ruleset (v5,
 * `collapseNesting:false` for this shape): `@starting-style` — whose direct
 * declarations belong to the enclosing selector's starting state and so cannot
 * hoist to root — and any UNKNOWN at-rule (e.g. `@apply`), which the serializer
 * cannot bubble without knowing its semantics. Every recognized conditional-group
 * ({@link BUBBLEABLE_ATRULES}) or directive ({@link DIRECTIVE_ATRULES}) at-rule
 * bubbles as before; this predicate only diverts the remaining names.
 */
function staysNested(name: string): boolean {
  const n = name.toLowerCase();
  if (n === '@starting-style') return true;
  return !BUBBLEABLE_ATRULES.has(n) && !DIRECTIVE_ATRULES.has(n);
}

/**
 * [atrule-supports] v5 NORMALIZES an `@supports` condition's prelude to the
 * compact single-line form, diverging from 4.x (which preserves source spacing).
 * Collapse whitespace runs (incl. authored newlines/indent) to a single space,
 * then strip the padding immediately inside each condition's parens:
 *   `( box-shadow: … ) or\n   ( -moz-box-shadow: … )`
 *     → `(box-shadow: …) or (-moz-box-shadow: …)`
 * `not (…)` / operator spacing is preserved (a space that is neither right after
 * `(` nor right before `)` stays). All other corpus `@supports` preludes are
 * already compact, so this is a no-op there.
 */
function normalizeSupportsPrelude(p: string): string {
  return p.replace(/\s+/gu, ' ').replace(/\(\s+/gu, '(').replace(/\s+\)/gu, ')');
}

/**
 * [atrule-prelude] v5 normalizes a `@media` / `@container` query prelude's
 * SPACING (a serialization concern — evaluating a `@var` / operation / escaped
 * string in a prelude is a SEPARATE, not-yet-wired capability, so those pass
 * through as-is). On the PLAIN (non-opaque) runs:
 *   - a feature colon gets `name: value` spacing (`(orientation:portrait)` →
 *     `(orientation: portrait)`);
 *   - a `<` / `>` / `<=` / `>=` range comparison and a `/` ratio operator get
 *     single surrounding spaces (`(width<500px)` → `(width < 500px)`,
 *     `(aspect-ratio: 3/2)` → `(aspect-ratio: 3 / 2)`) — v5 operators/separators
 *     emit spaced;
 *   - padding immediately inside a condition paren is stripped (`( width< 500px )`
 *     → `(width < 500px)`);
 *   - a logical `and` / `or` / `not` keeps a space before its `(` (`and(…)` →
 *     `and (…)`).
 * Quoted runs (`"…"`, `'…'`, `~"…"`, `~'…'`) and `/* … *\/` comments are OPAQUE:
 * their bytes pass through untouched, so an escaped `~"2/1"` is never mistaken for
 * a ratio operator and a `/* … *\/` keyword comment survives verbatim. Every
 * transform is idempotent on an already-canonical prelude (`(min-width: 1024px)`,
 * `screen, print, handheld`, `(a) or (b)`), so already-matching goldens are
 * unaffected.
 */
function normalizeQueryPrelude(p: string): string {
  let out = '';
  let i = 0;
  const n = p.length;
  while (i < n) {
    const c = p[i]!;
    // OPAQUE — a `/* … */` comment: copy through verbatim.
    if (c === '/' && p[i + 1] === '*') {
      const end = p.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += p.slice(i, stop);
      i = stop;
      continue;
    }
    // OPAQUE — a quoted string, optionally escaped (`~"…"` / `~'…'`).
    const esc = c === '~' && (p[i + 1] === '"' || p[i + 1] === "'");
    if (c === '"' || c === "'" || esc) {
      const q = esc ? p[i + 1]! : c;
      let j = esc ? i + 2 : i + 1;
      while (j < n && p[j] !== q) j++;
      const stop = j < n ? j + 1 : n;
      out += p.slice(i, stop);
      i = stop;
      continue;
    }
    // PLAIN run — up to the next opaque start; normalize its spacing.
    let j = i;
    while (j < n) {
      const d = p[j]!;
      if (d === '"' || d === "'") break;
      if (d === '~' && (p[j + 1] === '"' || p[j + 1] === "'")) break;
      if (d === '/' && p[j + 1] === '*') break;
      j++;
    }
    out += normalizeQueryPlainRun(p.slice(i, j));
    i = j;
  }
  return out;
}

/** [atrule-prelude] Spacing normalization of ONE plain (non-quote/comment) run of
 * a query prelude. See {@link normalizeQueryPrelude} for the rules; each `replace`
 * is idempotent on canonical input. */
function normalizeQueryPlainRun(s: string): string {
  return s
    .replace(/\(\s+/gu, '(') // strip padding right after `(`
    .replace(/\s+\)/gu, ')') // strip padding right before `)`
    .replace(/\s*:\s*/gu, ': ') // feature colon → `name: value`
    .replace(/\s*\/\s*/gu, ' / ') // ratio `/` → spaced (v5 operators spaced)
    .replace(/\s*(<=|>=|<|>)\s*/gu, ' $1 ') // range comparison → spaced
    .replace(/\b(and|or|not)\s*\(/gu, '$1 ('); // `and(` → `and (`
}

/**
 * A block at-rule: `@name prelude { …body }`, emitted at the current block depth.
 *
 * [atrule-bubbling] `ctx` is the enclosing composed selector context this at-rule
 * bubbled out of (null / empty at document root or directly inside another
 * at-rule). For a bubbleable (conditional-group) at-rule the body PROJECTS that
 * context inside (see `emitBubbleBody`); for a directive at-rule the body is a
 * plain declaration/keyframe block (`emitAtRuleBody`) and `ctx` is ignored. An
 * at-rule whose body renders empty is dropped entirely (header + braces).
 */
function emitAtRuleBlock(node: AtRuleBlock, frame: Frame, e: Emit, ctx: string[] | null = null): void {
  const markChunks = e.chunks.length;
  const markOff = e.off;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (idt) put(e, idt);
  put(e, node.name);
  if (node.prelude !== null) {
    let p = evalBytesSync(node.prelude, frame, e);
    const lname = node.name.toLowerCase();
    if (lname === '@supports') p = normalizeSupportsPrelude(p);
    else if (lname === '@media' || lname === '@container') p = normalizeQueryPrelude(p);
    if (p.length > 0) {
      put(e, ' ');
      put(e, p);
    }
  }
  put(e, ' {\n');
  const afterHeader = e.chunks.length;
  const bodyFrame: Frame = {
    parent: frame,
    mixins: collectMixins(node.body),
    vars: collectVars(node.body),
    statements: node.body,
  };
  if (isBubbleable(node.name)) {
    // A non-empty selector context propagates inside; null/empty keeps the
    // top-level shape (bare direct decls) but still bubbles nested at-rules out
    // of the body's rulesets.
    emitBubbleBody(node.body, ctx && ctx.length > 0 ? ctx : null, bodyFrame, e);
  } else {
    emitAtRuleBody(node.body, bodyFrame, e);
  }
  if (e.chunks.length === afterHeader) {
    // Nothing emitted: drop the whole at-rule (rewind chunks/offset/positions).
    e.chunks.length = markChunks;
    e.off = markOff;
    if (e.positions) e.positions.length = markPos;
    return;
  }
  if (idt) put(e, idt);
  put(e, '}\n');
  if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
}

/**
 * Emit an at-rule body. Consecutive declarations/comments group as DIRECT block
 * children (no selector wrapper). A nested ruleset / at-rule descends one level.
 */
function emitAtRuleBody(statements: Statement[], frame: Frame, e: Emit): void {
  const group: Leaf[] = [];
  const flushDirect = (): void => {
    if (group.length > 0) {
      if (groupHasMerge(group)) mergeFold(group, e, INDENT.repeat(e.depth + 1));
      else for (const leaf of group) emitLeaf(leaf, e);
      group.length = 0;
    }
  };
  for (const node of statements) {
    switch (node.type) {
      case 'Declaration':
      case 'Comment':
        group.push({ node, frame });
        break;
      case 'Rule':
        flushDirect();
        e.depth++;
        flatten(node, null, null, frame, e);
        e.depth--;
        break;
      case 'AtRuleBlock':
        flushDirect();
        e.depth++;
        emitAtRuleBlock(node, frame, e);
        e.depth--;
        break;
      case 'AtRuleStatement':
        flushDirect();
        e.depth++;
        emitAtRuleStatement(node, frame, e);
        e.depth--;
        break;
      case 'MixinCall':
        // Best-effort: expand into the direct-declaration group.
        expandCall(node, null, null, frame, group, flushDirect, null, e);
        break;
      case 'DetachedCall':
        expandDetachedCall(node, null, null, frame, group, flushDirect, null, e);
        break;
      case 'For':
        expandFor(node, null, null, frame, group, flushDirect, null, e);
        break;
      // [import:inline] raw verbatim bytes spliced by `@import (inline)`.
      case 'RawInline':
        flushDirect();
        emitRawInline(node, e);
        break;
      case 'MixinDef':
      case 'VarDeclaration':
        break;
    }
  }
  flushDirect();
}

/**
 * [atrule-bubbling] Emit a bubbleable (conditional-group) at-rule body, PROJECTING
 * the enclosing selector context `ctx` inside per the spine-is-projection
 * principle (no tree mutation):
 *   - `ctx !== null`  — the at-rule bubbled out of a ruleset: consecutive direct
 *     declarations wrap in a `ctx { … }` block, and a nested ruleset composes
 *     against `ctx` (so `.b &` under `.a` → `.b .a`). Everything sits one block
 *     level in from the at-rule header.
 *   - `ctx === null`  — a top-level (or directly at-rule-nested) bubbleable
 *     at-rule: direct declarations stay bare and nested rulesets keep their own
 *     selectors — byte-identical to `emitAtRuleBody`.
 * In BOTH cases a further-nested at-rule bubbles: one inside a nested ruleset
 * carries that ruleset's composed selector as its context (via `walkBody`); one
 * directly inside this body inherits `ctx` unchanged.
 */
function emitBubbleBody(statements: Statement[], ctx: string[] | null, frame: Frame, e: Emit): void {
  // [nesting] opaque ancestor for `&`-less rules composed inside the bubbled context.
  const ctxAncestor = ctx === null ? null : wrapIsList(ctx);
  const group: Leaf[] = [];
  const flushDirect = (): void => {
    if (group.length === 0) return;
    if (ctx !== null) {
      // Wrap the direct declarations in the propagated selector context.
      e.depth++;
      flushBlock(ctx, group, e);
      e.depth--;
    } else if (groupHasMerge(group)) {
      mergeFold(group, e, INDENT.repeat(e.depth + 1));
    } else {
      for (const leaf of group) emitLeaf(leaf, e);
    }
    group.length = 0;
  };
  for (const node of statements) {
    switch (node.type) {
      case 'Declaration':
      case 'Comment':
        group.push({ node, frame });
        break;
      case 'Rule':
        flushDirect();
        e.depth++;
        flatten(node, ctx, ctxAncestor, frame, e);
        e.depth--;
        break;
      case 'AtRuleBlock':
        flushDirect();
        e.depth++;
        emitAtRuleBlock(node, frame, e, ctx); // directly-nested at-rule inherits ctx
        e.depth--;
        break;
      case 'AtRuleStatement':
        flushDirect();
        e.depth++;
        emitAtRuleStatement(node, frame, e);
        e.depth--;
        break;
      case 'MixinCall':
        expandCall(node, ctx, ctxAncestor, frame, group, flushDirect, null, e);
        break;
      case 'DetachedCall':
        expandDetachedCall(node, ctx, ctxAncestor, frame, group, flushDirect, null, e);
        break;
      case 'For':
        expandFor(node, ctx, ctxAncestor, frame, group, flushDirect, null, e);
        break;
      case 'MixinDef':
      case 'VarDeclaration':
        break;
    }
  }
  flushDirect();
}

/* ------------------------------------------------------ [nested/R0] emit */

/**
 * Nested-output emit (Less v5 default, `collapseNesting:false`).
 *
 * Convention: when a `*Nested*` emitter runs, `e.depth` is the indentation
 * LEVEL of the statements it emits — a direct declaration, a child-rule header,
 * or a nested at-rule header all sit at `INDENT.repeat(e.depth)`. Entering a
 * rule/at-rule body raises the level by one for the body's contents.
 *
 * Unlike the flattened path, selectors are NEVER composed with the parent: each
 * rule emits its own local selector text verbatim (so `&:hover`, `> .b`,
 * `.b &`, and `.b, .c` all stay literal), and a placed mixin body splices its
 * statements inline at the call-site level (its own nested rules therefore nest
 * under the call site, keeping their own local selectors).
 */
function emitNestedBody(
  statements: Statement[],
  frame: Frame,
  e: Emit,
  hoist?: { rule: Rule; frame: Frame }[],
): void {
  // buffer consecutive DIRECT leaves so a `+`/`+_` merge group can fold at
  // last-occurrence; flush when an interrupting nested rule/at-rule appears (a
  // merge group does not span an interrupting nested block). Absent any merge the
  // buffer flushes verbatim per-leaf (byte-identical to the prior stream).
  const buf: Leaf[] = [];
  const flushBuf = (): void => {
    if (buf.length === 0) return;
    if (groupHasMerge(buf)) mergeFold(buf, e, e.depth > 0 ? INDENT.repeat(e.depth) : '', emitNestedLeaf);
    else for (const leaf of buf) emitNestedLeaf(leaf, e);
    buf.length = 0;
  };
  for (const node of statements) {
    switch (node.type) {
      case 'Declaration':
      case 'Comment':
        buf.push({ node, frame });
        break;
      case 'Rule': {
        flushBuf();
        // [extend] a rule whose extend match crosses the `&` FLATTENS: defer it to
        // the enclosing rule's hoist queue (emitted flat at that rule's depth).
        if (hoist && e.extends?.nestedPlan.get(node)?.flatten) {
          hoist.push({ rule: node, frame });
          break;
        }
        emitNestedRule(node, frame, e);
        break;
      }
      case 'MixinCall':
        flushBuf();
        expandNestedCall(node, frame, e);
        break;
      case 'DetachedCall':
        flushBuf();
        expandNestedDetachedCall(node, frame, e);
        break;
      case 'For':
        flushBuf();
        expandNestedFor(node, frame, e);
        break;
      case 'AtRuleBlock':
        flushBuf();
        emitNestedAtRuleBlock(node, frame, e);
        break;
      case 'AtRuleStatement':
        flushBuf();
        emitAtRuleStatement(node, frame, e);
        break;
      // [import:inline] raw verbatim bytes spliced by `@import (inline)`.
      case 'RawInline':
        flushBuf();
        emitRawInline(node, e);
        break;
      case 'MixinDef':
      case 'VarDeclaration':
        break; // definitions emit nothing
    }
  }
  flushBuf();
}

/** A `name: value;` / comment leaf at exactly the current `e.depth` level. */
function emitNestedLeaf(leaf: Leaf, e: Emit): void {
  const { node, frame } = leaf;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (node.type === 'Declaration') {
    if (idt) put(e, idt);
    put(e, declName(node, frame, e)); // resolve interpolated property name
    put(e, ': ');
    const valStart = e.off;
    const important = node.important === true || leaf.important === true;
    putValue(e, node.value, frame, node.value, idt + INDENT, important); // [whitespace] continuation indent
    if (e.positions) {
      e.positions.push({ node: node.value, type: node.value.type, start: valStart, end: e.off });
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
    put(e, ';\n');
  } else if (node.type === 'Comment') {
    if (idt) put(e, idt);
    put(e, node.text);
    put(e, '\n');
    if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
  }
}

/**
 * Emit one rule with its authored nesting preserved. The header is the rule's
 * OWN selector list (never composed with the parent); the body is emitted one
 * level deeper. A rule whose body produces no output (empty, definition-only, or
 * only-nested-rules-that-themselves-drop) is dropped entirely — header and
 * braces rewound — matching v5.
 */
function emitNestedRule(rule: Rule, frame: Frame, e: Emit): void {
  const plan = e.extends?.nestedPlan.get(rule);
  if (plan?.collapseTransparent) {
    // [extend] decl-less `&&` self-collapse: emit the body (the pure-`&` child,
    // which carries its composed header via its own plan) at THIS level, dropping
    // this rule's wrapper.
    const childFrame: Frame = {
      parent: frame,
      mixins: collectMixins(rule.body),
      vars: collectVars(rule.body),
    };
    emitNestedBody(rule.body, childFrame, e);
    return;
  }
  if (plan?.flatten) {
    // Fallback (a top-level rule never flattens; a body-nested one is deferred by
    // emitNestedBody's hoist queue). Emit via the flat path with compaction.
    emitHoisted(rule, frame, e);
    return;
  }
  const markChunks = e.chunks.length;
  const markOff = e.off;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (idt) put(e, idt);
  // [extend] nested header uses the projected own-local branch list; children
  // stay literal (nested mode composes nothing).
  const own = plan ? plan.header : ownStrings(rule.selector, frame, e);
  const selStart = e.off;
  put(e, idt ? own.join(',\n' + idt) : own.join(',\n'));
  if (e.positions) {
    e.positions.push({ node: rule.selector, type: rule.selector.type, start: selStart, end: e.off });
  }
  put(e, ' {\n');
  const afterHeader = e.chunks.length;
  const childFrame: Frame = {
    parent: frame,
    mixins: collectMixins(rule.body),
    vars: collectVars(rule.body),
    statements: rule.body,
  };
  // [extend] children that flatten (extend crossed the `&`) bubble out to this
  // rule's depth; collect them and emit flat after the block closes.
  const hoist: { rule: Rule; frame: Frame }[] = [];
  e.depth++;
  emitNestedBody(rule.body, childFrame, e, hoist);
  e.depth--;
  if (e.chunks.length === afterHeader) {
    // Nothing emitted in the block: drop the header/braces (rewind).
    e.chunks.length = markChunks;
    e.off = markOff;
    if (e.positions) e.positions.length = markPos;
  } else {
    if (idt) put(e, idt);
    put(e, '}\n');
    if (e.positions) e.positions.push({ node: rule, type: rule.type, start, end: e.off });
  }
  // [extend] split-out exact extenders (target has surviving nested children):
  // sibling rules carrying only the target's DIRECT declarations (empty → drop).
  if (plan && plan.splits.length > 0) {
    const direct: Leaf[] = [];
    for (const st of rule.body) {
      if (st.type === 'Declaration' || st.type === 'Comment') {
        direct.push({ node: st, frame: childFrame });
      }
    }
    if (direct.length > 0) {
      for (const header of plan.splits) flushBlock(header, direct, e);
    }
  }
  // [extend] hoisted (flattened) children, emitted flat at this rule's depth.
  for (const h of hoist) emitHoisted(h.rule, h.frame, e);
}

/** Emit a flattened rule (and its descendants) via the flat path at `e.depth`,
 * using the nested-mode hoist header (flat composition + `:is()`-compaction). */
function emitHoisted(rule: Rule, frame: Frame, e: Emit): void {
  const prev = e.hoistMode;
  e.hoistMode = true;
  flatten(rule, null, null, frame, e);
  e.hoistMode = prev;
}

/**
 * Expand a mixin call in nested mode: select the matching overloaded
 * definitions, then SPLICE each shared body inline at the current level — the
 * body's declarations join the call-site block and its nested rules nest under
 * the call site (own selectors). No clone, no per-placement node build.
 */
function expandNestedCall(call: MixinCall, frame: Frame, e: Emit): void {
  // namespaced call descends a ruleset path first.
  const dispatchFrame = call.path.length > 0 ? descendNamespacePath(call.path, frame) : frame;
  if (dispatchFrame === null) return;
  const candidates = lookupMixinCandidates(dispatchFrame, call.name);
  if (candidates.length === 0) return;
  const selected = dispatch(candidates, call, frame, e);
  for (const { def, bindings } of selected) {
    captureArgDefFrames(bindings, frame);
    const callFrame: Frame = {
      parent: dispatchFrame,
      mixins: collectMixins(def.body),
      vars: mergeVars(bindings, collectVars(def.body)),
      statements: def.body,
    };
    emitNestedBody(def.body, callFrame, e);
  }
}

/** Expand a detached-ruleset call in nested mode. */
function expandNestedDetachedCall(call: DetachedCall, frame: Frame, e: Emit): void {
  const r = detachedCallFrame(call.varName, frame);
  if (!r) return;
  emitNestedBody(r.dr.body, r.callFrame, e);
}

/** Expand an `each()` loop in nested mode: splice the callback body once per item
 *  with that iteration's loop-variable bindings. (A cross-iteration `+`/`+_` merge
 *  does not fold across the per-iteration bodies in nested mode — flat mode does.) */
function expandNestedFor(node: For, frame: Frame, e: Emit): void {
  const items = forItems(node.iterable, frame, e);
  for (let i = 0; i < items.length; i++) {
    const { value, key } = items[i]!;
    const index = dimension(i + 1);
    const bindings = new Map<string, ValueNode>();
    if (node.valueName) bindings.set(node.valueName, value);
    if (node.keyName) bindings.set(node.keyName, key ?? index);
    if (node.indexName) bindings.set(node.indexName, index);
    const loopFrame: Frame = {
      parent: frame,
      mixins: collectMixins(node.rules),
      vars: mergeVars(bindings, collectVars(node.rules)),
      statements: node.rules,
    };
    emitNestedBody(node.rules, loopFrame, e);
  }
}

/**
 * A block at-rule in nested mode: `@name prelude { …body }`. The header sits at
 * the current level; the body is a fresh nesting context one level deeper whose
 * nested rulesets STAY nested (they are not flattened). An at-rule whose body
 * renders empty is dropped entirely.
 */
function emitNestedAtRuleBlock(node: AtRuleBlock, frame: Frame, e: Emit): void {
  const markChunks = e.chunks.length;
  const markOff = e.off;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (idt) put(e, idt);
  put(e, node.name);
  if (node.prelude !== null) {
    let p = evalBytesSync(node.prelude, frame, e);
    const lname = node.name.toLowerCase();
    if (lname === '@supports') p = normalizeSupportsPrelude(p);
    else if (lname === '@media' || lname === '@container') p = normalizeQueryPrelude(p);
    if (p.length > 0) {
      put(e, ' ');
      put(e, p);
    }
  }
  put(e, ' {\n');
  const afterHeader = e.chunks.length;
  const bodyFrame: Frame = {
    parent: frame,
    mixins: collectMixins(node.body),
    vars: collectVars(node.body),
    statements: node.body,
  };
  e.depth++;
  emitNestedBody(node.body, bodyFrame, e);
  e.depth--;
  if (e.chunks.length === afterHeader) {
    e.chunks.length = markChunks;
    e.off = markOff;
    if (e.positions) e.positions.length = markPos;
    return;
  }
  if (idt) put(e, idt);
  put(e, '}\n');
  if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
}

/* ---------------------------------------------- composition-op instrumentation */

export interface ComposeStats {
  /** (parent x child) selector compositions performed during eval+emit. */
  composeOps: number;
  /** Selector strings allocated by composition. */
  selectorAllocs: number;
  /** Distinct composed selector strings produced (interning ceiling). */
  distinctSelectors: number;
}

/**
 * Untimed instrumentation: replays the eval+emit walk (including mixin
 * placement) and counts the selector compositions tree2 performs — the leading
 * indicator to compare against legacy `withComponents`/`cloneForPlacement`/
 * `inherit` counts. Kept OUT of the timed path.
 */
export function composeStats(root: Root, evaluator?: ValueEvaluator, modes?: EvalModes): ComposeStats {
  const stats: ComposeStats = { composeOps: 0, selectorAllocs: 0, distinctSelectors: 0 };
  const seen = new Set<string>();
  const ectx: EvalCtx = { ev: evaluator ?? null, modes: modes ?? DEFAULT_MODES, excluded: new Set(), propNames: new Set() };

  const composeCount = (parents: string[], child: SelectorList, frame: Frame): string[] => {
    const res: string[] = [];
    for (const c of child.selectors) {
      stats.composeOps++;
      for (const s of composeOne(parents, c, frame, ectx)) {
        stats.selectorAllocs++;
        res.push(s);
        seen.add(s);
      }
    }
    return res;
  };

  const walk = (statements: Statement[], composed: string[], frame: Frame): void => {
    for (const node of statements) {
      if (node.type === 'Rule') {
        walkRule(node, composed, frame);
      } else if (node.type === 'MixinCall') {
        // [guards] mirror the real overloaded dispatch so guarded/pattern
        // fixtures count the compositions they actually produce.
        const candidates = lookupMixinCandidates(frame, node.name);
        if (candidates.length === 0) continue;
        for (const { def, bindings } of dispatch(candidates, node, frame, ectx)) {
          const callFrame: Frame = {
            parent: frame,
            mixins: collectMixins(def.body),
            vars: mergeVars(bindings, collectVars(def.body)),
          };
          walk(def.body, composed, callFrame);
        }
      } else if (node.type === 'AtRuleBlock') {
        // [atrule] an at-rule body is a fresh nesting context (see enterAtRule).
        enterAtRule(node, frame);
      }
    }
  };
  const walkRule = (rule: Rule, parent: string[] | null, frame: Frame): void => {
    const composed =
      parent === null ? ownStrings(rule.selector, frame, ectx) : composeCount(parent, rule.selector, frame);
    const childFrame: Frame = {
      parent: frame,
      mixins: collectMixins(rule.body),
      vars: collectVars(rule.body),
    };
    walk(rule.body, composed, childFrame);
  };

  // [atrule] enter at-rule bodies from the root too (top-level `@media {…}`),
  // so nested-ruleset compositions inside a block are counted, not skipped.
  const enterAtRule = (node: AtRuleBlock, frame: Frame): void => {
    const bodyFrame: Frame = {
      parent: frame,
      mixins: collectMixins(node.body),
      vars: collectVars(node.body),
    };
    for (const child of node.body) {
      if (child.type === 'Rule') walkRule(child, null, bodyFrame);
      else if (child.type === 'MixinCall') walk([child], [], bodyFrame);
      else if (child.type === 'AtRuleBlock') enterAtRule(child, bodyFrame);
    }
  };

  const rootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.children),
    vars: collectVars(root.children),
  };
  for (const child of root.children) {
    if (child.type === 'Rule') walkRule(child, null, rootFrame);
    else if (child.type === 'AtRuleBlock') enterAtRule(child, rootFrame);
  }
  stats.distinctSelectors = seen.size;
  return stats;
}
