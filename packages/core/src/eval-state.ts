import type { Node } from './tree/node-base.js';

/**
 * Per-node state within an EvalState.
 *
 * Common fields (replacement, evaluated, preEvaluated) are pre-initialized
 * for a stable V8 hidden class. Rare fields (fields, subtree) use `declare`
 * or lazy getters to stay off the instance until needed.
 */
export class NodeState {
  /** Tree-structural: this canonical node becomes this node */
  replacement: Node | undefined = undefined;

  /** Common eval flags */
  evaluated = false;
  preEvaluated = false;

  /** Remaining field overrides (parent, index, etc.) — lazy Map */
  _fields: Map<string, unknown> | undefined;
  get fields(): Map<string, unknown> {
    return (this._fields ??= new Map());
  }

  /** Dependency tracking — stays off instance until first access */
  declare _dependency: import('./tree/util/field-helpers.js').EvalDependency | undefined;

  /** Recursive subtree state — stays off instance until first access */
  declare _subtree: EvalState | undefined;
  get subtree(): EvalState {
    return (this._subtree ??= new EvalState());
  }
}

/**
 * Sparse overlay on the canonical AST for one evaluation pass.
 *
 * Two kinds of patches:
 *   - Node patches:  canonical node → replacement node (tree structure)
 *   - Field patches: any node → property overrides (metadata)
 *
 * Recursive: a node patch can carry its own EvalState for the replacement's
 * subtree, enabling the same canonical subtree (mixin body, import) to be
 * reused with different bindings at different call sites.
 *
 * Usage:
 *   state.get(node).replacement = newNode;   // auto-creates NodeState
 *   state.get(node).evaluated = true;
 *   state.get(node).fields.set('index', 3);
 *   state.peek(node)?.replacement;            // read-only, no allocation
 */
export class EvalState extends Map<Node, NodeState> {
  /** Parent state in the eval state chain (set when pushed onto stack) */
  parent: EvalState | undefined;

  /** Always returns a NodeState — creates one if missing */
  override get(node: Node): NodeState {
    let s = super.get(node);
    if (!s) {
      s = new NodeState();
      super.set(node, s);
    }
    return s;
  }

  /** Read-only lookup — returns undefined if no state exists (no allocation) */
  peek(node: Node): NodeState | undefined {
    return super.get(node);
  }

  /** Read-only lookup walking the parent chain. Returns first match or undefined. */
  resolve(node: Node): NodeState | undefined {
    let state: EvalState | undefined = this;
    while (state) {
      const s = state.peek(node);
      if (s) {
        return s;
      }
      state = state.parent;
    }
    return undefined;
  }
}
