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
 * @see docs/future/core-architecture/PERFORMANCE-HANDOFF.md
 */

import type { Node } from './node.js';
import type { VarDeclaration } from './declaration-var.js';
import type { MixinEntry } from './util/callable-entry.js';

/**
 * One live binding slot.  Value is updated in place for loop counters and
 * mixin params — no copy, no fork.
 */
export interface BindingCell {
  value?: Node;
  prepareValue?: (value: Node | undefined) => Node;
  /** Back-pointer to the canonical AST node, used for recursion detection. */
  sourceNode?: Node;
  /** Runtime rules frame that owns this live binding. */
  rulesContext?: object;
  readonly?: boolean;
}

export function getBindingCellValue(cell: BindingCell): Node {
  if (!cell.prepareValue) {
    if (!cell.value) {
      throw new Error('Binding cell has no value');
    }
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

export type ScopeFrameVariableLookupResult =
  | {
    kind: 'live';
    cell: BindingCell;
    sourceNode?: Node;
  }
  | {
    kind: 'declaration';
    entry: BindingEntry;
  }
  | {
    kind: 'miss';
  }
  | {
    kind: 'uncovered';
  };

export type ScopeFrameCallableLookupResult =
  | {
    kind: 'hit';
    bucket: MixinEntry[];
  }
  | {
    kind: 'miss';
  }
  | {
    kind: 'uncovered';
  };

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
   * Static callable buckets for this scope. This intentionally reuses the
   * Rules.mixinsByName arrays instead of wrapping every callable in another
   * binding object during this migration slice.
   */
  callableBucketsByName: Map<string, MixinEntry[]> | undefined;

  /**
   * True when declarationBucketsByName represents every static declaration on
   * this frame's Rules surface. Runtime live-slot-only frames leave this false
   * so variable lookup can fall back to the older declaration surface instead
   * of treating an empty bucket as a covered miss.
   */
  declarationsCovered: boolean;

  /**
   * True when callableBucketsByName represents the static callable entries on
   * this frame's Rules surface. Runtime live-slot-only frames leave this false
   * so callable lookup can route complex/unmodeled cases to the old path.
   */
  callablesCovered: boolean;

  /**
   * True when a simple static callable miss can stop at this frame. Frames with
   * child lookup surfaces keep this false until those surfaces are represented
   * in binding state.
   */
  callableMissesCovered: boolean;

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
  pendingDeclarationNames?: VarDeclaration[],
  declarationsCovered = varsByName !== undefined,
  callablesByName?: Map<string, MixinEntry[]>,
  callablesCovered = callablesByName !== undefined,
  callableMissesCovered = callablesCovered
): ScopeFrame {
  const declarationBucketsByName = new Map<string, BindingEntry[]>();

  if (varsByName) {
    for (const [name, decls] of varsByName) {
      const entries: BindingEntry[] = [];
      for (let i = 0; i < decls.length; i++) {
        const decl = decls[i]!;
        entries[i] = {
          cell: {
            value: decl.value.value,
            sourceNode: decl,
            readonly: decl.options?.readonly
          },
          sourceNode: decl
        };
      }
      declarationBucketsByName.set(name, entries);
    }
  }

  return {
    parent,
    fallbackFrame: undefined,
    liveSlotsByName: liveSlots ?? new Map(),
    declarationBucketsByName,
    callableBucketsByName: callablesByName,
    declarationsCovered,
    callablesCovered,
    callableMissesCovered,
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

export function lookupScopeFrameVariable(
  frame: ScopeFrame | undefined,
  name: string,
  options?: {
    start?: number;
    filter?: (node: Node) => boolean;
    blockedSource?: (node: Node) => boolean;
    includeLive?: boolean;
    includeDeclarations?: boolean;
    bailOnPendingDeclarations?: boolean;
  }
): ScopeFrameVariableLookupResult {
  let f = frame;
  let start = options?.start;
  let fallbackFrame = frame?.fallbackFrame;
  while (true) {
    while (f) {
      const live = options?.includeLive === false
        ? undefined
        : f.liveSlotsByName.get(name);
      if (live) {
        const sourceNode = live.sourceNode;
        if (!sourceNode || !options?.blockedSource?.(sourceNode)) {
          return {
            kind: 'live',
            cell: live,
            sourceNode
          };
        }
      }

      if (options?.includeDeclarations !== false && !f.declarationsCovered) {
        return { kind: 'uncovered' };
      }

      if (
        options?.bailOnPendingDeclarations
        && f.pendingDeclarationNames.length > 0
      ) {
        return { kind: 'uncovered' };
      }

      const bucket = options?.includeDeclarations === false
        ? undefined
        : f.declarationBucketsByName.get(name);
      if (bucket?.length) {
        for (let i = bucket.length - 1; i >= 0; i--) {
          const entry = bucket[i]!;
          if (
            start !== undefined
            && !(entry.sourceNode.index !== undefined && entry.sourceNode.index < start)
          ) {
            continue;
          }
          if (!options?.filter || options.filter(entry.sourceNode)) {
            return {
              kind: 'declaration',
              entry
            };
          }
        }
      }

      start = undefined;
      f = f.parent;
    }

    if (!fallbackFrame) {
      return { kind: 'miss' };
    }

    f = fallbackFrame;
    fallbackFrame = fallbackFrame.fallbackFrame;
    start = undefined;
  }
}

export function lookupScopeFrameCallable(
  frame: ScopeFrame | undefined,
  name: string,
  options?: {
    includeRulesets?: boolean;
    searchParents?: boolean;
  }
): ScopeFrameCallableLookupResult {
  let f = frame;
  while (f) {
    if (!f.callablesCovered) {
      return { kind: 'uncovered' };
    }

    const bucket = f.callableBucketsByName?.get(name);
    if (bucket?.length) {
      if (options?.includeRulesets !== false) {
        return { kind: 'hit', bucket };
      }
      for (let i = bucket.length - 1; i >= 0; i--) {
        if (bucket[i]!.type !== 'Ruleset') {
          return { kind: 'hit', bucket };
        }
      }
    }

    if (!f.callableMissesCovered) {
      return { kind: 'uncovered' };
    }

    if (options?.searchParents === false) {
      break;
    }
    f = f.parent;
  }
  return { kind: 'miss' };
}

export function assignScopeFrameVariable(
  frame: ScopeFrame | undefined,
  name: string,
  value: Node
): ScopeFrameVariableLookupResult | undefined {
  const hit = lookupScopeFrameVariable(frame, name);
  if (hit.kind === 'miss' || hit.kind === 'uncovered') {
    return undefined;
  }
  if (hit.kind === 'live') {
    hit.cell.value = value;
  } else {
    hit.entry.cell.value = value;
  }
  return hit;
}
