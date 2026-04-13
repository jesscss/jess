/**
 * ScopeFrame — Slice 6 of the registry redesign.
 *
 * A ScopeFrame is a lightweight runtime object that will eventually replace the
 * generic DeclarationRegistry for variable lookup. For now it is populated in
 * parallel with the existing registry system so we can verify the two produce
 * identical results before switching the hot path.
 *
 * Relationship to existing infrastructure:
 *   - declarationBucketsByName is built from Rules.varsByName (slice 5).
 *     Only static-key VarDeclarations are stored here; dynamic keys
 *     (Interpolated name nodes) go into pendingDynamicDecls.
 *   - liveSlotsByName mirrors Rules.runtimeVarBindings (mixin params).
 *   - The parent frame chain is the call-site lexical chain, not the
 *     node .parent chain.  (Wired up in a later slice.)
 *
 * @see docs/future/performance/2026-04-13-registry-redesign-proposal.md
 */

import type { Node } from './node.js';
import type { VarDeclaration } from './declaration-var.js';

/**
 * One live binding slot.  Value is updated in place for loop counters and
 * mixin params — no copy, no fork.
 */
export interface BindingCell {
  value: Node;
  /** Back-pointer to the canonical AST node, used for recursion detection. */
  sourceNode?: Node;
  readonly?: boolean;
}

/**
 * One entry in a contextual declaration bucket.  Carries the binding cell and
 * the AST node it came from (for position-aware resolution when needed).
 */
export interface BindingEntry {
  cell: BindingCell;
  /** The VarDeclaration or Declaration AST node in Rules.value. */
  sourceNode: VarDeclaration;
}

/**
 * One scope frame.  Holds all bindings visible at one lexical scope boundary.
 *
 * Frames form a chain: each frame's `parent` points to the enclosing scope's
 * frame as it existed at the call site — not the definition site.  This is
 * what gives the runtime correct contextual (lazy) resolution without needing
 * to clone node trees or rewrite parent pointers.
 */
export interface ScopeFrame {
  /**
   * Enclosing scope's frame at the call site.
   * undefined for the root frame.
   */
  parent: ScopeFrame | undefined;

  /**
   * Live binding cells: mixin params and loop counters.
   * O(1) Map.get; populated at call time, not from the AST.
   */
  liveSlotsByName: Map<string, BindingCell>;

  /**
   * Contextual variable declarations with static (non-interpolated) keys.
   * Populated from Rules.varsByName when the frame is first accessed.
   * Entries are in source order; last entry wins (Less semantics).
   */
  declarationBucketsByName: Map<string, BindingEntry[]>;

  /**
   * VarDeclarations whose name is a computed expression (Interpolated,
   * variable-variable, etc.).  Resolved lazily at first lookup.
   */
  pendingDynamicDecls: VarDeclaration[];

  /** Back-pointer to the Rules node this frame was built from. */
  rulesNode: object;  // typed as object to avoid a circular import; callers cast
}

/**
 * Build a ScopeFrame from a Rules node.
 *
 * Slice 6: builds declarationBucketsByName directly from Rules.varsByName so
 * the frame is always consistent with the existing registry index.  If varsByName
 * is undefined (not yet indexed), returns a frame with empty buckets — callers
 * should ensure _indexRules() has run before calling this.
 *
 * @param varsByName  Rules.varsByName — the per-scope static VarDecl index
 * @param rulesNode   Back-pointer for debugging
 * @param parent      Enclosing scope's frame (undefined for root)
 */
export function buildScopeFrame(
  varsByName: Map<string, VarDeclaration[]> | undefined,
  rulesNode: object,
  parent: ScopeFrame | undefined
): ScopeFrame {
  const declarationBucketsByName = new Map<string, BindingEntry[]>();

  if (varsByName) {
    for (const [name, decls] of varsByName) {
      const entries: BindingEntry[] = decls.map(decl => ({
        cell: {
          value: decl.value.value,
          sourceNode: decl,
          readonly: decl.options?.readonly
        },
        sourceNode: decl
      }));
      declarationBucketsByName.set(name, entries);
    }
  }

  return {
    parent,
    liveSlotsByName: new Map(),
    declarationBucketsByName,
    pendingDynamicDecls: [],  // dynamic-key decls — populated in a later slice
    rulesNode
  };
}

/**
 * Look up a variable name in a frame chain.
 * Mirrors the resolveCell algorithm from the design proposal.
 *
 * Slice 6: only checks declarationBucketsByName (contextual path).
 * liveSlotsByName population from runtimeVarBindings is a later slice.
 *
 * Returns the last BindingEntry in the bucket (Less "last definition wins"),
 * or undefined if not found in this frame or any ancestor.
 */
export function resolveFrameCell(
  name: string,
  frame: ScopeFrame | undefined
): BindingEntry | undefined {
  let f = frame;
  while (f) {
    // 1. Live slots (mixin params — populated in a later slice)
    // const live = f.liveSlotsByName.get(name);
    // if (live) return { cell: live, sourceNode: live.sourceNode as VarDeclaration };

    // 2. Static contextual bucket — last entry wins
    const bucket = f.declarationBucketsByName.get(name);
    if (bucket && bucket.length > 0) {
      return bucket[bucket.length - 1];
    }

    // 3. Dynamic decls — later slice

    // 4. Walk parent
    f = f.parent;
  }
  return undefined;
}
