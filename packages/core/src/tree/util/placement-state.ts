import type { Node } from '../node.js';

export type PlacementChildSegment<TSource extends Node = Node, TOutput extends Node = Node> = {
  kind: 'source-child';
  source: TSource;
  output?: TOutput;
  index: number;
};

export type PlacementRecord<TSource extends Node = Node, TOutput extends Node = Node> = {
  source: TSource;
  output: TOutput;
};

export function createPlacementChildSegment<TSource extends Node, TOutput extends Node>(
  source: TSource,
  output: TOutput | undefined,
  index: number
): PlacementChildSegment<TSource, TOutput> {
  return {
    kind: 'source-child',
    source,
    ...(output ? { output } : {}),
    index
  };
}
