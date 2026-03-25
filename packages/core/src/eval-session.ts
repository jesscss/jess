import type { Node } from './tree/node-base.js';
import type { VarDeclaration } from './tree/declaration-var.js';
import type { Ruleset } from './tree/ruleset.js';
import type { Mixin } from './tree/mixin.js';
import type { Declaration } from './tree/declaration.js';
import type { Rules } from './tree/rules.js';

export interface SessionRegistryDelta {
  rulesetIndex?: Map<string, Set<Ruleset>>;
  mixinIndex?: Map<string, Array<{
    value: Mixin | Ruleset;
    match: string[];
  }>>;
  declarationIndex?: Map<string, Set<Declaration>>;
}

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
  sourceParent?: Node;
  /** Flags to add (bitwise OR) on top of canonical flags */
  flagsAdd?: number;
  /** Flags to remove (bitwise AND ~mask) from canonical flags */
  flagsRemove?: number;
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

export interface EvalDependency {
  dependsOn: Set<VarDeclaration> | null;
  sourceExpr?: Node;
}

let nextPositionId = 1;

/**
 * A position in the virtual evaluated tree.
 *
 * Represents one placement of a canonical subtree (mixin call, repeated import).
 * Contains a sparse result map: canonical node → evaluated replacement.
 * Pass-through nodes (unchanged by eval) have no entry.
 *
 * This is the "virtual clone" — O(R) where R = replacements, not O(N) for all nodes.
 */
export class PositionContext {
  readonly id: number;
  readonly session: EvalSession;
  readonly sourceRoot: Node;

  /** Binding deltas for this placement (e.g., changed mixin params) */
  bindings?: Map<string, Node>;

  /** Sparse result map: canonical node → evaluated replacement */
  private results = new Map<Node, Node>();

  constructor(session: EvalSession, sourceRoot: Node) {
    this.id = nextPositionId++;
    this.session = session;
    this.sourceRoot = sourceRoot;
  }

  /** Store an evaluated replacement for a canonical node */
  setResult(canonical: Node, replacement: Node): void {
    this.results.set(canonical, replacement);
  }

  /** Get the evaluated replacement, or undefined if pass-through */
  getResult(canonical: Node): Node | undefined {
    return this.results.get(canonical);
  }

  /** Check if a canonical node has a replacement at this position */
  hasResult(canonical: Node): boolean {
    return this.results.has(canonical);
  }

  /** Number of replacements (measure of sparsity) */
  get replacementCount(): number {
    return this.results.size;
  }

  /**
   * Get the effective node at this position: replacement if exists, canonical otherwise.
   * This is the core read operation for the virtual evaluated tree.
   */
  resolve(canonical: Node): Node {
    return this.results.get(canonical) ?? canonical;
  }

  /**
   * Resolve children of a canonical container at this position.
   * Returns the canonical children with replacements applied.
   */
  resolveChildren(canonicalChildren: readonly Node[]): readonly Node[] {
    if (this.results.size === 0) {
      return canonicalChildren;
    }
    let hasReplacement = false;
    for (const child of canonicalChildren) {
      if (this.results.has(child)) {
        hasReplacement = true;
        break;
      }
    }
    if (!hasReplacement) {
      return canonicalChildren;
    }
    return canonicalChildren.map(child => this.results.get(child) ?? child);
  }
}

/**
 * Tracks which canonical nodes are affected by binding changes
 * at a particular instance root. Used to keep shadow state sparse:
 * only nodes whose dependencies include a changed binding get shadow entries.
 */
export interface DependencyReach {
  /** The set of VarDeclarations whose values changed at this instance root */
  changedBindings: Set<VarDeclaration>;
  /** Canonical nodes known to depend on at least one changed binding */
  affectedNodes: Set<Node>;
}

/**
 * Sparse shadow entry for one canonical node inside one instance root.
 *
 * Only nodes that actually diverge from the canonical source get an entry.
 * Untouched nodes stay source-backed with zero per-instance cost.
 */
export interface ShadowEntry {
  fieldPatches?: Record<string, unknown>;
  runtime?: RuntimeState;
}

let nextSessionId = 1;
let nextInstanceId = 1;

/**
 * One distinct evaluated placement of a canonical subtree.
 *
 * Examples of placements:
 * - import #2 of a stylesheet (same file imported 3× as `multiple`)
 * - mixin call #3 (same mixin body reused with different bindings)
 * - stylesheet-function result for one call site
 *
 * Each root owns sparse shadow state for its placement only.
 * Multiple roots can exist over the same canonical subtree
 * in one EvalSession without fighting over a single overlay slot.
 */
export class SessionInstanceRoot {
  readonly id: number;
  readonly session: EvalSession;
  readonly sourceRoot: Node;

  /** Binding deltas for this placement (e.g., changed variable values) */
  bindings?: Map<string, Node>;

  /** Dependency reach — which canonical nodes are affected by binding changes */
  dependencyReach?: DependencyReach;

  /** Sparse shadow entries keyed by canonical source node */
  private overrides = new Map<Node, ShadowEntry>();

  constructor(session: EvalSession, sourceRoot: Node) {
    this.id = nextInstanceId++;
    this.session = session;
    this.sourceRoot = sourceRoot;
  }

  /**
   * Compute which canonical nodes are affected by this root's binding changes.
   *
   * Uses the session's per-node dependency annotations to determine which
   * nodes depend on the changed bindings, so only those nodes need shadow state.
   */
  computeDependencyReach(changedVars: Set<VarDeclaration>): DependencyReach {
    const affected = new Set<Node>();
    const session = this.session;

    for (const [node] of this.overrides) {
      const dep = session.getDependency(node);
      if (dep?.dependsOn) {
        for (const varDecl of dep.dependsOn) {
          if (changedVars.has(varDecl)) {
            affected.add(node);
            break;
          }
        }
      }
    }

    this.dependencyReach = { changedBindings: changedVars, affectedNodes: affected };
    return this.dependencyReach;
  }

  /**
   * Check whether a canonical node is within the dependency reach of this root.
   * If no dependency reach has been computed, conservatively returns true.
   */
  isAffected(node: Node): boolean {
    if (!this.dependencyReach) {
      return true;
    }
    return this.dependencyReach.affectedNodes.has(node);
  }

  // -- Shadow entry access --

  getShadow(node: Node): ShadowEntry | undefined {
    return this.overrides.get(node);
  }

  ensureShadow(node: Node): ShadowEntry {
    let entry = this.overrides.get(node);
    if (!entry) {
      entry = {};
      this.overrides.set(node, entry);
    }
    return entry;
  }

  hasShadow(node: Node): boolean {
    return this.overrides.has(node);
  }

  // -- Field patch API (instance-local) --

  patchField(node: Node, key: string, value: unknown): void {
    const entry = this.ensureShadow(node);
    if (!entry.fieldPatches) {
      entry.fieldPatches = {};
    }
    entry.fieldPatches[key] = value;
  }

  getField(node: Node, key: string): unknown | undefined {
    const entry = this.overrides.get(node);
    if (!entry?.fieldPatches) {
      return undefined;
    }
    return Object.prototype.hasOwnProperty.call(entry.fieldPatches, key)
      ? entry.fieldPatches[key]
      : undefined;
  }

  hasField(node: Node, key: string): boolean {
    const entry = this.overrides.get(node);
    return !!entry?.fieldPatches
      && Object.prototype.hasOwnProperty.call(entry.fieldPatches, key);
  }

  // -- Runtime state API (instance-local) --

  getRuntime(node: Node): RuntimeState {
    const entry = this.ensureShadow(node);
    if (!entry.runtime) {
      entry.runtime = {};
    }
    return entry.runtime;
  }

  hasRuntime(node: Node): boolean {
    const entry = this.overrides.get(node);
    return !!entry?.runtime;
  }

  // -- Children overlay API (instance-local) --

  private childrenOverrides = new Map<Node, readonly Node[]>();

  setChildren(container: Node, value: readonly Node[]): void {
    this.childrenOverrides.set(container, value);
  }

  getChildren(container: Node): readonly Node[] | undefined {
    return this.childrenOverrides.get(container);
  }

  hasChildren(container: Node): boolean {
    return this.childrenOverrides.has(container);
  }

  /** Number of canonical nodes that have shadow entries in this root */
  get shadowCount(): number {
    return this.overrides.size;
  }
}

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

  /**
   * When true, _isPreEvaluated/_isEvaluated return false for nodes
   * without explicit entries — forcing re-evaluation of shared canonical
   * nodes. Used for clone(false) mixin eval sessions.
   *
   * When false (default), eval state falls through to canonical fields.
   * Used for patch-only sessions (extend, import reference).
   */
  readonly resetEvalState: boolean;

  /** Instance roots owned by this session */
  private instanceRoots: SessionInstanceRoot[] = [];

  /** Per-node field overrides */
  private patches = new WeakMap<Node, NodePatch>();

  /** Per-node runtime bookkeeping (parent, evaluated, index, etc.) */
  private runtime = new WeakMap<Node, RuntimeState>();

  /** Scope snapshots keyed by resolved import path */
  private scopes = new Map<string, ScopeSnapshot>();

  /** Nodes that have been materialized (copied) in this session */
  private materialized = new WeakSet<Node>();

  /** Per-node dependency annotations */
  private dependencies = new WeakMap<Node, EvalDependency>();

  /** Session-local registry additions keyed by the logical Rules container */
  private registryDeltas = new WeakMap<Rules, SessionRegistryDelta>();

  /** Session-local child-array overlays keyed by the logical Rules container */
  private children = new WeakMap<Rules, readonly Node[]>();

  /** Canonical top-level vars whose values changed in this session */
  private changedVars = new Set<VarDeclaration>();

  constructor(options?: { resetEvalState?: boolean }) {
    this.id = nextSessionId++;
    this.resetEvalState = options?.resetEvalState ?? false;
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

  // -- Dependency API --

  setDependency(node: Node, dependency: EvalDependency): void {
    this.dependencies.set(node, dependency);
  }

  getDependency(node: Node): EvalDependency | undefined {
    return this.dependencies.get(node);
  }

  hasDependency(node: Node): boolean {
    return this.dependencies.has(node);
  }

  // -- Changed vars API --

  markChangedVar(varDecl: VarDeclaration): void {
    this.changedVars.add(varDecl);
  }

  hasChangedVars(): boolean {
    return this.changedVars.size > 0;
  }

  getChangedVars(): ReadonlySet<VarDeclaration> {
    return this.changedVars;
  }

  // -- Registry delta API --

  ensureRegistryDelta(rules: Rules): SessionRegistryDelta {
    let delta = this.registryDeltas.get(rules);
    if (!delta) {
      delta = {};
      this.registryDeltas.set(rules, delta);
    }
    return delta;
  }

  getRegistryDelta(rules: Rules): SessionRegistryDelta | undefined {
    return this.registryDeltas.get(rules);
  }

  clearRegistryDelta(rules: Rules): void {
    this.registryDeltas.delete(rules);
  }

  // -- Rules child overlay API --

  setChildren(rules: Rules, value: readonly Node[]): void {
    this.children.set(rules, value);
  }

  getChildren(rules: Rules): readonly Node[] | undefined {
    return this.children.get(rules);
  }

  hasChildren(rules: Rules): boolean {
    return this.children.has(rules);
  }

  // -- Instance root API --

  /**
   * Create a new instance root for a canonical subtree.
   *
   * Multiple roots can exist over the same sourceRoot in one session.
   * Each root holds its own sparse shadow state.
   */
  createInstanceRoot(sourceRoot: Node): SessionInstanceRoot {
    const root = new SessionInstanceRoot(this, sourceRoot);
    this.instanceRoots.push(root);
    return root;
  }

  /** All instance roots in this session. */
  getInstanceRoots(): readonly SessionInstanceRoot[] {
    return this.instanceRoots;
  }

  /** Instance roots whose sourceRoot matches the given canonical node. */
  getInstanceRootsFor(sourceRoot: Node): SessionInstanceRoot[] {
    return this.instanceRoots.filter(r => r.sourceRoot === sourceRoot);
  }
}
