import type { Node } from '../node.js';
import type { Rules, RulesOptions } from '../rules.js';

export type LookupVisibility = keyof NonNullable<RulesOptions['rulesVisibility']>;

export type RulesEntryLike = {
  node: Rules;
  rulesVisibility?: RulesOptions['rulesVisibility'];
};

export type RulesEntryVisibility = {
  entry?: Rules['options']['rulesVisibility'][string];
  node?: Rules['options']['rulesVisibility'][string];
};

export type MixinOutputSlot = {
  sourceRules: Rules;
  outputRules: Rules;
  childSegments: readonly MixinOutputChildSegment[];
  sourceByOutput: ReadonlyMap<Node, Node>;
  outputBySource: ReadonlyMap<Node, Node>;
  sourceIndexByOutput: ReadonlyMap<Node, number>;
  ambientLookup: boolean;
  fallbackFrame?: Rules['scopeFrame'];
  rulesetPlacement?: RulesetMixinPlacementRecord;
};

export type MixinOutputChildSegment = {
  kind: 'source-child';
  source: Node;
  output?: Node;
  index: number;
};

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
  return new Map(
    childSegments
      .filter((segment): segment is MixinOutputChildSegment & { output: Node } => segment.output !== undefined)
      .map(segment => [segment.output, segment.index])
  );
}

export function getMixinOutputChildSegments(
  sourceRules: Rules,
  outputRules?: Rules
): MixinOutputChildSegment[] {
  return sourceRules.value.map((source, index) => ({
    kind: 'source-child',
    source,
    ...(outputRules?.value[index] && { output: outputRules.value[index] }),
    index
  }));
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
  return outputRules.value
    .map(outputChild => slot.sourceByOutput.get(outputChild))
    .filter((source): source is Node => source !== undefined);
}

export function assignMixinOutputRuleIndexes(
  outputRules: Rules,
  isIndexedRuleChild: (node: Node) => boolean
): void {
  let outputRuleIndex = 0;
  for (const outputChild of outputRules.value) {
    const sourceChild = getMixinOutputSourceChild(outputRules, outputChild) ?? outputChild;
    const sourceIndex = getMixinOutputSourceIndex(outputRules, outputChild);
    Reflect.set(
      outputChild,
      'index',
      isIndexedRuleChild(sourceChild)
        ? sourceIndex ?? outputRuleIndex++
        : undefined
    );
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
    if (slot.sourceRules.value[segment.index] !== segment.source) {
      throw new TypeError('Mixin output slot source segment order mismatch');
    }
    if (segment.output && !slot.outputRules.value.includes(segment.output)) {
      throw new TypeError('Mixin output slot references an output child outside its output Rules');
    }
  }
}

export function getRulesEntryVisibility(
  entry: RulesEntryLike,
  type: LookupVisibility
): Rules['options']['rulesVisibility'][string] | undefined {
  return entry.rulesVisibility?.[type]
    ?? entry.node.options.rulesVisibility?.[type];
}

export function getRulesEntryVisibilityParts(
  entry: RulesEntryLike,
  type: LookupVisibility
): RulesEntryVisibility {
  return {
    entry: entry.rulesVisibility?.[type],
    node: entry.node.options.rulesVisibility?.[type]
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
  while (queue.length > 0) {
    const current = queue.shift();
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
  const slot: MixinOutputSlot = {
    sourceRules,
    outputRules,
    childSegments,
    sourceByOutput: new Map(
      childSegments
        .filter((segment): segment is MixinOutputChildSegment & { output: Node } => segment.output !== undefined)
        .map(segment => [segment.output, segment.source])
    ),
    outputBySource: new Map(
      childSegments
        .filter((segment): segment is MixinOutputChildSegment & { output: Node } => segment.output !== undefined)
        .map(segment => [segment.source, segment.output])
    ),
    sourceIndexByOutput,
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
  outputRules.options.referenceMode = false;
  assignMixinOutputFallbackFrame(outputRules, slot.fallbackFrame);
  return slot;
}
