import type { Node } from './tree/node-base.js';

/**
 * Per-node field overrides stored in a session.
 * Keys are field names; values are the overridden values.
 */
export type NodePatch = Record<string, unknown>;

/**
 * Per-node runtime bookkeeping that differs between sessions.
 * These are the fields that today live directly on the node
 * and get cloned to isolate concurrent evaluations.
 */
export interface RuntimeState {
  parent?: Node;
  index?: number;
  evaluated?: boolean;
  preEvaluated?: boolean;
  sourceNode?: Node;
}

/**
 * Captured scope state for re-evaluation in a session.
 * Tracks variable/mixin overrides injected via with/set
 * or changed by ambient scope differences.
 */
export interface ScopeSnapshot {
  /** Variable overrides (name → value node) */
  variables: Map<string, Node>;
  /** Mixin overrides (name → mixin node) */
  mixins: Map<string, Node>;
}

let nextSessionId = 1;

/**
 * EvalSession: a lightweight overlay on a canonical AST.
 *
 * Instead of deep-cloning an entire parsed tree for each import
 * evaluation, a session stores only the *deltas* — field overrides,
 * runtime bookkeeping, and scope snapshots. Untouched nodes remain
 * shared across all sessions with zero per-session cost.
 *
 * Cloning scenarios this replaces (in later stages):
 * - `import`-type imports: fresh eval each time, different ambient scope
 * - `with`/`set` injection: override specific variable values
 * - Compose re-imports: re-eval cached tree with different context
 * - `multiple`/`_dedupe`: separate output from same source
 *
 * **Compatibility rule**: when no session exists on Context, all
 * current node fields remain the source of truth and all current
 * mutation-based behavior remains unchanged.
 *
 * Introduced in Stage 7 (container only). Wired into eval paths
 * in Stages 8-13.
 */
export class EvalSession {
  /** Unique session identifier */
  readonly id: number;

  /** Per-node field overrides */
  private patches = new WeakMap<Node, NodePatch>();

  /** Per-node runtime bookkeeping (parent, evaluated, index, etc.) */
  private runtime = new WeakMap<Node, RuntimeState>();

  /** Scope snapshots keyed by resolved import path */
  private scopes = new Map<string, ScopeSnapshot>();

  /** Nodes that have been materialized (copied) in this session */
  private materialized = new WeakSet<Node>();

  constructor() {
    this.id = nextSessionId++;
  }

  // -- Field patch API --

  /**
   * Store a field override for a node in this session.
   * The canonical node is not mutated.
   */
  patchField(node: Node, key: string, value: unknown): void {
    let patch = this.patches.get(node);
    if (!patch) {
      patch = {};
      this.patches.set(node, patch);
    }
    patch[key] = value;
  }

  /**
   * Retrieve a patched field value, or undefined if unpatched.
   * Callers should fall through to the node's own field when
   * this returns undefined.
   */
  getField(node: Node, key: string): unknown | undefined {
    const patch = this.patches.get(node);
    if (!patch) {
      return undefined;
    }
    // Use hasOwnProperty to distinguish "patched to undefined" from "unpatched"
    return Object.prototype.hasOwnProperty.call(patch, key)
      ? patch[key]
      : undefined;
  }

  /** Check whether a node has been patched at all in this session. */
  hasPatches(node: Node): boolean {
    return this.patches.has(node);
  }

  /** Check whether a specific field has been patched. */
  hasField(node: Node, key: string): boolean {
    const patch = this.patches.get(node);
    return !!patch && Object.prototype.hasOwnProperty.call(patch, key);
  }

  // -- Runtime state API --

  /** Get or create runtime state for a node in this session. */
  getRuntime(node: Node): RuntimeState {
    let state = this.runtime.get(node);
    if (!state) {
      state = {};
      this.runtime.set(node, state);
    }
    return state;
  }

  /** Check whether a node has runtime state in this session. */
  hasRuntime(node: Node): boolean {
    return this.runtime.has(node);
  }

  // -- Scope snapshot API --

  /** Store a scope snapshot for an import path. */
  setScope(resolvedPath: string, snapshot: ScopeSnapshot): void {
    this.scopes.set(resolvedPath, snapshot);
  }

  /** Retrieve a scope snapshot for an import path. */
  getScope(resolvedPath: string): ScopeSnapshot | undefined {
    return this.scopes.get(resolvedPath);
  }

  // -- Materialization API --

  /** Mark a node as materialized (copied) in this session. */
  materialize(node: Node): void {
    this.materialized.add(node);
  }

  /** Check whether a node has been materialized in this session. */
  isMaterialized(node: Node): boolean {
    return this.materialized.has(node);
  }
}
