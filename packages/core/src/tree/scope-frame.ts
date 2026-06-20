/**
 * ScopeFrame.
 *
 * A ScopeFrame is a lightweight runtime object for lexical variable lookup.
 * It carries current bindings, static declaration buckets, and unresolved
 * declaration names without cloning node trees or rewriting parent pointers.
 *
 * Relationship to existing infrastructure:
 *   - declarationBucketsByName is built from Rules.varsByName entries.
 *     Only static-key VarDeclarations are stored here; dynamic keys
 *     (Interpolated name nodes) go into pendingDeclarationNames.
 *   - currentBindingsByName holds the current read path for both live slots
 *     and the latest static declaration.
 *   - The parent frame chain is the call-site lexical chain, not the
 *     node .parent chain.
 *
 * @see docs/future/core-architecture/PERFORMANCE-HANDOFF.md
 */

import { F_STATIC, Node } from './node.js';
import type { VarDeclaration } from './declaration-var.js';
import type { CallableLookupEntry } from './util/callable-entry.js';

/**
 * One live binding slot.  Value is updated in place for loop counters and
 * mixin params — no copy, no fork.
 */
export interface BindingCell {
  value?: Node;
  prepareValue?: (value: Node | undefined) => Node;
  /** Stable identity for cached reference handles; value writes do not change it. */
  lookupIdentity?: number;
  /** Back-pointer to the canonical AST node, used for recursion detection. */
  sourceNode?: Node;
  /** Runtime rules frame that owns this live binding. */
  rulesContext?: object;
  readonly?: boolean;
  live?: boolean;
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

export function createVarDeclarationBindingEntry(decl: VarDeclaration): BindingEntry {
  return {
    cell: {
      value: decl.valueNode,
      sourceNode: decl,
      readonly: decl.options?.readonly
    },
    sourceNode: decl
  };
}

export type ScopeFrameVariableLookupResult =
  | {
    kind: 'live';
    cell: BindingCell;
    sourceNode?: Node;
    frame: ScopeFrame;
    readonly?: boolean;
  }
  | {
    kind: 'declaration';
    cell: BindingCell;
    sourceNode: Node;
    frame: ScopeFrame;
    readonly?: boolean;
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
    bucket: CallableLookupEntry[];
  }
  | {
    kind: 'miss';
  }
  | {
    kind: 'uncovered';
    reason: 'frame' | 'key' | 'candidate' | 'child-surface' | 'reference-import';
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
   * Construction/clone owner for live binding cells: mixin params, configured
   * import variables, and loop counters. Ordinary reads use
   * currentBindingsByName so static declarations and live cells share one path.
   */
  liveSlotsByName: Map<string, BindingCell>;

  /**
   * Current binding cells for ordinary reads.
   * Static declaration source-order history stays in declarationBucketsByName;
   * this map is the direct path for "what is the current value of this name?"
   */
  currentBindingsByName: Map<string, BindingCell>;

  /**
   * Assignment-only binding cells contributed by public child/import surfaces.
   * Ordinary reads do not consult this map; it exists so `setDefined` can
   * update or reject imported/current assignment targets without reopening the
   * recursive child declaration crawl.
   */
  assignmentBindingsByName?: Map<string, BindingCell>;

  /**
   * Per-name readonly overlay for assignment target cells. The cell remains the
   * canonical declaration binding; this set carries readonly facts introduced
   * by an import/child edge without cloning the cell.
   */
  assignmentReadonlyByName?: Set<string>;

  /**
   * True when a child/import variable assignment surface exists but is not
   * modeled in assignmentBindingsByName. This keeps `setDefined` from treating
   * optional-only or dynamic targets as covered misses.
   */
  hasUncoveredAssignmentTargetSurface: boolean;

  /**
   * Bumped when a current binding pointer changes. In-place cell value writes
   * keep cached handles valid because reference reads still dereference the
   * live cell.
   */
  currentBindingsVersion: number;

  /**
   * True when this frame owns live cells in liveSlotsByName. This keeps clone
   * and prep paths from probing the live-slot map as a read-path signal.
   */
  hasLiveBindings: boolean;

  /**
   * Contextual variable declarations with static (non-interpolated) keys.
   * Populated from Rules.varsByName when the frame is first accessed.
   * Entries are in source order; last entry wins (Less semantics).
   */
  declarationBucketsByName: Map<string, BindingEntry[]>;

  /**
   * Static callable buckets for this scope.
   */
  callableBucketsByName: Map<string, CallableLookupEntry[] | null> | undefined;

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
   * True when callableMissesCovered is a computed frame fact instead of an
   * unknown value left by cache invalidation.
   */
  callableMissCoverageKnown: boolean;

  /**
   * Same coverage as callableMissesCovered, but for mixin-only lookup. A child
   * ruleset surface can satisfy mixin-ruleset lookup without satisfying a
   * Mixin-only call.
   */
  mixinCallableMissesCovered: boolean;

  /**
   * True when mixinCallableMissesCovered is a computed frame fact instead of an
   * unknown value left by cache invalidation.
   */
  mixinCallableMissCoverageKnown: boolean;

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

  /** True when reference-import surfaces can contribute callable lookup hits. */
  hasReferenceImports: boolean;
}

let nextBindingCellLookupIdentity = 1;

export function ensureBindingCellLookupIdentity(cell: BindingCell): number {
  if (cell.lookupIdentity !== undefined) {
    return cell.lookupIdentity;
  }
  const identity = nextBindingCellLookupIdentity++;
  cell.lookupIdentity = identity === 0
    ? nextBindingCellLookupIdentity++
    : identity;
  return cell.lookupIdentity;
}

function setCurrentBindingCell(
  frame: ScopeFrame,
  name: string,
  cell: BindingCell
): void {
  ensureBindingCellLookupIdentity(cell);
  if (frame.currentBindingsByName.get(name) !== cell) {
    frame.currentBindingsVersion++;
  }
  frame.currentBindingsByName.set(name, cell);
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
 * @param varsByName  Rules.varsByName — the per-scope static VarDecl binding index
 * @param rulesNode   Back-pointer for debugging
 * @param parent      Enclosing scope's frame (undefined = auto-wire via node chain)
 * @param liveSlots   Pre-built live binding map (params, @arguments)
 */
export function buildScopeFrame(
  varsByName: Map<string, BindingEntry[]> | undefined,
  rulesNode: object,
  parent: ScopeFrame | undefined,
  liveSlots?: Map<string, BindingCell>,
  pendingDeclarationNames?: VarDeclaration[],
  declarationsCovered = varsByName !== undefined,
  callableEntriesByName?: Map<string, CallableLookupEntry[] | null>,
  callablesCovered = callableEntriesByName !== undefined,
  callableMissesCovered = callablesCovered,
  mixinCallableMissesCovered = callableMissesCovered,
  callableMissCoverageKnown = callablesCovered,
  mixinCallableMissCoverageKnown = callableMissCoverageKnown,
  hasReferenceImports = false
): ScopeFrame {
  const declarationBucketsByName = new Map<string, BindingEntry[]>();
  const currentBindingsByName = new Map<string, BindingCell>();

  if (varsByName) {
    for (const [name, entries] of varsByName) {
      for (let i = 0; i < entries.length; i++) {
        ensureBindingCellLookupIdentity(entries[i]!.cell);
      }
      declarationBucketsByName.set(name, entries);
      const currentEntry = entries[entries.length - 1];
      if (currentEntry) {
        currentBindingsByName.set(name, currentEntry.cell);
      }
    }
  }

  const liveSlotsByName = liveSlots ?? new Map<string, BindingCell>();
  let hasLiveBindings = false;
  for (const [name, cell] of liveSlotsByName) {
    ensureBindingCellLookupIdentity(cell);
    cell.live = true;
    currentBindingsByName.set(name, cell);
    hasLiveBindings = true;
  }

  return {
    parent,
    fallbackFrame: undefined,
    liveSlotsByName,
    currentBindingsByName,
    hasUncoveredAssignmentTargetSurface: false,
    currentBindingsVersion: 0,
    hasLiveBindings,
    declarationBucketsByName,
    callableBucketsByName: callableEntriesByName,
    declarationsCovered,
    callablesCovered,
    callableMissesCovered,
    callableMissCoverageKnown,
    mixinCallableMissesCovered,
    mixinCallableMissCoverageKnown,
    pendingDeclarationNames: pendingDeclarationNames ?? [],
    rulesNode,
    hasReferenceImports
  };
}

export function copyScopeFrameLiveBindingSlots(
  frame: ScopeFrame | undefined
): Map<string, BindingCell> {
  return new Map(frame?.liveSlotsByName);
}

export function setScopeFrameLiveBinding(
  frame: ScopeFrame,
  name: string,
  cell: BindingCell
): void {
  ensureBindingCellLookupIdentity(cell);
  cell.live = true;
  frame.liveSlotsByName.set(name, cell);
  setCurrentBindingCell(frame, name, cell);
  frame.hasLiveBindings = true;
}

export function setScopeFrameDeclarationBinding(
  frame: ScopeFrame,
  name: string,
  entry: BindingEntry
): void {
  setCurrentBindingCell(frame, name, entry.cell);
}

function pendingDeclarationMayAffectName(
  pendingDeclarationNames: VarDeclaration[],
  name: string
): boolean {
  for (let i = 0; i < pendingDeclarationNames.length; i++) {
    const declName = pendingDeclarationNames[i]!.name;
    if (declName instanceof Node && !declName.hasFlag(F_STATIC)) {
      return true;
    }
    if (`${declName.valueOf()}` === name) {
      return true;
    }
  }
  return false;
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
    const cell = f.currentBindingsByName.get(name);
    if (cell) {
      const sourceNode = cell.sourceNode ?? getBindingCellValue(cell);
      return { cell, sourceNode };
    }

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
    includeAssignmentTargets?: boolean;
    bailOnPendingDeclarations?: boolean;
  }
): ScopeFrameVariableLookupResult {
  let f = frame;
  let start = options?.start;
  let fallbackFrame = frame?.fallbackFrame;
  let visitedFallbackFrames: Set<ScopeFrame> | undefined;
  while (true) {
    while (f) {
      if (visitedFallbackFrames?.has(f)) {
        return { kind: 'miss' };
      }
      visitedFallbackFrames?.add(f);
      let currentCellRejectedByGuard = false;
      const currentCell = f.currentBindingsByName.get(name);
      if (
        currentCell
        && currentCell.live === true
        && options?.includeLive !== false
      ) {
        const sourceNode = currentCell.sourceNode;
        if (!sourceNode || !options?.blockedSource?.(sourceNode)) {
          return {
            kind: 'live',
            cell: currentCell,
            sourceNode,
            frame: f,
            readonly: currentCell.readonly
          };
        }
        currentCellRejectedByGuard = sourceNode !== undefined
          && options?.blockedSource?.(sourceNode) === true;
      } else if (start === undefined) {
        if (
          currentCell
          && options?.includeDeclarations !== false
          && f.declarationsCovered
          && currentCell.sourceNode
        ) {
          if (
            !options?.blockedSource?.(currentCell.sourceNode)
            && (!options?.filter || options.filter(currentCell.sourceNode))
          ) {
            return {
              kind: 'declaration',
              cell: currentCell,
              sourceNode: currentCell.sourceNode,
              frame: f,
              readonly: currentCell.readonly
            };
          }
          currentCellRejectedByGuard = true;
        }
      }

      if (
        start === undefined
        && options?.includeAssignmentTargets === true
        && options?.includeDeclarations !== false
      ) {
        const assignmentCell = f.assignmentBindingsByName?.get(name);
        const sourceNode = assignmentCell?.sourceNode;
        if (
          assignmentCell
          && sourceNode
          && !options?.blockedSource?.(sourceNode)
          && (!options?.filter || options.filter(sourceNode))
        ) {
          return {
            kind: 'declaration',
            cell: assignmentCell,
            sourceNode,
            frame: f,
            readonly: assignmentCell.readonly || f.assignmentReadonlyByName?.has(name)
          };
        }
      }

      if (
        start === undefined
        && options?.includeAssignmentTargets === true
        && f.hasUncoveredAssignmentTargetSurface
      ) {
        return { kind: 'uncovered' };
      }

      if (options?.includeDeclarations !== false && !f.declarationsCovered) {
        return { kind: 'uncovered' };
      }

      if (
        options?.bailOnPendingDeclarations
        && f.pendingDeclarationNames.length > 0
        && pendingDeclarationMayAffectName(f.pendingDeclarationNames, name)
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
              cell: entry.cell,
              sourceNode: entry.sourceNode,
              frame: f,
              readonly: entry.cell.readonly
            };
          }
        }
      }

      fallbackFrame ??= f.fallbackFrame;
      start = undefined;
      f = f.parent;
    }

    if (!fallbackFrame) {
      return { kind: 'miss' };
    }

    f = fallbackFrame;
    visitedFallbackFrames ??= new Set();
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
      return { kind: 'uncovered', reason: 'frame' };
    }

    const callableBucketsByName = f.callableBucketsByName;
    if (!callableBucketsByName?.has(name)) {
      return { kind: 'uncovered', reason: 'key' };
    }

    const bucket = callableBucketsByName.get(name);
    let hasUnconsumedCandidate = false;
    if (bucket?.length) {
      for (let i = bucket.length - 1; i >= 0; i--) {
        const entry = bucket[i]!;
        if (options?.includeRulesets === false && entry.value.type === 'Ruleset') {
          continue;
        }
        if (
          entry.match.length === 0
        ) {
          return { kind: 'hit', bucket };
        }
        hasUnconsumedCandidate = true;
      }
    }
    if (hasUnconsumedCandidate) {
      return { kind: 'uncovered', reason: 'candidate' };
    }

    const missesCovered = options?.includeRulesets === false
      ? f.mixinCallableMissesCovered
      : f.callableMissesCovered;
    if (!missesCovered) {
      if (f.hasReferenceImports) {
        return { kind: 'uncovered', reason: 'reference-import' };
      }
      return { kind: 'uncovered', reason: 'child-surface' };
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
    hit.cell.value = value;
  }
  return hit;
}
