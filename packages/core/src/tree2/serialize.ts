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

import { Kind, Node } from './node.js';
import { Word } from './nodes.js';
import type {
  Complex,
  FunctionCall,
  MixinCall,
  MixinDef,
  Root,
  Rule,
  SelectorList,
  Statement,
  ValueNode,
} from './nodes.js';
// [atrule] block + statement at-rule node types
import type { AtRuleBlock, AtRuleStatement } from './at-rule.js';
// [R2] typed synchronous value evaluator seam + boundary-clean value domain.
import {
  DEFAULT_MODES,
  emitValue,
  isLiteral,
  literal,
  type EvalModes,
  type ListVal,
  type Value,
  type ValueEvaluator,
  type ValueObj,
} from './value-eval.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { selectDefinitions, type Selection } from './mixin-dispatch.js'; // [guards]
import type { ValueResolver, TypedResolver } from './guard.js'; // [guards]
import { computeExtends, type ExtendResults } from './extend.js'; // [extend]

/* ---------------------------------------------------- [R2] MaybePromise glue */

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
  kind: Kind;
  start: number;
  end: number;
}

export interface SerializeOptions {
  trackPositions?: boolean;
  /**
   * [R2] Injected TYPED synchronous value evaluator (the boundary-safe seam).
   * When present, tree2's `Operation` / `FunctionCall` value nodes are COMPUTED
   * through it over materialized typed value objects; when absent they fall back
   * to un-evaluated source assembly (tree2 does no math itself). tree2 depends
   * only on the `ValueEvaluator` interface.
   */
  evaluator?: ValueEvaluator;
  /** [R2] Configured math/unit/function modes (defaults to `DEFAULT_MODES`). */
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
}

export interface SerializeResult {
  css: string;
  /** Present only when `trackPositions` is set. */
  positions?: Position[];
}

/**
 * [R2] `serialize` stays SYNCHRONOUS for all-sync value graphs and lifts to
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
interface Frame {
  parent: Frame | null;
  // [guards] a name maps to ALL same-name defs (overloads), in definition order.
  mixins: Map<string, MixinDef[]> | null;
  vars: Map<string, ValueNode> | null;
}

// [guards] collect ALL definitions per name (overloaded dispatch), not last-wins.
function collectMixins(statements: Statement[]): Map<string, MixinDef[]> | null {
  let map: Map<string, MixinDef[]> | null = null;
  for (const s of statements) {
    if (s.kind === Kind.MixinDef) {
      const list = (map ??= new Map()).get(s.name);
      if (list) list.push(s);
      else map.set(s.name, [s]);
    }
  }
  return map;
}

/**
 * Collect variable declarations in a scope. Less variable semantics: LAST-wins
 * within a scope (a later `@x` overrides an earlier one) and LAZY (a reference
 * can resolve a variable declared textually later in the same scope). Building
 * the whole scope's var map up-front — before any value is emitted — gives both
 * for free: `set` overwrites (last-wins) and the map is complete before use.
 */
function collectVars(statements: Statement[]): Map<string, ValueNode> | null {
  let map: Map<string, ValueNode> | null = null;
  for (const s of statements) {
    if (s.kind === Kind.VarDeclaration) {
      (map ??= new Map()).set(s.name, s.value);
    }
  }
  return map;
}

// [guards] collect every visible same-name def up the scope chain (nearest
// scope first), so overload resolution sees all candidates.
function lookupMixinCandidates(frame: Frame | null, name: string): MixinDef[] {
  let out: MixinDef[] | null = null;
  for (let f = frame; f; f = f.parent) {
    const hit = f.mixins?.get(name);
    if (hit) {
      if (!out) out = hit.slice();
      else out.push(...hit);
    }
  }
  return out ?? [];
}

function lookupVar(frame: Frame | null, name: string): ValueNode | undefined {
  for (let f = frame; f; f = f.parent) {
    const hit = f.vars?.get(name);
    if (hit) return hit;
  }
  return undefined;
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
    const val = evalValue(v, frame, e);
    if (isThenable(val)) throw new Error('async value in a synchronous guard position');
    return force(e, val);
  };
}

/* ---------------------------------------------------- [R2] typed value eval */

const MAX_VAR_DEPTH = 64;

/** The evaluator + modes carried through the value lane (a slim view of Emit). */
interface EvalCtx {
  ev: ValueEvaluator | null;
  modes: EvalModes;
}

/** Force a lazy leaf to a typed value object (idempotent). */
function force(e: EvalCtx, v: Value): ValueObj {
  if (!isLiteral(v)) return v;
  if (!e.ev) return { kind: 'keyword', text: v.bytes, bytes: v.bytes };
  return e.ev.materialize(v);
}

/**
 * [R2] Fold a value AST node bottom-up to a typed `Value` (a lazy `ValueLiteral`
 * for the static ~98% case, or a materialized `ValueObj` for a computed
 * operation/function). Lifts to `MaybePromise` only when a function call returns
 * a genuine thenable.
 */
function evalValue(node: ValueNode, frame: Frame | null, e: EvalCtx, depth = 0): MaybePromise<Value> {
  switch (node.kind) {
    case Kind.Word:
      return literal(node.text);
    case Kind.Dimension:
      return literal(`${node.value}${node.unit}`, 'numeric');
    case Kind.VarRef: {
      if (depth > MAX_VAR_DEPTH) return literal(`@${node.name}`); // cycle guard
      const bound = lookupVar(frame, node.name);
      return bound ? evalValue(bound, frame, e, depth + 1) : literal(`@${node.name}`);
    }
    case Kind.Concat:
      return joinBytes(node.parts, '', frame, e, depth);
    case Kind.SpacedValue:
      return joinBytes(node.parts, ' ', frame, e, depth);
    case Kind.Paren:
      // Transparent to computed bytes: a materialized (operated) inner strips the
      // paren (matching the legacy oracle); an un-forced literal keeps its parens.
      return mapMaybe(evalValue(node.inner, frame, e, depth), (v) =>
        isLiteral(v) ? literal(`(${v.bytes})`) : v,
      );
    case Kind.Operation: {
      const l = evalValue(node.left, frame, e, depth);
      const r = evalValue(node.right, frame, e, depth);
      if (!e.ev) {
        // Fallback: un-evaluated, variable-resolved source assembly (no math).
        return combineAll([l, r], ([lv, rv]) =>
          literal(`${emitValue(lv)} ${node.operator} ${emitValue(rv)}`),
        );
      }
      const ev = e.ev;
      return combineAll([l, r], ([lv, rv]) => ev.operate(node.operator, force(e, lv), force(e, rv), e.modes));
    }
    case Kind.FunctionCall:
      return evalCall(node, frame, e, depth);
  }
}

/** Evaluate a function call: materialize the modeled arg list, then `ev.call`. */
function evalCall(node: FunctionCall, frame: Frame | null, e: EvalCtx, depth: number): MaybePromise<Value> {
  const items = node.args.map((a) => evalValue(a, frame, e, depth));
  const sep = node.modern ? ' ' : ',';
  if (!e.ev) {
    return combineAll(items, (vals) => {
      const inner = vals.map(emitValue).join(sep === ' ' ? ' ' : ', ');
      return literal(`${node.name}(${inner})`);
    });
  }
  const ev = e.ev;
  return combineAll(items, (vals) => {
    const list: ListVal = {
      kind: 'list',
      items: vals.map((v) => force(e, v)),
      sep,
      bytes: '',
    };
    return ev.call(node.name, list, e.modes);
  });
}

/** Join value parts to bytes (Concat = '', SpacedValue = ' '); stays a literal. */
function joinBytes(
  parts: ValueNode[],
  sep: string,
  frame: Frame | null,
  e: EvalCtx,
  depth: number,
): MaybePromise<Value> {
  const items = parts.map((p) => evalValue(p, frame, e, depth));
  return combineAll(items, (vals) => literal(vals.map(emitValue).join(sep)));
}

/** Fold a value node and return its emitted bytes. */
function evalBytes(node: ValueNode, frame: Frame | null, e: EvalCtx, depth = 0): MaybePromise<string> {
  return mapMaybe(evalValue(node, frame, e, depth), emitValue);
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

function composeOne(parent: string, child: Complex): string {
  const canon = child.canonical();
  if (child.hasAmpersand) return canon.split('&').join(parent);
  return parent + ' ' + canon;
}

function compose(parents: string[], child: SelectorList): string[] {
  const token = parentToken(parents);
  const out: string[] = [];
  for (const c of child.selectors) out.push(composeOne(token, c));
  return out;
}

function ownStrings(list: SelectorList): string[] {
  const out: string[] = [];
  for (const c of list.selectors) out.push(c.canonical());
  return out;
}

/* ------------------------------------------------------------- emit engine */

interface Emit extends EvalCtx {
  chunks: string[];
  off: number;
  positions: Position[] | null;
  // [R2] typed value evaluator + configured modes (from EvalCtx: `ev`, `modes`).
  // [R2] async patches: a leaf whose value forced an async built-in reserves a
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

/** [R2] Emit a value at a leaf/prelude site: sync `put`, or reserve an async slot. */
function putValue(e: Emit, node: ValueNode, frame: Frame | null, positionNode?: Node): void {
  const b = evalBytes(node, frame, e);
  if (isThenable(b)) {
    const i = e.chunks.length;
    e.chunks.push('');
    e.pending.push({ i, p: Promise.resolve(b) });
    return;
  }
  const valStart = e.off;
  put(e, b);
  if (e.positions && positionNode) {
    e.positions.push({ node: positionNode, kind: positionNode.kind, start: valStart, end: e.off });
  }
}

/* ------------------------------------------------------------- [extend] */

function put(e: Emit, s: string): void {
  e.chunks.push(s);
  if (e.positions) e.off += s.length;
}

/** A grouped leaf (declaration/comment) plus the frame its values resolve in. */
interface Leaf {
  node: Statement;
  frame: Frame | null;
}

export function serialize(root: Root, options?: SerializeOptions): SerializeReturn {
  const e: Emit = {
    chunks: [],
    off: 0,
    positions: options?.trackPositions ? [] : null,
    ev: options?.evaluator ?? null, // [R2] typed value evaluator
    modes: options?.modes ?? DEFAULT_MODES, // [R2]
    pending: [], // [R2] async patches
    depth: 0, // [atrule]
    collapse: options?.collapseNesting !== false, // [nested/R0] default = flatten
    extends: computeExtends(root), // [extend] null when no `:extend()` anywhere
    hoistMode: false, // [extend]
  };
  const rootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.children),
    vars: collectVars(root.children),
  };
  const start = e.off;
  if (!e.collapse) {
    // [nested/R0] Less v5 default: preserve authored block structure. The root's
    // children are the top-level content level (indent 0).
    emitNestedBody(root.children, rootFrame, e);
  } else
  for (const child of root.children) {
    switch (child.kind) {
      case Kind.Rule:
        flatten(child, null, rootFrame, e);
        break;
      case Kind.MixinDef:
      case Kind.VarDeclaration:
        break; // definitions emit nothing
      case Kind.MixinCall: {
        const group: Leaf[] = [];
        expandCall(child, null, rootFrame, group, () => flushBlock([], group, e), e);
        break;
      }
      case Kind.Declaration:
      case Kind.Comment:
        emitLeaf({ node: child, frame: rootFrame }, e);
        break;
      // [atrule] top-level at-rules
      case Kind.AtRuleBlock:
        emitAtRuleBlock(child, rootFrame, e);
        break;
      case Kind.AtRuleStatement:
        emitAtRuleStatement(child, e);
        break;
    }
  }
  if (e.positions) e.positions.push({ node: root, kind: root.kind, start, end: e.off });
  const finalize = (): SerializeResult =>
    e.positions ? { css: e.chunks.join(''), positions: e.positions } : { css: e.chunks.join('') };
  // [R2] lift to async ONLY if a genuinely-async built-in reserved a placeholder.
  if (e.pending.length > 0) {
    return Promise.all(
      e.pending.map((x) => x.p.then((b) => { e.chunks[x.i] = b; })),
    ).then(finalize);
  }
  return finalize();
}

function flatten(rule: Rule, parent: string[] | null, frame: Frame, e: Emit): void {
  const rawComposed = parent === null ? ownStrings(rule.selector) : compose(parent, rule.selector);
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
  composed: string[],
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  e: Emit,
): void {
  for (const node of statements) {
    switch (node.kind) {
      case Kind.Declaration:
      case Kind.Comment:
        group.push({ node, frame });
        break;
      case Kind.Rule:
        flush();
        flatten(node, composed, frame, e);
        break;
      case Kind.MixinCall:
        expandCall(node, composed, frame, group, flush, e);
        break;
      // [atrule] at-rule nested directly inside a ruleset body. Full v5 bubbling
      // (hoist the at-rule to root, move the selector inside) is a deferred rung;
      // the bridge rejects this shape, so this is a best-effort fallback only.
      case Kind.AtRuleBlock:
        flush();
        emitAtRuleBlock(node, frame, e);
        break;
      case Kind.AtRuleStatement:
        flush();
        emitAtRuleStatement(node, e);
        break;
      case Kind.MixinDef:
      case Kind.VarDeclaration:
        break;
    }
  }
}

/** Merge param bindings and body-local vars into one frame map (params first). */
function mergeVars(
  a: Map<string, ValueNode> | null,
  b: Map<string, ValueNode> | null,
): Map<string, ValueNode> | null {
  if (!a) return b;
  if (!b) return a;
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, v);
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
): void {
  const candidates = lookupMixinCandidates(frame, call.name);
  if (candidates.length === 0) return; // unknown mixin: minimal scope emits nothing
  const selected = dispatch(candidates, call, frame, e);
  for (const { def, bindings } of selected) {
    const callFrame: Frame = {
      parent: frame,
      mixins: collectMixins(def.body),
      vars: mergeVars(bindings, collectVars(def.body)),
    };
    walkBody(def.body, composed ?? [], callFrame, group, flush, e);
  }
}

/**
 * [guards] Resolve the overloaded definitions that match a call. Args resolve to
 * BYTES in the caller frame (pattern-match); guard leaves compare TYPED values
 * in the callee frame through the injected `ValueEvaluator`.
 */
function dispatch(candidates: MixinDef[], call: MixinCall, frame: Frame, e: EvalCtx): Selection[] {
  const resolveCaller = makeResolver(frame, e);
  const makeCalleeTyped = (bindings: Map<string, ValueNode> | null): TypedResolver =>
    makeTypedResolver({ parent: frame, mixins: null, vars: bindings }, e);
  return selectDefinitions(candidates, call, resolveCaller, makeCalleeTyped, e.ev, e.modes);
}

function flushBlock(sel: string[], group: Leaf[], e: Emit, selNode?: SelectorList): void {
  // [atrule] indent by the current block depth (0 at top level == prior behavior).
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (idt) put(e, idt);
  const selStart = e.off;
  put(e, idt ? sel.join(',\n' + idt) : sel.join(',\n'));
  if (e.positions && selNode) {
    e.positions.push({ node: selNode, kind: selNode.kind, start: selStart, end: e.off });
  }
  put(e, ' {\n');
  for (const leaf of group) emitLeaf(leaf, e);
  if (idt) put(e, idt);
  put(e, '}\n');
}

function emitLeaf(leaf: Leaf, e: Emit): void {
  const { node, frame } = leaf;
  const start = e.off;
  // [atrule] a declaration/comment sits one level in from its container's depth.
  const idt = e.depth > 0 ? INDENT.repeat(e.depth + 1) : INDENT;
  if (node.kind === Kind.Declaration) {
    put(e, idt);
    put(e, node.name);
    put(e, ': ');
    putValue(e, node.value, frame, node.value);
    if (e.positions) e.positions.push({ node, kind: node.kind, start, end: e.off });
    put(e, ';\n');
  } else if (node.kind === Kind.Comment) {
    put(e, idt);
    put(e, node.text);
    put(e, '\n');
    if (e.positions) e.positions.push({ node, kind: node.kind, start, end: e.off });
  }
}

/* ------------------------------------------------------------ [atrule] emit */

/** A statement at-rule: `@name prelude;` with prelude bytes kept literal. */
function emitAtRuleStatement(node: AtRuleStatement, e: Emit): void {
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
  if (e.positions) e.positions.push({ node, kind: node.kind, start, end: e.off });
}

/**
 * A block at-rule: `@name prelude { …body }`. The body is a fresh nesting
 * context (parent selector resets to none) whose direct declarations emit one
 * level in and whose nested rulesets/at-rules descend a further level. An at-rule
 * whose body renders empty is dropped entirely (header + braces), matching v5.
 */
function emitAtRuleBlock(node: AtRuleBlock, frame: Frame, e: Emit): void {
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
  };
  emitAtRuleBody(node.body, bodyFrame, e);
  if (e.chunks.length === afterHeader) {
    // Nothing emitted: drop the whole at-rule (rewind chunks/offset/positions).
    e.chunks.length = markChunks;
    e.off = markOff;
    if (e.positions) e.positions.length = markPos;
    return;
  }
  if (idt) put(e, idt);
  put(e, '}\n');
  if (e.positions) e.positions.push({ node, kind: node.kind, start, end: e.off });
}

/**
 * Emit an at-rule body. Consecutive declarations/comments group as DIRECT block
 * children (no selector wrapper). A nested ruleset / at-rule descends one level.
 */
function emitAtRuleBody(statements: Statement[], frame: Frame, e: Emit): void {
  const group: Leaf[] = [];
  const flushDirect = (): void => {
    if (group.length > 0) {
      for (const leaf of group) emitLeaf(leaf, e);
      group.length = 0;
    }
  };
  for (const node of statements) {
    switch (node.kind) {
      case Kind.Declaration:
      case Kind.Comment:
        group.push({ node, frame });
        break;
      case Kind.Rule:
        flushDirect();
        e.depth++;
        flatten(node, null, frame, e);
        e.depth--;
        break;
      case Kind.AtRuleBlock:
        flushDirect();
        e.depth++;
        emitAtRuleBlock(node, frame, e);
        e.depth--;
        break;
      case Kind.AtRuleStatement:
        flushDirect();
        e.depth++;
        emitAtRuleStatement(node, e);
        e.depth--;
        break;
      case Kind.MixinCall:
        // Best-effort: expand into the direct-declaration group.
        expandCall(node, null, frame, group, flushDirect, e);
        break;
      case Kind.MixinDef:
      case Kind.VarDeclaration:
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
  for (const node of statements) {
    switch (node.kind) {
      case Kind.Declaration:
      case Kind.Comment:
        emitNestedLeaf({ node, frame }, e);
        break;
      case Kind.Rule: {
        // [extend] a rule whose extend match crosses the `&` FLATTENS: defer it to
        // the enclosing rule's hoist queue (emitted flat at that rule's depth).
        if (hoist && e.extends?.nestedPlan.get(node)?.flatten) {
          hoist.push({ rule: node, frame });
          break;
        }
        emitNestedRule(node, frame, e);
        break;
      }
      case Kind.MixinCall:
        expandNestedCall(node, frame, e);
        break;
      case Kind.AtRuleBlock:
        emitNestedAtRuleBlock(node, frame, e);
        break;
      case Kind.AtRuleStatement:
        emitAtRuleStatement(node, e);
        break;
      case Kind.MixinDef:
      case Kind.VarDeclaration:
        break; // definitions emit nothing
    }
  }
}

/** A `name: value;` / comment leaf at exactly the current `e.depth` level. */
function emitNestedLeaf(leaf: Leaf, e: Emit): void {
  const { node, frame } = leaf;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (node.kind === Kind.Declaration) {
    if (idt) put(e, idt);
    put(e, node.name);
    put(e, ': ');
    const valStart = e.off;
    putValue(e, node.value, frame, node.value);
    if (e.positions) {
      e.positions.push({ node: node.value, kind: node.value.kind, start: valStart, end: e.off });
      e.positions.push({ node, kind: node.kind, start, end: e.off });
    }
    put(e, ';\n');
  } else if (node.kind === Kind.Comment) {
    if (idt) put(e, idt);
    put(e, node.text);
    put(e, '\n');
    if (e.positions) e.positions.push({ node, kind: node.kind, start, end: e.off });
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
  const own = plan ? plan.header : ownStrings(rule.selector);
  const selStart = e.off;
  put(e, idt ? own.join(',\n' + idt) : own.join(',\n'));
  if (e.positions) {
    e.positions.push({ node: rule.selector, kind: rule.selector.kind, start: selStart, end: e.off });
  }
  put(e, ' {\n');
  const afterHeader = e.chunks.length;
  const childFrame: Frame = {
    parent: frame,
    mixins: collectMixins(rule.body),
    vars: collectVars(rule.body),
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
    if (e.positions) e.positions.push({ node: rule, kind: rule.kind, start, end: e.off });
  }
  // [extend] split-out exact extenders (target has surviving nested children):
  // sibling rules carrying only the target's DIRECT declarations (empty → drop).
  if (plan && plan.splits.length > 0) {
    const direct: Leaf[] = [];
    for (const st of rule.body) {
      if (st.kind === Kind.Declaration || st.kind === Kind.Comment) {
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
  const candidates = lookupMixinCandidates(frame, call.name);
  if (candidates.length === 0) return;
  const selected = dispatch(candidates, call, frame, e);
  for (const { def, bindings } of selected) {
    const callFrame: Frame = {
      parent: frame,
      mixins: collectMixins(def.body),
      vars: mergeVars(bindings, collectVars(def.body)),
    };
    emitNestedBody(def.body, callFrame, e);
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
  if (e.positions) e.positions.push({ node, kind: node.kind, start, end: e.off });
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
  const ectx: EvalCtx = { ev: evaluator ?? null, modes: modes ?? DEFAULT_MODES };

  const composeCount = (parents: string[], child: SelectorList): string[] => {
    if (parents.length > 1) stats.selectorAllocs++; // the :is(...) wrap
    const token = parentToken(parents);
    const res: string[] = [];
    for (const c of child.selectors) {
      stats.composeOps++;
      stats.selectorAllocs++;
      const s = composeOne(token, c);
      res.push(s);
      seen.add(s);
    }
    return res;
  };

  const walk = (statements: Statement[], composed: string[], frame: Frame): void => {
    for (const node of statements) {
      if (node.kind === Kind.Rule) {
        walkRule(node, composed, frame);
      } else if (node.kind === Kind.MixinCall) {
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
      } else if (node.kind === Kind.AtRuleBlock) {
        // [atrule] an at-rule body is a fresh nesting context (see enterAtRule).
        enterAtRule(node, frame);
      }
    }
  };
  const walkRule = (rule: Rule, parent: string[] | null, frame: Frame): void => {
    const composed = parent === null ? ownStrings(rule.selector) : composeCount(parent, rule.selector);
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
      if (child.kind === Kind.Rule) walkRule(child, null, bodyFrame);
      else if (child.kind === Kind.MixinCall) walk([child], [], bodyFrame);
      else if (child.kind === Kind.AtRuleBlock) enterAtRule(child, bodyFrame);
    }
  };

  const rootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.children),
    vars: collectVars(root.children),
  };
  for (const child of root.children) {
    if (child.kind === Kind.Rule) walkRule(child, null, rootFrame);
    else if (child.kind === Kind.AtRuleBlock) enterAtRule(child, rootFrame);
  }
  stats.distinctSelectors = seen.size;
  return stats;
}
