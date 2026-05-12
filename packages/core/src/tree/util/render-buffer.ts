import type { Context } from '../../context.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { prepareRenderPrintState, type PrintOptions } from './print.js';

export type RenderBufferNode = {
  resolve(context: Context): MaybePromise<RenderableOutput>;
};

export type RenderableOutput = {
  type?: string;
  toTrimmedString(options?: PrintOptions): string;
};

type RootRenderableOutput = RenderableOutput & {
  type: 'Rules';
  toString(options?: PrintOptions): string;
};

export type SelectorRef = {
  valueOf(): string;
};

export type ExtendRootRef = object;

export type Segment =
  | string
  | RulesetBlock
  | HoistBlock
  | MergeSlot
  | PendingRefSlot;

export type RenderBuffer = FlatRenderBuffer | SegmentedRenderBuffer;

export type RenderBufferFlags = {
  hasExtends?: boolean;
  hasReferenceImports?: boolean;
  hasHoists?: boolean;
  hasMerges?: boolean;
  hasPendingRefs?: boolean;
};

export type FlatRenderBuffer = {
  kind: 'flat';
  parts: string[];
};

export type SegmentedRenderBuffer = {
  kind: 'segmented';
  segments: Segment[];
  extendRecords: ExtendRecord[];
};

export type RulesetBlock = {
  kind: 'ruleset';
  selector: SelectorRef;
  body: Segment[];
  isReference: boolean;
  extendRoot?: ExtendRootRef;
};

export type HoistBlock = {
  kind: 'hoist';
  atRule: string;
  selectorContext?: SelectorRef;
  body: Segment[];
};

export type MergeSlot = {
  kind: 'merge';
  property: string;
  separator: string;
  segments: Segment[];
};

export type PendingRefSlot = {
  kind: 'pending-ref';
  key: string;
  segments: Segment[];
};

export type ExtendRecord = {
  targetSelector: SelectorRef;
  extendRoot?: ExtendRootRef;
  sourceBlock: RulesetBlock;
};

type FinalizeChildren = (segments: readonly Segment[]) => string;

export type SegmentFinalizers = {
  ruleset(block: RulesetBlock, children: FinalizeChildren): string;
  hoist(block: HoistBlock, children: FinalizeChildren): string;
  merge(slot: MergeSlot, children: FinalizeChildren): string;
  pendingRef(slot: PendingRefSlot, children: FinalizeChildren): string;
};

export function createRenderBuffer(kind: 'flat'): FlatRenderBuffer;
export function createRenderBuffer(kind: 'segmented'): SegmentedRenderBuffer;
export function createRenderBuffer(kind: RenderBuffer['kind']): RenderBuffer;
export function createRenderBuffer(kind: RenderBuffer['kind']): RenderBuffer {
  return kind === 'flat'
    ? { kind, parts: [] }
    : { kind, segments: [], extendRecords: [] };
}

export function createRenderBufferForFlags(flags: RenderBufferFlags): RenderBuffer {
  return createRenderBuffer(
    flags.hasExtends
    || flags.hasReferenceImports
    || flags.hasHoists
    || flags.hasMerges
    || flags.hasPendingRefs
      ? 'segmented'
      : 'flat'
  );
}

export function isRenderBuffer(value: unknown): value is RenderBuffer {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }
  const { kind } = value as { kind?: unknown };
  return kind === 'flat' || kind === 'segmented';
}

export function writeRenderText(buffer: RenderBuffer, text: string): void {
  if (text === '') {
    return;
  }
  if (buffer.kind === 'flat') {
    buffer.parts.push(text);
    return;
  }
  buffer.segments.push(text);
}

export function createSegmentBody(): Segment[] {
  return [];
}

export function writeSegmentText(segments: Segment[], text: string): void {
  if (text !== '') {
    segments.push(text);
  }
}

export function createRulesetBlock(args: Omit<RulesetBlock, 'kind' | 'body'> & { body?: Segment[] }): RulesetBlock {
  return {
    kind: 'ruleset',
    body: args.body ?? createSegmentBody(),
    selector: args.selector,
    isReference: args.isReference,
    extendRoot: args.extendRoot
  };
}

export function createHoistBlock(args: Omit<HoistBlock, 'kind' | 'body'> & { body?: Segment[] }): HoistBlock {
  return {
    kind: 'hoist',
    body: args.body ?? createSegmentBody(),
    atRule: args.atRule,
    selectorContext: args.selectorContext
  };
}

export function createMergeSlot(args: Omit<MergeSlot, 'kind' | 'segments'> & { segments?: Segment[] }): MergeSlot {
  return {
    kind: 'merge',
    segments: args.segments ?? createSegmentBody(),
    property: args.property,
    separator: args.separator
  };
}

export function createPendingRefSlot(args: Omit<PendingRefSlot, 'kind' | 'segments'> & { segments?: Segment[] }): PendingRefSlot {
  return {
    kind: 'pending-ref',
    segments: args.segments ?? createSegmentBody(),
    key: args.key
  };
}

export function renderNodeToBuffer(
  node: RenderBufferNode,
  context: Context,
  buffer: RenderBuffer,
  options?: PrintOptions
): MaybePromise<string> {
  const rendered = renderNodeToString(node, context, options);
  const writeRendered = (text: string): string => {
    writeRenderText(buffer, text);
    return text;
  };
  return isThenable(rendered)
    ? rendered.then(writeRendered)
    : writeRendered(rendered);
}

export function renderNodeToString(
  node: RenderBufferNode,
  context: Context,
  options?: PrintOptions
): MaybePromise<string> {
  // Track 5 bridge only: this adapts current node serializers to evaluated
  // string output. Nodes with delayed-output semantics must write explicit
  // segments instead of growing a second AST.
  const prepared = prepareRenderPrintState(context, options);
  const writeResolved = (resolved: RenderableOutput): string => {
    if (isRootRulesOutput(node, resolved, context)) {
      return resolved.toString(prepared);
    }
    return resolved.toTrimmedString(prepared);
  };
  const resolved = node.resolve(context);
  return isThenable(resolved)
    ? (resolved as Promise<RenderableOutput>).then(writeResolved)
    : writeResolved(resolved);
}

function isRootRulesOutput(
  node: RenderBufferNode,
  resolved: RenderableOutput,
  context: Context
): resolved is RootRenderableOutput {
  return resolved.type === 'Rules'
    && (resolved === context.root || node === context.root)
    && hasCallableToString(resolved);
}

function hasCallableToString(value: RenderableOutput): value is RenderableOutput & { toString(options?: PrintOptions): string } {
  return 'toString' in value && typeof value.toString === 'function';
}

export function pushRenderSegment(buffer: SegmentedRenderBuffer, segment: Exclude<Segment, string>): void {
  buffer.segments.push(segment);
}

export function addExtendRecord(buffer: SegmentedRenderBuffer, record: ExtendRecord): void {
  buffer.extendRecords.push(record);
}

export function finalizeRenderBuffer(buffer: RenderBuffer, finalizers: SegmentFinalizers): string {
  return buffer.kind === 'flat'
    ? buffer.parts.join('')
    : finalizeSegments(buffer.segments, finalizers);
}

export function finalizeSegments(segments: readonly Segment[], finalizers: SegmentFinalizers): string {
  let out = '';
  const finalizeChildren: FinalizeChildren = childSegments => finalizeSegments(childSegments, finalizers);

  for (const segment of segments) {
    if (typeof segment === 'string') {
      out += segment;
      continue;
    }

    if (segment.kind === 'ruleset') {
      out += finalizers.ruleset(segment, finalizeChildren);
    } else if (segment.kind === 'hoist') {
      out += finalizers.hoist(segment, finalizeChildren);
    } else if (segment.kind === 'merge') {
      out += finalizers.merge(segment, finalizeChildren);
    } else {
      out += finalizers.pendingRef(segment, finalizeChildren);
    }
  }

  return out;
}
