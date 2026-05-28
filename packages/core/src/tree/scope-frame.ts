/**
 * ScopeFrame.
 *
 * A ScopeFrame is a lightweight runtime object for lexical variable lookup.
 * It carries static declaration buckets, live call-time slots, and unresolved
 * declaration names without cloning node trees or rewriting parent pointers.
 *
 * Relationship to existing infrastructure:
 *   - declarationBucketsByName is built from Rules.varsByName.
 *     Only static-key VarDeclarations are stored here; dynamic keys
 *     (Interpolated name nodes) go into pendingDeclarationNames.
 *   - liveSlotsByName holds mixin params, @arguments, and loop counters.
 *   - The parent frame chain is the call-site lexical chain, not the
 *     node .parent chain.
 *
 * @see docs/future/performance/2026-04-13-registry-redesign-handoff.md
 */

import type { Node } from './node.js';
import type { VarDeclaration } from './declaration-var.js';

/**
 * One live binding slot.  Value is updated in place for loop counters and
 * mixin params — no copy, no fork.
 */
export interface BindingCell {
  value: Node;
  prepareValue?: (value: Node) => Node;
  /** Back-pointer to the canonical AST node, used for recursion detection. */
  sourceNode?: Node;
  readonly?: boolean;
}

export function getBindingCellValue(cell: BindingCell): Node {
  if (!cell.prepareValue) {
    return cell.value;
  }
  const value = cell.prepareValue(cell.value);
  cell.value = value;
  cell.prepareValue = undefined;
  return value;
}

/**
 * One entry in a contextual declaration bucket.  Carries the binding cell and
 * the AST node it came from (for position-aware resolution when needed).
 */
export interface BindingEntry {
  cell: BindingCell;
  /** The AST node that owns this binding. */
  sourceNode: Node;
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
   * Optional call-site fallback chain for leaky/runtime lookup.
   * This is distinct from `parent`: lexical/default-param resolution should
   * stay on the ordinary frame chain, while unresolved body vars may still
   * fall back to the caller scope.
   */
  fallbackFrame?: ScopeFrame | undefined;

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
   *
   * Current note: parser frontends still mostly emit static VarDeclaration
   * names. Lookup only promotes entries out of this list once their names have
   * already become static on-node. If a name is still dynamic at reference
   * time, lookup does not try to resolve it; the surrounding Rules eval queue
   * is responsible for retrying later if/when that declaration settles.
   */
  pendingDeclarationNames: VarDeclaration[];

  /** Back-pointer to the Rules node this frame was built from. */
  rulesNode: object;  // typed as object to avoid a circular import; callers cast
}

/**
 * Build a ScopeFrame from a Rules node.
 *
 * Builds declarationBucketsByName from Rules.varsByName and populates
 * liveSlotsByName from the supplied map (mixin params, @arguments, loop vars).
 * Parent frame wiring is handled by getScopeFrame() on Rules, which walks the
 * node parent chain to find the nearest ancestor frame when no explicit parent
 * is supplied.
 *
 * @param varsByName  Rules.varsByName — the per-scope static VarDecl index
 * @param rulesNode   Back-pointer for debugging
 * @param parent      Enclosing scope's frame (undefined = auto-wire via node chain)
 * @param liveSlots   Pre-built live binding map (params, @arguments)
 */
export function buildScopeFrame(
  varsByName: Map<string, VarDeclaration[]> | undefined,
  rulesNode: object,
  parent: ScopeFrame | undefined,
  liveSlots?: Map<string, BindingCell>,
  pendingDeclarationNames?: VarDeclaration[]
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
    fallbackFrame: undefined,
    liveSlotsByName: liveSlots ?? new Map(),
    declarationBucketsByName,
    pendingDeclarationNames: pendingDeclarationNames ?? [],
    rulesNode
  };
}

/**
 * Look up a variable name in a frame chain.
 * Mirrors the resolveCell algorithm from the design proposal.
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
    // 1. Live slots (mixin params, @arguments, loop vars)
    const live = f.liveSlotsByName.get(name);
    if (live) {
      return { cell: live, sourceNode: live.sourceNode ?? getBindingCellValue(live) };
    }

    // 2. Static contextual bucket — last entry wins
    const bucket = f.declarationBucketsByName.get(name);
    if (bucket && bucket.length > 0) {
      return bucket[bucket.length - 1];
    }

    // 3. Walk parent
    f = f.parent;
  }
  return undefined;
}
