import type { IslandKind } from '../profiles/index.js';
import type { ParserDiagnostic } from '../scanner/index.js';
import type {
  RawIslandNode,
  StructuralDocument,
  StructuralNode
} from '../structure/index.js';

/**
 * Provider-selected result shape, such as selector AST or value-reference.
 *
 * The same island kind may support several target shapes; the target shape is
 * part of the provider/cache key so visitors only promote the data they need.
 */
export type IslandTargetShape = string;

/**
 * JSON-stable provider configuration used as part of island cache keys.
 *
 * Parser packages should keep this small and deterministic; it is intended for
 * language modes/options, not large compiler objects.
 */
export type ParserConfigKey =
  | string
  | number
  | boolean
  | null
  | readonly ParserConfigKey[]
  | { readonly [key: string]: ParserConfigKey };

/**
 * Lookup key for a provider that can parse one kind of island.
 *
 * Providers are language-owned. The shared registry only matches keys and does
 * not know about compiler AST classes.
 */
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

/**
 * Provider result for one island parse, including diagnostics and fallback.
 *
 * `fallbackFullTree` is a signal to the caller that this local promotion cannot
 * preserve semantics and the current compiler parser should own the file.
 */
export type IslandParseResult<T = unknown> = {
  value?: T;
  diagnostics?: readonly ParserDiagnostic[];
  fallbackFullTree?: boolean;
};

/**
 * Function that promotes one raw island into a requested target shape.
 *
 * Providers should parse only `context.island` and avoid materializing sibling
 * islands unless they deliberately return `fallbackFullTree`.
 */
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

/**
 * Visitor planning rule that states which island kinds need promotion.
 *
 * Adapter layers can derive these rules from registered visitor methods so
 * traversal promotes only the structural node families a visitor can observe.
 */
export type VisitorMaterializationRule = {
  nodeKind: StructuralNode['kind'];
  islandKinds?: readonly IslandKind[];
  targetShape: IslandTargetShape;
};

/**
 * Declarative visitor request used to avoid eagerly parsing every island.
 *
 * A broad visitor may produce broad rules, but the plan still requests islands
 * as traversal reaches matching structural nodes.
 */
export type VisitorShape = {
  nodeKinds?: readonly StructuralNode['kind'][];
  islandKinds?: readonly IslandKind[];
  targetShape?: IslandTargetShape;
};
