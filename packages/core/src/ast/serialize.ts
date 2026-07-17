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
  word,
  compoundCanonical,
  compoundHasInterp,
  complexCanonical,
  complexHasInterp,
  complexHasAmpersand,
} from './nodes.js';
import type {
  Complex,
  Compound,
  Declaration,
  DetachedCall,
  DetachedRuleset,
  FunctionCall,
  Interp,
  MapAccessor,
  MixinCall,
  MixinDef,
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
import { LiteralTag, type LitFields, tagForWord } from './literal-tag.js'; // [value-literal-tag]
import { selectDefinitions, type Selection } from './mixin-dispatch.js'; // [guards]
import type { ValueResolver, TypedResolver } from './guard.js'; // [guards]
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
  vars: Map<string, ValueNode[]> | null;
  // secondary scope consulted after the `parent` chain is exhausted (the
  // detached-ruleset definition closure — caller-first, definition-fallback).
  fallback?: Frame | null;
  // rulesets visible at this level, keyed by their own-local selector
  // string (namespace path descent). Lazily built only when a namespaced call or
  // map/namespace accessor needs it.
  rulesets?: Map<string, Rule[]> | null;
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
function collectVars(statements: Statement[]): Map<string, ValueNode[]> | null {
  let map: Map<string, ValueNode[]> | null = null;
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
function asStacks(m: Map<string, ValueNode> | null): Map<string, ValueNode[]> | null {
  if (!m) return null;
  const out = new Map<string, ValueNode[]>();
  for (const [k, v] of m) out.set(k, [v]);
  return out;
}

// collect the rulesets defined directly in a scope, keyed by own-local
// selector string (namespace-path descent). Built lazily on first path lookup.
function collectRulesets(statements: Statement[]): Map<string, Rule[]> | null {
  let map: Map<string, Rule[]> | null = null;
  for (const s of statements) {
    if (s.type === 'Rule') {
      for (const c of s.selector.selectors) {
        const key = complexCanonical(c);
        const list = (map ??= new Map()).get(key);
        if (list) list.push(s);
        else map.set(key, [s]);
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
 * The nearest last-wins binding for `name` (top of the nearest non-empty stack).
 * Used by the detached-ruleset / namespace paths that need the CURRENT value node
 * (e.g. to test `.type === 'DetachedRuleset'`); it does not honor exclusion
 * because those callers resolve a name to a concrete ruleset binding, not a lazy
 * self-referential value. The regular value read uses `resolveVarRef` instead.
 */
function lookupVar(frame: Frame | null, name: string): ValueNode | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const stack = f.vars?.get(name);
    if (stack && stack.length > 0) {
      const hit = stack[stack.length - 1]!;
      // capture a detached ruleset's definition (home) frame on first use.
      if (hit.type === 'DetachedRuleset' && hit.defFrame === null) hit.defFrame = f;
      return hit;
    }
    if (f.fallback && !fb) fb = f.fallback;
  }
  if (fb) return lookupVar(fb, name);
  return undefined;
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
function resolveVarRef(frame: Frame | null, name: string, e: EvalCtx): { value: ValueNode; frame: Frame } | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const stack = f.vars?.get(name);
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const v = stack[i]!;
        if (!e.excluded.has(v)) return { value: v, frame: f };
      }
    }
    if (f.fallback && !fb) fb = f.fallback;
  }
  if (fb) return resolveVarRef(fb, name, e);
  return undefined;
}

/**
 * [resolver] Evaluate a resolved variable's value node while it is EXCLUDED for
 * the sync span of the eval — added before the (possibly recursive) evaluation
 * begins, removed the instant that call returns SYNCHRONOUSLY (the `finally` runs
 * on the sync return, NOT on a later promise settle — so accumulation is correct
 * down a sync descent, and two overlapping async reads of the same decl do not
 * falsely block each other). `run` returns whatever the caller's fold produces. */
function withExcluded<T>(e: EvalCtx, node: ValueNode, run: () => T): T {
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
  excluded: Set<ValueNode>;
  // [resolver] when true, a variable/lookup miss returns a sentinel instead of
  // throwing (`isdefined` / opt-in callers). Default (unset) is STRICT: miss
  // throws `ReferenceError`.
  optional?: boolean;
}

/** Force a computed `Value` to a typed object. A computed STRING carries no parse
 * tag → the evaluator sniffs (untagged fallback); a materialized object passes through. */
function force(e: EvalCtx, v: Value): ValueObj {
  if (!isLiteral(v)) return v;
  if (!e.ev) return { type: 'Keyword', text: v, bytes: v };
  return e.ev.materialize(v);
}

/** Materialize a leaf literal with its parse tag + optional pre-split fields
 *  (VALUE-LITERAL-TAG-SPEC). */
function forceLiteral(e: EvalCtx, bytes: string, tag: LiteralTag, lit?: LitFields): ValueObj {
  return e.ev ? e.ev.materialize(bytes, tag, lit) : { type: 'Keyword', text: bytes, bytes };
}

/**
 * TYPED fold: materialize a value node to a typed `ValueObj` for an OPERATED
 * / compared / typed-param position — sourcing the literal's TYPE from the parse
 * (the packed node's `Kind` / stamped `tag`), NOT by re-classifying bytes. A
 * `'Dimension'` node carries the parser's payload (`value`/`unit`) → built
 * directly, no re-parse. A `'Word'` leaf carries verbatim bytes PLUS the
 * producer's stamped `LIT_*` `tag` (spec §5): `materialize` reads it as a FIELD.
 * `tagForWord` is only a fallback for a genuinely-synthetic / untagged Word (no
 * `tag`) — never on the hot path for a parsed literal. Variable refs / parens are
 * transparent, threading the tag through.
 */
function evalTyped(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<ValueObj> {
  switch (node.type) {
    case 'Dimension':
      return { type: 'Dimension', number: node.value, unit: node.unit, bytes: `${node.value}${node.unit}` };
    case 'Word':
      // The producer stamps `tag` (+ pre-split `lit`); fall back to a byte sniff
      // only for an untagged/synthetic Word.
      return forceLiteral(e, node.text, node.tag ?? tagForWord(node.text), node.lit);
    case 'VarRef': {
      const hit = resolveVarRef(frame, node.name, e);
      if (!hit) return force(e, unresolvedRef(node.name, e));
      return withExcluded(e, hit.value, () => evalTyped(hit.value, hit.frame, e));
    }
    case 'Paren':
      return evalTyped(node.inner, frame, e);
    default:
      // Computed / joined shapes (Operation, FunctionCall, Concat, SpacedValue,
      // Interp, VarIndirect, MapAccessor, …): fold to a Value then force. A
      // computed string has no parse tag → the evaluator sniffs.
      return mapMaybe(evalValue(node, frame, e), (v) => force(e, v));
  }
}

/**
 * Fold a value AST node bottom-up to a typed `Value` (a bare-string literal
 * for the static ~98% case, or a materialized `ValueObj` for a computed
 * operation/function). Lifts to `MaybePromise` only when a function call returns
 * a genuine thenable.
 */
function evalValue(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  switch (node.type) {
    case 'Word':
      return literal(node.text);
    case 'Dimension':
      return literal(`${node.value}${node.unit}`);
    case 'VarRef': {
      const hit = resolveVarRef(frame, node.name, e);
      if (!hit) return unresolvedRef(node.name, e);
      return withExcluded(e, hit.value, () => evalValue(hit.value, hit.frame, e));
    }
    case 'Sequence':
      return joinBytes(node.parts, '', frame, e);
    case 'SpacedValue':
      return joinBytes(node.parts, ' ', frame, e);
    case 'Paren':
      // Transparent to computed bytes: a materialized (operated) inner strips the
      // paren (matching the legacy oracle); an un-forced literal keeps its parens.
      return mapMaybe(evalValue(node.inner, frame, e), (v) =>
        isLiteral(v) ? literal(`(${v})`) : v,
      );
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
      return combineAll([l, r], ([lv, rv]) => ev.operate(node.operator, lv, rv, e.modes));
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
        return withExcluded(e, hit.value, () => evalValue(hit.value, hit.frame, e));
      });
    }
    case 'MapAccessor':
      return evalMapAccessor(node, frame, e);
    case 'DetachedRuleset':
      // A detached ruleset is not byte-serializable in value position.
      throw new Error('detached ruleset used as a value (not called)');
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
  return combineAll(pieces, (strs) => literal(strs.join('')));
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
    if (s.type === 'Declaration') {
      const name = typeof s.name === 'string' ? s.name : evalBytesSync(s.name, frame, e);
      const entry: DeclEntry = { name, value: s.value, frame };
      byName.set(name, entry); // last-wins
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
  if (base.type === 'Word') {
    const sel = base.text;
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
  // A variable base bound to a detached ruleset → its body decls.
  if (base.type === 'VarRef') {
    const bound = lookupVar(frame, base.name);
    if (bound && bound.type === 'DetachedRuleset') {
      const def = (bound.defFrame as Frame | null) ?? frame;
      const bodyFrame: Frame = {
        parent: def,
        mixins: collectMixins(bound.body),
        vars: collectVars(bound.body),
      };
      return evalToDeclMap(bound.body, bodyFrame, e);
    }
    return null;
  }
  return null;
}

function evalMapAccessor(node: MapAccessor, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const map = resolveBaseDeclMap(node.base, frame, e);
  if (!map) throw new Error('map/namespace accessor: base not found');
  let matched: DeclEntry | undefined;
  if (node.keyIsProp) {
    const key = typeof node.key === 'number' ? String(node.key) : evalBytesSync(node.key, frame, e);
    matched = map.byName.get(key);
  } else {
    const idx = node.key as number;
    const i = idx < 0 ? map.list.length + idx : idx - 1; // 1-based; negative from end
    matched = map.list[i];
  }
  if (!matched) throw new Error('map/namespace accessor: property not found');
  return evalValue(matched.value, matched.frame, e);
}

/** Evaluate a function call: materialize the modeled arg list, then `ev.call`. */
function evalCall(node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const sep = node.modern ? ' ' : ',';
  if (!e.ev) {
    const items = node.args.map((a) => evalValue(a, frame, e));
    return combineAll(items, (vals) => {
      const inner = vals.map(emitValue).join(sep === ' ' ? ' ' : ', ');
      return literal(`${node.name}(${inner})`);
    });
  }
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

function parentToken(parents: string[]): string {
  return parents.length === 1 ? parents[0]! : `:is(${parents.join(', ')})`;
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

function composeOne(parent: string, child: Complex, frame: Frame | null, e: EvalCtx): string {
  const canon = resolveComplex(child, frame, e);
  if (complexHasAmpersand(child)) return canon.split('&').join(parent);
  return parent + ' ' + canon;
}

function compose(parents: string[], child: SelectorList, frame: Frame | null, e: EvalCtx): string[] {
  const token = parentToken(parents);
  const out: string[] = [];
  for (const c of child.selectors) out.push(composeOne(token, c, frame, e));
  return out;
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
function putValue(e: Emit, node: ValueNode, frame: Frame | null, positionNode?: Node, contIndent?: string, emitImportant?: boolean): string | null {
  const b = evalBytes(node, frame, e);
  const finish = (s: string): string => {
    const r = contIndent !== undefined ? reindentContinuations(s, contIndent) : s;
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
    optional: options?.optional ?? false, // [resolver] strict (default) vs optional miss
    pending: [], // async patches
    depth: 0, // [atrule]
    collapse: options?.collapseNesting !== false, // [nested/R0] default = flatten
    extends: computeExtends(root), // [extend] null when no `:extend()` anywhere
    hoistMode: false, // [extend]
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
  emitHoistedCharset(root.children, e);
  if (!e.collapse) {
    // [nested/R0] Less v5 default: preserve authored block structure. The root's
    // children are the top-level content level (indent 0).
    emitNestedBody(root.children, rootFrame, e);
  } else
  for (const child of root.children) {
    switch (child.type) {
      case 'Rule':
        flatten(child, null, rootFrame, e);
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
        expandCall(child, null, rootFrame, group, flush, e);
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
        expandDetachedCall(child, null, rootFrame, group, flush, e);
        flush();
        break;
      }
      case 'Declaration':
      case 'Comment':
        emitLeaf({ node: child, frame: rootFrame }, e);
        break;
      // [atrule] top-level at-rules
      case 'AtRuleBlock':
        emitAtRuleBlock(child, rootFrame, e);
        break;
      case 'AtRuleStatement':
        emitAtRuleStatement(child, e);
        break;
      // [import:inline] raw verbatim bytes spliced by `@import (inline)`.
      case 'RawInline':
        emitRawInline(child, e);
        break;
      // [import] an unresolved import the resolution pass left in place.
      case 'StyleImport':
        emitStyleImport(child, e);
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

function flatten(rule: Rule, parent: string[] | null, frame: Frame, e: Emit): void {
  const rawComposed =
    parent === null ? rootStrings(rule.selector, frame, e) : compose(parent, rule.selector, frame, e);
  // [extend] the rule's HEADER uses its fully-extended composed branches;
  // children still compose against the RAW composed selector and extend
  // independently (the composed model needs no parent-child override). Absent an
  // extend override the header is byte-identical to the no-extend serializer.
  const header = e.hoistMode
    ? e.extends?.hoistHeader.get(rule) ?? e.extends?.flatByRule.get(rule) ?? rawComposed
    : e.extends?.flatByRule.get(rule) ?? rawComposed;
  const childFrame: Frame = {
    parent: frame,
    mixins: collectMixins(rule.body),
    vars: collectVars(rule.body),
    statements: rule.body,
  };
  const group: Leaf[] = [];
  const flush = (): void => {
    if (group.length) {
      flushBlock(header, group, e, rule.selector);
      group.length = 0;
    }
  };
  walkBody(rule.body, rawComposed, childFrame, group, flush, e);
  flush();
}

/** Walk a body, expanding mixin calls inline against the shared canonical body. */
function walkBody(
  statements: Statement[],
  composed: string[] | null,
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  e: Emit,
  imp = false, // call-level !important override
): void {
  for (const node of statements) {
    switch (node.type) {
      case 'Declaration':
      case 'Comment':
        group.push(imp ? { node, frame, important: true } : { node, frame });
        break;
      case 'Rule':
        flush();
        // a null `composed` (top-level mixin/detached call) keeps nested
        // rules at the top level (own-strings), not composed against `[]`.
        flatten(node, composed, frame, e);
        break;
      case 'MixinCall':
        expandCall(node, composed, frame, group, flush, e, imp);
        break;
      case 'DetachedCall':
        expandDetachedCall(node, composed, frame, group, flush, e);
        break;
      // [atrule-bubbling] an at-rule nested inside a ruleset body PROJECTS to this
      // block level (flat mode already emits everything at `e.depth`), carrying the
      // enclosing composed selector as its body context so a bubbleable at-rule
      // wraps the ruleset's selector inside. The decl group flushes first so the
      // at-rule sits after the ruleset's own block, matching Less's bubbling order.
      case 'AtRuleBlock':
        flush();
        emitAtRuleBlock(node, frame, e, composed);
        break;
      case 'AtRuleStatement':
        flush();
        emitAtRuleStatement(node, e);
        break;
      // [import:inline] raw verbatim bytes spliced by `@import (inline)`.
      case 'RawInline':
        flush();
        emitRawInline(node, e);
        break;
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
  body: Map<string, ValueNode[]> | null,
): Map<string, ValueNode[]> | null {
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
 * Expand a mixin call: [guards] resolve the overloaded definitions that match
 * (arity + literal pattern + named/default params + guards), then WALK each
 * matching shared def body in place under the current composed selector. No
 * clone, no per-placement node build.
 */
function expandCall(
  call: MixinCall,
  composed: string[] | null,
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  e: Emit,
  imp = false,
): void {
  // a namespaced call (`#ns .a .b()`) descends a ruleset path first.
  const dispatchFrame = call.path.length > 0 ? descendNamespacePath(call.path, frame) : frame;
  if (dispatchFrame === null) return; // unknown namespace → nothing
  const candidates = lookupMixinCandidates(dispatchFrame, call.name);
  if (candidates.length === 0) return; // unknown mixin: minimal scope emits nothing
  const selected = dispatch(candidates, call, frame, e);
  const bodyImp = imp || call.important; // propagate call-level !important
  for (const { def, bindings } of selected) {
    captureArgDefFrames(bindings, frame); // detached-ruleset args: literal home
    const callFrame: Frame = {
      parent: dispatchFrame,
      mixins: collectMixins(def.body),
      vars: mergeVars(bindings, collectVars(def.body)),
      statements: def.body,
    };
    walkBody(def.body, composed, callFrame, group, flush, e, bodyImp);
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
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  e: Emit,
): void {
  const r = detachedCallFrame(call.varName, frame);
  if (!r) return;
  walkBody(r.dr.body, composed, r.callFrame, group, flush, e);
}

/**
 * [guards] Resolve the overloaded definitions that match a call. Args resolve to
 * BYTES in the caller frame (pattern-match); guard leaves compare TYPED values
 * in the callee frame through the injected `ValueEvaluator`.
 */
function dispatch(candidates: MixinDef[], call: MixinCall, frame: Frame, e: EvalCtx): Selection[] {
  const resolveCaller = makeResolver(frame, e);
  const makeCalleeTyped = (bindings: Map<string, ValueNode> | null): TypedResolver =>
    makeTypedResolver({ parent: frame, mixins: null, vars: asStacks(bindings) }, e);
  // an arg that is a variable bound to a detached ruleset must bind BY
  // REFERENCE (its body/closure survives); substitute the resolved node so the
  // eager byte-resolver never tries to serialize a ruleset as a value.
  const call2 = substituteDetachedVarArgs(call, frame);
  return selectDefinitions(candidates, call2, resolveCaller, makeCalleeTyped, e.ev, e.modes);
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

function flushBlock(sel: string[], group: Leaf[], e: Emit, selNode?: SelectorList): void {
  // [atrule] indent by the current block depth (0 at top level == prior behavior).
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (idt) put(e, idt);
  const selStart = e.off;
  put(e, idt ? sel.join(',\n' + idt) : sel.join(',\n'));
  if (e.positions && selNode) {
    e.positions.push({ node: selNode, type: selNode.type, start: selStart, end: e.off });
  }
  put(e, ' {\n');
  // a leaf group with any `+`/`+_` merge folds; otherwise the byte-identical
  // per-leaf path (zero-cost gate).
  if (groupHasMerge(group)) mergeFold(group, e, INDENT.repeat(e.depth + 1));
  else for (const leaf of group) emitLeaf(leaf, e);
  if (idt) put(e, idt);
  put(e, '}\n');
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
 * indentation of the enclosing block.
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
      if (i !== indices[indices.length - 1]) continue; // earlier members emit nothing
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
  if (e.positions) e.positions.push({ node: word(combined), type: 'Word', start, end: e.off });
}

function emitLeaf(leaf: Leaf, e: Emit): void {
  const { node, frame } = leaf;
  const start = e.off;
  // [atrule] a declaration/comment sits one level in from its container's depth.
  const idt = e.depth > 0 ? INDENT.repeat(e.depth + 1) : INDENT;
  if (node.type === 'Declaration') {
    put(e, idt);
    put(e, declName(node, frame, e)); // resolve interpolated property name
    put(e, ': ');
    const important = node.important === true || leaf.important === true;
    putValue(e, node.value, frame, node.value, idt + INDENT, important); // [whitespace] continuation indent
    if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
    put(e, ';\n');
  } else if (node.type === 'Comment') {
    put(e, idt);
    put(e, node.text);
    put(e, '\n');
    if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
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
function emitHoistedCharset(children: Statement[], e: Emit): void {
  for (const c of children) {
    if (c.type === 'AtRuleStatement' && isCharset(c as AtRuleStatement)) {
      emitAtRuleStatementRaw(c as AtRuleStatement, e);
      return;
    }
  }
}

function emitAtRuleStatement(node: AtRuleStatement, e: Emit): void {
  // [charset] Inline `@charset` occurrences are dropped; `serialize` hoists the
  // first to the document top (dedupe).
  if (isCharset(node)) return;
  emitAtRuleStatementRaw(node, e);
}

function emitAtRuleStatementRaw(node: AtRuleStatement, e: Emit): void {
  const start = e.off;
  if (e.depth > 0) put(e, INDENT.repeat(e.depth));
  put(e, node.name);
  if (node.prelude !== null) {
    const p = node.prelude.replace(/^\s+/u, '');
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
 */
function emitRawInline(node: RawInline, e: Emit): void {
  const start = e.off;
  put(e, node.text);
  put(e, '\n');
  if (e.positions) e.positions.push({ node, type: node.type, start, end: e.off });
}

/**
 * [import] Emit an UNRESOLVED `@import` verbatim. The import-resolution pass
 * normally replaces every `StyleImport` before serialize runs, so this reaches
 * the emitter only for a CSS-passthrough / deferred import the pass left in
 * place — where re-emitting the authored `@import …;` bytes is the correct output.
 */
function emitStyleImport(node: StyleImport, e: Emit): void {
  const start = e.off;
  put(e, node.raw);
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
  '@starting-style',
]);
function isBubbleable(name: string): boolean {
  return BUBBLEABLE_ATRULES.has(name.toLowerCase());
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
    const p = evalBytesSync(node.prelude, frame, e);
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
        flatten(node, null, frame, e);
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
        emitAtRuleStatement(node, e);
        e.depth--;
        break;
      case 'MixinCall':
        // Best-effort: expand into the direct-declaration group.
        expandCall(node, null, frame, group, flushDirect, e);
        break;
      case 'DetachedCall':
        expandDetachedCall(node, null, frame, group, flushDirect, e);
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
        flatten(node, ctx, frame, e);
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
        emitAtRuleStatement(node, e);
        e.depth--;
        break;
      case 'MixinCall':
        expandCall(node, ctx, frame, group, flushDirect, e);
        break;
      case 'DetachedCall':
        expandDetachedCall(node, ctx, frame, group, flushDirect, e);
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
      case 'AtRuleBlock':
        flushBuf();
        emitNestedAtRuleBlock(node, frame, e);
        break;
      case 'AtRuleStatement':
        flushBuf();
        emitAtRuleStatement(node, e);
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
  flatten(rule, null, frame, e);
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
    const p = evalBytesSync(node.prelude, frame, e);
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
  const ectx: EvalCtx = { ev: evaluator ?? null, modes: modes ?? DEFAULT_MODES, excluded: new Set() };

  const composeCount = (parents: string[], child: SelectorList, frame: Frame): string[] => {
    if (parents.length > 1) stats.selectorAllocs++; // the :is(...) wrap
    const token = parentToken(parents);
    const res: string[] = [];
    for (const c of child.selectors) {
      stats.composeOps++;
      stats.selectorAllocs++;
      const s = composeOne(token, c, frame, ectx);
      res.push(s);
      seen.add(s);
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
