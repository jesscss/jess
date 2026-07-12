import type { Node } from '../node.js';
import type { Rules, RulesOptions } from '../rules.js';
import type { BindingCell } from '../scope-frame.js';
import { createPlacementChildSegment, type PlacementChildSegment, type PlacementRecord } from './placement-state.js';

export type LookupVisibility = keyof NonNullable<RulesOptions['rulesVisibility']>;

export type RulesEntryLike = {
  node: Rules;
  rulesVisibility?: RulesOptions['rulesVisibility'];
  readonly?: boolean;
  hasDeclarationSurface?: boolean;
  hasVarDeclarationSurface?: boolean;
  hasReferenceImportSurface?: boolean;
  assignmentBindingsByName?: Map<string, BindingCell>;
  assignmentReadonlyByName?: Set<string>;
  hasUncoveredAssignmentTargetSurface?: boolean;
  hasExactCallableSurface?: boolean;
  hasExactMixinSurface?: boolean;
  hasExactRulesetSurface?: boolean;
};

export type RulesEntryVisibility = {
  entry?: Rules['options']['rulesVisibility'][string];
  node?: Rules['options']['rulesVisibility'][string];
};

export type MixinOutputLookupState = {
  ambientLookup: boolean;
  canEnter: boolean;
  hasTarget: boolean;
  referenceMode: RulesOptions['referenceMode'];
  visibility?: Rules['options']['rulesVisibility'][string];
};

export type MixinOutputChildPlacementState = {
  outputChild: Node;
  outputRules: Rules;
  sourceChild: Node;
  sourceIndex: number;
};

export type MixinOutputSlot = {
  sourceRules: Rules;
  outputRules: Rules;
  childSegments: readonly MixinOutputChildSegment[];
  sourceByOutput: ReadonlyMap<Node, Node>;
  outputBySource: ReadonlyMap<Node, Node>;
  sourceIndexByOutput: ReadonlyMap<Node, number>;
  placementChildren: readonly Node[];
  scopeFrame: Rules['scopeFrame'];
  rulesVisibility?: RulesOptions['rulesVisibility'];
  referenceMode: RulesOptions['referenceMode'];
  ambientLookup: boolean;
  fallbackFrame?: Rules['scopeFrame'];
  rulesetPlacement?: RulesetMixinPlacementRecord;
};

export type MixinOutputChildSegment = PlacementChildSegment;

export type RulesetMixinPlacementRecord = {
  sourceRules: Rules;
  outputRules: Rules;
  childSegments: readonly MixinOutputChildSegment[];
  sourceIndexByOutput: ReadonlyMap<Node, number>;
};

function createRulesetMixinPlacementRecord(
  sourceRules: Rules,
  outputRules: Rules,
  childSegments = getMixinOutputChildSegments(sourceRules, outputRules),
  sourceIndexByOutput = createSourceIndexByOutput(childSegments)
): RulesetMixinPlacementRecord {
  return {
    sourceRules,
    outputRules,
    childSegments,
    sourceIndexByOutput
  };
}

function createSourceIndexByOutput(
  childSegments: readonly MixinOutputChildSegment[]
): ReadonlyMap<Node, number> {
  const out = new Map<Node, number>();
  for (let i = 0; i < childSegments.length; i++) {
    const segment = childSegments[i]!;
    if (segment.output) {
      out.set(segment.output, segment.index);
    }
  }
  return out;
}

export function getMixinOutputChildSegments(
  sourceRules: Rules,
  outputRules?: Rules
): MixinOutputChildSegment[] {
  const source = sourceRules.rules;
  const output = outputRules?.rules;
  const out = new Array<MixinOutputChildSegment>(source.length);
  for (let i = 0; i < source.length; i++) {
    out[i] = createPlacementChildSegment(source[i]!, output?.[i], i);
  }
  return out;
}

export function getMixinOutputPlacementRecord(outputRules: Rules): PlacementRecord<Rules, Rules> | undefined {
  const slot = outputRules.options.mixinOutputSlot;
  if (!slot) {
    return undefined;
  }
  return {
    source: slot.sourceRules,
    output: slot.outputRules
  };
}

export function getMixinOutputSourceChild(
  outputRules: Rules,
  outputChild: Node
): Node | undefined {
  return outputRules.options.mixinOutputSlot?.sourceByOutput.get(outputChild);
}

export function getMixinOutputChildForSource(
  outputRules: Rules,
  sourceChild: Node
): Node | undefined {
  return outputRules.options.mixinOutputSlot?.outputBySource.get(sourceChild);
}

export function getMixinOutputSourceIndex(
  outputRules: Rules,
  outputChild: Node
): number | undefined {
  return outputRules.options.mixinOutputSlot?.sourceIndexByOutput.get(outputChild);
}

export function getMixinOutputRuleIndex(
  outputRules: Rules,
  outputChild: Node,
  fallbackIndex: number
): number {
  return getMixinOutputSourceIndex(outputRules, outputChild) ?? fallbackIndex;
}

export function getRulesetMixinPlacementSourceIndex(
  outputRules: Rules,
  outputChild: Node
): number | undefined {
  return outputRules.options.mixinOutputSlot?.rulesetPlacement?.sourceIndexByOutput.get(outputChild);
}

export function getMixinOutputSourceChildren(outputRules: Rules): Node[] | undefined {
  const slot = outputRules.options.mixinOutputSlot;
  if (!slot) {
    return undefined;
  }
  const out: Node[] = [];
  for (let i = 0; i < slot.placementChildren.length; i++) {
    const source = slot.sourceByOutput.get(slot.placementChildren[i]!);
    if (source) {
      out.push(source);
    }
  }
  return out;
}

export function getMixinOutputPlacementChildren(outputRules: Rules): readonly Node[] | undefined {
  return outputRules.options.mixinOutputSlot?.placementChildren;
}

export function getMixinOutputChildPlacementState(
  outputRules: Rules,
  outputChild: Node
): MixinOutputChildPlacementState | undefined {
  const slot = outputRules.options.mixinOutputSlot;
  const sourceChild = slot?.sourceByOutput.get(outputChild);
  const sourceIndex = slot?.sourceIndexByOutput.get(outputChild);
  if (!slot || !sourceChild || sourceIndex === undefined) {
    return undefined;
  }
  return {
    outputChild,
    outputRules,
    sourceChild,
    sourceIndex
  };
}

export function getMixinOutputScopeFrame(outputRules: Rules): Rules['scopeFrame'] | undefined {
  return outputRules.options.mixinOutputSlot?.scopeFrame;
}

export function getMixinOutputRulesVisibility(outputRules: Rules): RulesOptions['rulesVisibility'] | undefined {
  return outputRules.options.mixinOutputSlot?.rulesVisibility
    ?? outputRules.options.rulesVisibility;
}

export function getMixinOutputReferenceMode(outputRules: Rules): RulesOptions['referenceMode'] | undefined {
  return outputRules.options.mixinOutputSlot?.referenceMode
    ?? outputRules.options.referenceMode;
}

export function assignMixinOutputRuleIndexes(
  outputRules: Rules,
  isIndexedRuleChild: (node: Node) => boolean
): void {
  let outputRuleIndex = 0;
  for (const outputChild of outputRules.rules) {
    const sourceChild = getMixinOutputSourceChild(outputRules, outputChild) ?? outputChild;
    outputChild.index = isIndexedRuleChild(sourceChild)
      ? getMixinOutputRuleIndex(outputRules, outputChild, outputRuleIndex++)
      : undefined;
  }
}

export function markMixinOutputSource(
  outputRules: Rules,
  sourceRules: Rules
): void {
  outputRules.sourceNode = sourceRules.sourceNode ?? sourceRules;
}

export function assignMixinOutputFallbackFrame(
  outputRules: Rules,
  fallbackFrame: Rules['scopeFrame'] | undefined
): void {
  if (fallbackFrame) {
    outputRules.getScopeFrame().fallbackFrame = fallbackFrame;
  }
}

function validateMixinOutputSlot(slot: MixinOutputSlot): void {
  for (const segment of slot.childSegments) {
    if (slot.sourceRules.rules[segment.index] !== segment.source) {
      throw new TypeError('Mixin output slot source segment order mismatch');
    }
    if (segment.output && !slot.outputRules.rules.includes(segment.output)) {
      throw new TypeError('Mixin output slot references an output child outside its output Rules');
    }
  }
}

export function getRulesEntryVisibility(
  entry: RulesEntryLike,
  type: LookupVisibility
): Rules['options']['rulesVisibility'][string] | undefined {
  return entry.rulesVisibility?.[type]
    ?? getMixinOutputRulesVisibility(entry.node)?.[type]
    ?? entry.node.options.rulesVisibility?.[type];
}

export function getRulesEntryVisibilityParts(
  entry: RulesEntryLike,
  type: LookupVisibility
): RulesEntryVisibility {
  return {
    entry: entry.rulesVisibility?.[type],
    node: getMixinOutputRulesVisibility(entry.node)?.[type]
      ?? entry.node.options.rulesVisibility?.[type]
  };
}

export function isVisibleRulesEntry(
  entry: RulesEntryLike,
  type: LookupVisibility
): boolean {
  const visibility = getRulesEntryVisibility(entry, type);
  return visibility === 'public' || visibility === 'optional';
}

export function isPublicRulesEntry(
  entry: RulesEntryLike,
  type: LookupVisibility
): boolean {
  const visibility = getRulesEntryVisibilityParts(entry, type);
  return visibility.entry === 'public' || visibility.node === 'public';
}

export function isOptionalRulesEntry(
  entry: RulesEntryLike,
  type: LookupVisibility
): boolean {
  const visibility = getRulesEntryVisibilityParts(entry, type);
  return visibility.entry === 'optional' || visibility.node === 'optional';
}

export function blocksAmbientMixinOutputLookup(rules: Rules): boolean {
  const slot = rules.options?.mixinOutputSlot;
  if (slot) {
    return slot.ambientLookup !== true;
  }
  return false;
}

type SourceChainNode = {
  type?: string;
  options?: {
    mixinOutputSlot?: Pick<MixinOutputSlot, 'ambientLookup'>;
  };
  sourceNode?: unknown;
  parent?: unknown;
};

function isSourceChainNode(value: unknown): value is SourceChainNode {
  return value !== null && typeof value === 'object';
}

export function isFromRestrictedMixinOutput(node: unknown): boolean {
  const queue: unknown[] = [node];
  const seen = new Set<unknown>();
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (!isSourceChainNode(current) || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (current.type === 'Rules' && current.options?.mixinOutputSlot?.ambientLookup === false) {
      return true;
    }
    queue.push(current.sourceNode, current.parent);
  }
  return false;
}

export function keepsDuplicateMixinOutputDeclaration(node: unknown): boolean {
  return isFromRestrictedMixinOutput(node);
}

export function canEnterMixinOutputForLookup(
  entry: RulesEntryLike,
  lookup: {
    type?: LookupVisibility;
    hasTarget?: boolean;
  }
): boolean {
  // Lookup type visibility is checked by canEnterRulesEntryForLookup() or the
  // caller's isVisibleRulesEntry() guard. This helper only answers the mixin-output gate:
  // may this lookup enter generated output ambiently, or does it need a target?
  if (!entry.node.options?.mixinOutputSlot) {
    return true;
  }
  if (!blocksAmbientMixinOutputLookup(entry.node) || lookup.hasTarget === true) {
    return true;
  }
  return false;
}

export function canEnterRulesEntryForLookup(
  entry: RulesEntryLike,
  lookup: {
    type?: LookupVisibility;
    hasTarget?: boolean;
  }
): boolean {
  const { type, hasTarget } = lookup;
  if (blocksAmbientMixinOutputLookup(entry.node)) {
    return canEnterMixinOutputForLookup(entry, { type, hasTarget })
      && (type === undefined || isVisibleRulesEntry(entry, type));
  }
  return type !== undefined && isVisibleRulesEntry(entry, type);
}

export function getMixinOutputLookupState(
  entry: RulesEntryLike,
  lookup: {
    type?: LookupVisibility;
    hasTarget?: boolean;
  }
): MixinOutputLookupState | undefined {
  const slot = entry.node.options?.mixinOutputSlot;
  if (!slot) {
    return undefined;
  }
  const { type } = lookup;
  return {
    ambientLookup: slot.ambientLookup,
    canEnter: canEnterRulesEntryForLookup(entry, lookup),
    hasTarget: lookup.hasTarget === true,
    referenceMode: getMixinOutputReferenceMode(entry.node),
    ...(type ? { visibility: getRulesEntryVisibility(entry, type) } : {})
  };
}

export function attachMixinOutputSlot(
  outputRules: Rules,
  sourceRules: Rules,
  restrictAmbientLookup: boolean,
  options?: {
    fallbackFrame?: Rules['scopeFrame'];
    rulesetPlacement?: boolean;
  }
): MixinOutputSlot {
  const existingRulesetPlacement = outputRules.options.mixinOutputSlot?.rulesetPlacement;
  const childSegments = getMixinOutputChildSegments(sourceRules, outputRules);
  const sourceIndexByOutput = createSourceIndexByOutput(childSegments);
  const sourceByOutput = new Map<Node, Node>();
  const outputBySource = new Map<Node, Node>();
  for (let i = 0; i < childSegments.length; i++) {
    const segment = childSegments[i]!;
    if (segment.output) {
      sourceByOutput.set(segment.output, segment.source);
      outputBySource.set(segment.source, segment.output);
    }
  }
  const placementChildren = new Array<Node>(outputRules.rules.length);
  for (let i = 0; i < outputRules.rules.length; i++) {
    placementChildren[i] = outputRules.rules[i]!;
  }
  const slot: MixinOutputSlot = {
    sourceRules,
    outputRules,
    childSegments,
    sourceByOutput,
    outputBySource,
    sourceIndexByOutput,
    placementChildren,
    scopeFrame: outputRules.getScopeFrame(),
    ...(outputRules.options.rulesVisibility ? { rulesVisibility: outputRules.options.rulesVisibility } : {}),
    referenceMode: false,
    ambientLookup: !restrictAmbientLookup,
    ...(options?.fallbackFrame ? { fallbackFrame: options.fallbackFrame } : {}),
    ...(options?.rulesetPlacement
      ? { rulesetPlacement: createRulesetMixinPlacementRecord(sourceRules, outputRules, childSegments, sourceIndexByOutput) }
      : existingRulesetPlacement
        ? { rulesetPlacement: existingRulesetPlacement }
        : {})
  };
  validateMixinOutputSlot(slot);
  markMixinOutputSource(outputRules, sourceRules);
  outputRules.options.mixinOutputSlot = slot;
  outputRules.options.referenceMode = slot.referenceMode;
  assignMixinOutputFallbackFrame(outputRules, slot.fallbackFrame);
  return slot;
}
