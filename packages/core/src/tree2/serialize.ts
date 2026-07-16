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
import type { ValueService } from './value-service.js';
import { selectDefinitions } from './mixin-dispatch.js'; // [guards]
import type { ValueResolver } from './guard.js'; // [guards]
import { computeExtends, type ExtendResults } from './extend.js'; // [extend]

export interface Position {
  node: Node;
  kind: Kind;
  start: number;
  end: number;
}

export interface SerializeOptions {
  trackPositions?: boolean;
  /**
   * Injected value-eval service (the boundary-safe seam). When present, tree2's
   * `Operation` / `FunctionCall` value nodes are COMPUTED through it; when
   * absent they fall back to un-evaluated source assembly (tree2 does no math
   * itself). tree2 depends only on the `ValueService` interface.
   */
  valueService?: ValueService;
  /**
   * [guards] `'record'` makes mixin dispatch walk EVERY arity/pattern candidate
   * (ignoring guard truth) and evaluate every guard leaf, so an async
   * value-service pre-pass collects a complete key set. Default `'eval'` does
   * real guard-based selection.
   */
  guardMode?: 'eval' | 'record';
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
 * [guards] A value resolver bound to a frame — resolves a value node to its
 * (variable-resolved) byte source. Used by mixin dispatch to eagerly resolve
 * args in the caller frame and to resolve guard operands in the callee frame.
 */
function makeResolver(frame: Frame | null, service: ValueService | null): ValueResolver {
  return (v: ValueNode) => valueText(v, frame, service);
}

/* ----------------------------------------------------------- value bytes */

const MAX_VAR_DEPTH = 64;

function valueText(
  node: ValueNode,
  frame: Frame | null,
  service: ValueService | null,
  depth = 0,
): string {
  switch (node.kind) {
    case Kind.Word:
      return node.text;
    case Kind.Dimension:
      return `${node.value}${node.unit}`;
    case Kind.VarRef: {
      if (depth > MAX_VAR_DEPTH) return `@${node.name}`; // cycle guard
      const bound = lookupVar(frame, node.name);
      // Unbound: emit the byte form so the output visibly diverges rather than
      // silently dropping (a real fixture that reaches here needs another rung).
      return bound ? valueText(bound, frame, service, depth + 1) : `@${node.name}`;
    }
    case Kind.Concat: {
      let out = '';
      for (const part of node.parts) out += valueText(part, frame, service, depth);
      return out;
    }
    case Kind.SpacedValue: {
      const parts = node.parts;
      let out = parts.length > 0 ? valueText(parts[0]!, frame, service, depth) : '';
      for (let i = 1; i < parts.length; i++) out += ' ' + valueText(parts[i]!, frame, service, depth);
      return out;
    }
    case Kind.Paren: {
      // Transparent to computed bytes: a parenthesized operation is evaluated by
      // the service (which strips the paren), matching the legacy oracle. With
      // no service, keep the parens for faithful un-evaluated source.
      const inner = valueText(node.inner, frame, service, depth);
      return service ? inner : `(${inner})`;
    }
    case Kind.Operation: {
      // Operands are serialized to their UN-EVALUATED, variable-resolved SOURCE
      // (null service): only the OUTERMOST computed node in an emitted value
      // calls the service, handing it the full (possibly nested) expression
      // source. That keeps the service call site deterministic (a nested op is
      // never separately computed), so precedence is carried by the source and
      // the record/replay key is identical across passes.
      const left = valueText(node.left, frame, null, depth);
      const right = valueText(node.right, frame, null, depth);
      return service
        ? service.evaluateOperation(node.operator, left, right)
        : `${left} ${node.operator} ${right}`;
    }
    case Kind.FunctionCall: {
      // `args` serializes to the (variable-resolved) inner argument SOURCE; the
      // service performs the call and returns computed bytes.
      const args = valueText(node.args, frame, null, depth);
      return service ? service.callFunction(node.name, args) : `${node.name}(${args})`;
    }
  }
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

interface Emit {
  chunks: string[];
  off: number;
  positions: Position[] | null;
  service: ValueService | null;
  // [atrule] current block-nesting depth (0 = top level). At-rule bodies raise it
  // so declarations/selectors inside a block indent one level deeper.
  depth: number;
  record: boolean; // [guards] record mode for the async value-service pre-pass
  // [guards] mixin-expansion depth (bounds record-mode recursion). Kept SEPARATE
  // from `depth` above: mixin expansion must not shift at-rule indentation.
  recordDepth: number;
  // [nested/R0] false => preserve authored nesting (Less v5 default); true =>
  // flatten to composed selector strings (4.x / collapseNesting:true).
  collapse: boolean;
  // [extend] per-rule extend overrides, or null when the document has no
  // `:extend()` (zero-cost gate: emit is byte-identical to the no-extend path).
  extends: ExtendResults | null;
}

/* ------------------------------------------------------------- [extend] */


// [guards] Record mode walks EVERY candidate body ignoring guard truth, so
// guard-terminated recursion (e.g. `.loop(@n) when (@n>0){ .loop(@n - 1) }`)
// would not terminate. A generous depth cap bounds it; the eval path is
// unbounded and terminates naturally via guards.
const MAX_RECORD_DEPTH = 64;

function put(e: Emit, s: string): void {
  e.chunks.push(s);
  if (e.positions) e.off += s.length;
}

/** A grouped leaf (declaration/comment) plus the frame its values resolve in. */
interface Leaf {
  node: Statement;
  frame: Frame | null;
}

export function serialize(root: Root, options?: SerializeOptions): SerializeResult {
  const e: Emit = {
    chunks: [],
    off: 0,
    positions: options?.trackPositions ? [] : null,
    service: options?.valueService ?? null,
    depth: 0, // [atrule]
    record: options?.guardMode === 'record', // [guards]
    recordDepth: 0, // [guards]
    collapse: options?.collapseNesting !== false, // [nested/R0] default = flatten
    extends: computeExtends(root), // [extend] null when no `:extend()` anywhere
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
  return e.positions ? { css: e.chunks.join(''), positions: e.positions } : { css: e.chunks.join('') };
}

function flatten(rule: Rule, parent: string[] | null, frame: Frame, e: Emit): void {
  const rawComposed = parent === null ? ownStrings(rule.selector) : compose(parent, rule.selector);
  // [extend] the rule's HEADER uses its fully-extended composed branches;
  // children still compose against the RAW composed selector and extend
  // independently (the composed model needs no parent-child override). Absent an
  // extend override the header is byte-identical to the no-extend serializer.
  const header = e.extends?.flatByRule.get(rule) ?? rawComposed;
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
  if (e.record && e.recordDepth >= MAX_RECORD_DEPTH) return; // [guards] bound recording
  const resolveCaller = makeResolver(frame, e.service);
  // Guard operands resolve in the CALLEE scope (params bound + globals via the
  // caller-frame parent chain).
  const makeCalleeResolver = (bindings: Map<string, ValueNode> | null): ValueResolver =>
    makeResolver({ parent: frame, mixins: null, vars: bindings }, e.service);
  const selected = selectDefinitions(
    candidates,
    call,
    resolveCaller,
    makeCalleeResolver,
    e.service,
    e.record,
  );
  e.recordDepth++; // [guards]
  for (const { def, bindings } of selected) {
    const callFrame: Frame = {
      parent: frame,
      mixins: collectMixins(def.body),
      vars: mergeVars(bindings, collectVars(def.body)),
    };
    walkBody(def.body, composed ?? [], callFrame, group, flush, e);
  }
  e.recordDepth--; // [guards]
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
    const valStart = e.off;
    put(e, valueText(node.value, frame, e.service));
    if (e.positions) {
      e.positions.push({ node: node.value, kind: node.value.kind, start: valStart, end: e.off });
      e.positions.push({ node, kind: node.kind, start, end: e.off });
    }
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
    const p = valueText(node.prelude, frame, e.service);
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
function emitNestedBody(statements: Statement[], frame: Frame, e: Emit): void {
  for (const node of statements) {
    switch (node.kind) {
      case Kind.Declaration:
      case Kind.Comment:
        emitNestedLeaf({ node, frame }, e);
        break;
      case Kind.Rule:
        emitNestedRule(node, frame, e);
        break;
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
    put(e, valueText(node.value, frame, e.service));
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
  const markChunks = e.chunks.length;
  const markOff = e.off;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (idt) put(e, idt);
  // [extend] nested header uses the extended own-local branch list; children
  // stay literal (nested mode composes nothing).
  const ext = e.extends?.nestedByRule.get(rule);
  const own = ext ? ext.map((b) => b.text) : ownStrings(rule.selector);
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
  e.depth++;
  emitNestedBody(rule.body, childFrame, e);
  e.depth--;
  if (e.chunks.length === afterHeader) {
    // Nothing emitted: drop the whole rule (rewind chunks/offset/positions).
    e.chunks.length = markChunks;
    e.off = markOff;
    if (e.positions) e.positions.length = markPos;
    return;
  }
  if (idt) put(e, idt);
  put(e, '}\n');
  if (e.positions) e.positions.push({ node: rule, kind: rule.kind, start, end: e.off });
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
  if (e.record && e.recordDepth >= MAX_RECORD_DEPTH) return; // [guards]
  const resolveCaller = makeResolver(frame, e.service);
  const makeCalleeResolver = (bindings: Map<string, ValueNode> | null): ValueResolver =>
    makeResolver({ parent: frame, mixins: null, vars: bindings }, e.service);
  const selected = selectDefinitions(
    candidates,
    call,
    resolveCaller,
    makeCalleeResolver,
    e.service,
    e.record,
  );
  e.recordDepth++;
  for (const { def, bindings } of selected) {
    const callFrame: Frame = {
      parent: frame,
      mixins: collectMixins(def.body),
      vars: mergeVars(bindings, collectVars(def.body)),
    };
    emitNestedBody(def.body, callFrame, e);
  }
  e.recordDepth--;
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
    const p = valueText(node.prelude, frame, e.service);
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
export function composeStats(root: Root, service?: ValueService): ComposeStats {
  const stats: ComposeStats = { composeOps: 0, selectorAllocs: 0, distinctSelectors: 0 };
  const seen = new Set<string>();
  const svc = service ?? null;

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
        const resolveCaller = makeResolver(frame, svc);
        const makeCalleeResolver = (b: Map<string, ValueNode> | null): ValueResolver =>
          makeResolver({ parent: frame, mixins: null, vars: b }, svc);
        for (const { def, bindings } of selectDefinitions(
          candidates,
          node,
          resolveCaller,
          makeCalleeResolver,
          svc,
          false,
        )) {
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
