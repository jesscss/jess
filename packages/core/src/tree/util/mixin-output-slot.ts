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
  rulesVisibility: Rules['options']['rulesVisibility'];
  isMixinOutput: boolean;
};

export type MixinOutputChildSegment = {
  kind: 'source-child';
  source: Node;
  output?: Node;
  index: number;
};

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
  const segments = outputRules.options.mixinOutputSlot?.childSegments;
  if (!segments) {
    return undefined;
  }
  return segments.find(segment => segment.output === outputChild)?.source;
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

export function isMixinOutputRules(rules: Rules): boolean {
  return rules.options?.mixinOutputSlot?.isMixinOutput
    ?? rules.options?.isMixinOutput === true;
}

export function canSearchMixinOutputRules(
  rules: Rules,
  hasTarget: boolean | undefined
): boolean {
  return !isMixinOutputRules(rules) || hasTarget === true;
}

export function canSearchRulesEntry(
  entry: RulesEntryLike,
  type: LookupVisibility | undefined,
  hasTarget: boolean | undefined
): boolean {
  if (isMixinOutputRules(entry.node)) {
    return hasTarget === true;
  }
  return type !== undefined && isVisibleRulesEntry(entry, type);
}

export function attachMixinOutputSlot(
  outputRules: Rules,
  sourceRules: Rules,
  isMixinOutput: boolean
): MixinOutputSlot {
  const slot: MixinOutputSlot = {
    sourceRules,
    outputRules,
    childSegments: getMixinOutputChildSegments(sourceRules, outputRules),
    rulesVisibility: outputRules.options.rulesVisibility,
    isMixinOutput
  };
  validateMixinOutputSlot(slot);
  outputRules.options.mixinOutputSlot = slot;
  outputRules.options.isMixinOutput = isMixinOutput;
  return slot;
}
