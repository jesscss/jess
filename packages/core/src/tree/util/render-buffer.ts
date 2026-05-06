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
export function createRenderBuffer(kind: RenderBuffer['kind']): RenderBuffer {
  return kind === 'flat'
    ? { kind, parts: [] }
    : { kind, segments: [], extendRecords: [] };
}

export function createRenderBufferForFlags(flags: RenderBufferFlags): RenderBuffer {
  return createRenderBuffer(flags.hasExtends || flags.hasReferenceImports ? 'segmented' : 'flat');
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
