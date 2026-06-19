import type { IslandKind } from '../profiles/index.js';
import type { ParserDiagnostic } from '../scanner/index.js';
import type {
  RawIslandNode,
  StructuralDocument,
  StructuralNode
} from '../structure/index.js';

/** Provider-selected result shape, such as selector AST or value-reference. */
export type IslandTargetShape = string;

/** JSON-stable provider configuration used as part of island cache keys. */
export type ParserConfigKey =
  | string
  | number
  | boolean
  | null
  | readonly ParserConfigKey[]
  | { readonly [key: string]: ParserConfigKey };

/** Lookup key for a provider that can parse one kind of island. */
export type IslandProviderKey = {
  language: string;
  islandKind: IslandKind;
  targetShape: IslandTargetShape;
  parserConfigKey?: ParserConfigKey;
};

/** Numeric id allocated by `IslandParsePlan` for stable deferred requests. */
export type IslandParseRequestId = number;

/** Stable view of a deferred parse request for a raw island. */
export type IslandParseRequest = IslandProviderKey & {
  id: IslandParseRequestId;
  sourceVersion: string | number;
  start: number;
  end: number;
  cacheKey: string;
};

/**
 * Mutable context passed to island providers.
 *
 * The plan may reuse the object between executions; providers must read it
 * during the call and not retain it as long-lived state.
 */
export type IslandExecutionContext = {
  document: StructuralDocument;
  island: RawIslandNode;
  requestId: IslandParseRequestId;
  diagnostics: ParserDiagnostic[];
};

/** Provider result for one island parse, including diagnostics and fallback. */
export type IslandParseResult<T = unknown> = {
  value?: T;
  diagnostics?: readonly ParserDiagnostic[];
  fallbackFullTree?: boolean;
};

/** Function that promotes one raw island into a requested target shape. */
export type IslandParserProvider<T = unknown> = (
  context: IslandExecutionContext
) => IslandParseResult<T>;

/** Cached execution record for one island request. */
export type IslandExecutionRecord<T = unknown> = {
  requestId: IslandParseRequestId;
  cacheKey: string;
  value?: T;
  diagnostics: readonly ParserDiagnostic[];
  fallbackFullTree: boolean;
};

/**
 * Counters that separate planning, cache behavior, and real materialization.
 *
 * They are instrumentation for tests and diagnostics, not proof of runtime
 * speed without separate benchmark evidence.
 */
export type IslandParseCounters = {
  requestIds: number;
  requestViews: number;
  cacheHits: number;
  cacheMisses: number;
  actualParses: number;
  promotedBytes: number;
  fallbackFullTreeMaterializations: number;
  structuralOnlyQueries: number;
  visitorPlans: number;
};

/** Visitor planning rule that states which island kinds need promotion. */
export type VisitorMaterializationRule = {
  nodeKind: StructuralNode['kind'];
  islandKinds?: readonly IslandKind[];
  targetShape: IslandTargetShape;
};

/** Declarative visitor request used to avoid eagerly parsing every island. */
export type VisitorShape = {
  nodeKinds?: readonly StructuralNode['kind'][];
  islandKinds?: readonly IslandKind[];
  targetShape?: IslandTargetShape;
};
