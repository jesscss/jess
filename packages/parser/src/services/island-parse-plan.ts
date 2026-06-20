import type { ParserDiagnostic } from '../scanner/index.js';
import type {
  RawIslandNode,
  StructuralDocument,
  StructuralNode
} from '../structure/index.js';
import { requestCacheKey } from './keys.js';
import { IslandParserRegistry, providerKey } from './registry.js';
import type {
  IslandExecutionContext,
  IslandExecutionRecord,
  IslandParseCounters,
  IslandParseRequest,
  IslandParseRequestId,
  IslandProviderKey,
  IslandTargetShape,
  ParserConfigKey,
  VisitorMaterializationRule,
  VisitorShape
} from './types.js';

/**
 * Coordinates lazy parsing of raw structural islands.
 *
 * Requests are deduplicated by language, island kind, target shape, parser
 * config, source version, and span. Actual provider work happens only when
 * `execute` is called.
 */
export class IslandParsePlan {
  readonly document: StructuralDocument;
  readonly registry: IslandParserRegistry;

  readonly counters: IslandParseCounters = {
    requestIds: 0,
    requestViews: 0,
    cacheHits: 0,
    cacheMisses: 0,
    actualParses: 0,
    promotedBytes: 0,
    fallbackFullTreeMaterializations: 0,
    structuralOnlyQueries: 0,
    visitorPlans: 0,
    visitorPlanCacheHits: 0,
    visitorPlanCacheMisses: 0,
    visitorTraversalRequests: 0,
    visitorMaterializedNodeRequests: 0,
    visitorPromotedIslandRequests: 0,
    visitorAdapterNodeRequests: 0,
    visitorReplacementRequests: 0
  };

  #requestIds = new Map<string, IslandParseRequestId>();
  #requestKeys: string[] = [];
  #providerKeys: IslandProviderKey[] = [];
  #islandsByRequest: RawIslandNode[] = [];
  #islandsByOwner = new Map<StructuralNode, RawIslandNode[]>();
  #requests = new Map<IslandParseRequestId, IslandParseRequest>();
  #executions = new Map<string, IslandExecutionRecord>();
  #diagnostics = new Map<IslandParseRequestId, readonly ParserDiagnostic[]>();
  #visitorPlans = new Map<string, readonly VisitorMaterializationRule[]>();
  #reusableContext: IslandExecutionContext;

  constructor(document: StructuralDocument, registry = new IslandParserRegistry()) {
    this.document = document;
    this.registry = registry;
    this.#reusableContext = {
      document,
      island: document.islands()[0] ?? (undefined as never),
      requestId: 0,
      diagnostics: []
    };
    for (const island of document.islands()) {
      const ownedIslands = this.#islandsByOwner.get(island.owner);
      if (ownedIslands) {
        ownedIslands.push(island);
      } else {
        this.#islandsByOwner.set(island.owner, [island]);
      }
    }
  }

  /** Allocates or reuses a stable request id for one raw island. */
  requestIsland(
    island: RawIslandNode,
    targetShape: IslandTargetShape,
    parserConfigKey?: ParserConfigKey
  ): IslandParseRequestId {
    const key = this.#providerKey(island, targetShape, parserConfigKey);
    const cacheKey = requestCacheKey(
      key,
      this.document.source.version,
      island.start,
      island.end
    );
    const existing = this.#requestIds.get(cacheKey);
    if (existing !== undefined) {
      return existing;
    }

    const id = this.#requestKeys.length;
    this.#requestKeys.push(cacheKey);
    this.#providerKeys.push(key);
    this.#islandsByRequest.push(island);
    this.#requestIds.set(cacheKey, id);
    this.counters.requestIds++;
    return id;
  }

  /**
   * Requests every island owned by a structural node.
   *
   * Nodes without island ownership remain structural-only and increment the
   * corresponding counter instead of forcing materialization.
   */
  requestNode(
    node: StructuralNode,
    targetShape: IslandTargetShape,
    parserConfigKey?: ParserConfigKey
  ): readonly IslandParseRequestId[] {
    if (node.kind === 'raw-island') {
      return [this.requestIsland(node, targetShape, parserConfigKey)];
    }

    const ids = (this.#islandsByOwner.get(node) ?? []).map(island =>
      this.requestIsland(island, targetShape, parserConfigKey)
    );

    if (ids.length === 0) {
      this.counters.structuralOnlyQueries++;
    }

    return ids;
  }

  /** Lazily decodes the public request view for a stable request id. */
  requestView(id: IslandParseRequestId): IslandParseRequest {
    const cached = this.#requests.get(id);
    if (cached) {
      return cached;
    }

    const cacheKey = this.#requestKeys[id];
    if (cacheKey === undefined) {
      throw new RangeError(`Unknown island parse request id ${id}.`);
    }

    const request = decodeRequestCacheKey(cacheKey, id);
    this.#requests.set(id, request);
    this.counters.requestViews++;
    return request;
  }

  /**
   * Runs the provider for a request or records full-tree fallback.
   *
   * A missing provider is not an exceptional parse failure; it marks the request
   * as requiring a broader parser/materializer owned by the caller.
   */
  execute<T = unknown>(id: IslandParseRequestId): IslandExecutionRecord<T> {
    const request = this.requestView(id);
    const cached = this.#executions.get(request.cacheKey);
    if (cached) {
      this.counters.cacheHits++;
      return cached as IslandExecutionRecord<T>;
    }

    this.counters.cacheMisses++;
    const island = this.#islandForRequest(request);
    const providerKey = this.#providerKeys[id];
    if (!providerKey) {
      throw new RangeError(`No provider key found for request ${id}.`);
    }
    const provider = this.registry.get(providerKey);
    const diagnostics: ParserDiagnostic[] = [];

    if (!provider) {
      const record: IslandExecutionRecord<T> = {
        requestId: id,
        cacheKey: request.cacheKey,
        diagnostics,
        fallbackFullTree: true
      };
      this.counters.fallbackFullTreeMaterializations++;
      this.#executions.set(request.cacheKey, record);
      this.#diagnostics.set(id, diagnostics);
      return record;
    }

    this.#reusableContext.document = this.document;
    this.#reusableContext.island = island;
    this.#reusableContext.requestId = id;
    this.#reusableContext.diagnostics = diagnostics;

    const result = provider(this.#reusableContext);
    if (result.diagnostics) {
      diagnostics.push(...result.diagnostics);
    }

    const record: IslandExecutionRecord<T> = {
      requestId: id,
      cacheKey: request.cacheKey,
      value: result.value as T,
      diagnostics,
      fallbackFullTree: result.fallbackFullTree ?? false
    };
    this.counters.actualParses++;
    this.counters.promotedBytes += island.end - island.start;
    if (record.fallbackFullTree) {
      this.counters.fallbackFullTreeMaterializations++;
    }
    this.#executions.set(request.cacheKey, record);
    this.#diagnostics.set(id, diagnostics);
    return record;
  }

  /** Returns diagnostics captured during execution, if the request has run. */
  diagnosticsFor(id: IslandParseRequestId): readonly ParserDiagnostic[] {
    return this.#diagnostics.get(id) ?? [];
  }

  /**
   * Converts a visitor shape into materialization rules without executing them.
   */
  planVisitor(shape: VisitorShape): readonly VisitorMaterializationRule[] {
    this.counters.visitorPlans++;
    const cacheKey = visitorShapeCacheKey(shape);
    const cached = this.#visitorPlans.get(cacheKey);
    if (cached) {
      this.counters.visitorPlanCacheHits++;
      return cached;
    }

    this.counters.visitorPlanCacheMisses++;
    if (shape.materializationRules) {
      this.#visitorPlans.set(cacheKey, shape.materializationRules);
      return shape.materializationRules;
    }

    const nodeKinds = shape.nodeKinds ?? [];
    const islandKinds = shape.islandKinds ?? [];
    const targetShape = shape.targetShape ?? 'visitor';
    const rules: VisitorMaterializationRule[] = [];

    for (const nodeKind of nodeKinds) {
      rules.push({ nodeKind, islandKinds, targetShape });
    }

    if (nodeKinds.length === 0 && islandKinds.length > 0) {
      rules.push({ nodeKind: 'raw-island', islandKinds, targetShape });
    }

    this.#visitorPlans.set(cacheKey, rules);
    return rules;
  }

  /**
   * Requests only the islands a planned visitor can observe at one node.
   *
   * Traversal owns when this is called; the plan only maps the reached
   * structural node to matching island requests. This keeps broad visitors
   * demand-driven: a generic `visit()` may produce broad rules, but unrelated
   * sibling islands are not promoted until traversal reaches their owner.
   */
  requestVisitorNode(
    node: StructuralNode,
    rules: readonly VisitorMaterializationRule[]
  ): readonly IslandParseRequestId[] {
    this.counters.visitorTraversalRequests++;
    let ids: IslandParseRequestId[] | undefined;
    let requestedAdapterNode = false;

    for (const rule of rules) {
      if (rule.nodeKind !== node.kind) {
        continue;
      }
      const ruleIds = this.#requestVisitorRuleNode(node, rule);
      if (ruleIds.length === 0) {
        continue;
      }
      ids ??= [];
      for (const id of ruleIds) {
        if (!ids.includes(id)) {
          ids.push(id);
        }
      }
      requestedAdapterNode ||= rule.targetShape.includes('adapter');
    }

    if (!ids?.length) {
      return [];
    }

    this.counters.visitorMaterializedNodeRequests++;
    this.counters.visitorPromotedIslandRequests += ids.length;
    if (requestedAdapterNode) {
      this.counters.visitorAdapterNodeRequests++;
    }
    return ids;
  }

  #requestVisitorRuleNode(
    node: StructuralNode,
    rule: VisitorMaterializationRule
  ): readonly IslandParseRequestId[] {
    const islandKinds = rule.islandKinds ?? [];
    if (islandKinds.length === 0) {
      return [];
    }
    if (node.kind === 'raw-island') {
      return islandKinds.includes(node.islandKind)
        ? [this.requestIsland(node, rule.targetShape)]
        : [];
    }

    const ownedIslands = this.#islandsByOwner.get(node);
    if (!ownedIslands?.length) {
      return [];
    }

    let ids: IslandParseRequestId[] | undefined;
    for (const island of ownedIslands) {
      if (!islandKinds.includes(island.islandKind)) {
        continue;
      }
      ids ??= [];
      ids.push(this.requestIsland(island, rule.targetShape));
    }
    return ids ?? [];
  }

  #providerKey(
    island: RawIslandNode,
    targetShape: IslandTargetShape,
    parserConfigKey?: ParserConfigKey
  ): IslandProviderKey {
    return providerKey(
      this.document.profile.name,
      island.islandKind,
      targetShape,
      parserConfigKey
    );
  }

  #islandForRequest(request: IslandParseRequest): RawIslandNode {
    const island = this.#islandsByRequest[request.id];
    if (!island) {
      throw new RangeError(`No island found for request ${request.id}.`);
    }
    return island;
  }
}

function visitorShapeCacheKey(shape: VisitorShape): string {
  return JSON.stringify({
    islandKinds: [...(shape.islandKinds ?? [])].sort(),
    materializationRules: [...(shape.materializationRules ?? [])]
      .map(rule => ({
        islandKinds: [...(rule.islandKinds ?? [])].sort(),
        nodeKind: rule.nodeKind,
        targetShape: rule.targetShape
      }))
      .sort((a, b) => (
        a.nodeKind === b.nodeKind
          ? (
            a.targetShape === b.targetShape
              ? a.islandKinds.join(',').localeCompare(b.islandKinds.join(','))
              : a.targetShape.localeCompare(b.targetShape)
          )
          : a.nodeKind.localeCompare(b.nodeKind)
      )),
    nodeKinds: [...(shape.nodeKinds ?? [])].sort(),
    targetShape: shape.targetShape ?? 'visitor'
  });
}

/** Reconstructs a request view from the cache key used for deduplication. */
function decodeRequestCacheKey(
  cacheKey: string,
  id: IslandParseRequestId
): IslandParseRequest {
  const [language, islandKind, targetShape, parserConfigKey, sourceVersion, start, end] =
    cacheKey.split('|');

  if (
    language === undefined ||
    islandKind === undefined ||
    targetShape === undefined ||
    sourceVersion === undefined ||
    start === undefined ||
    end === undefined
  ) {
    throw new RangeError(`Invalid island parse cache key ${cacheKey}.`);
  }

  return {
    id,
    language,
    islandKind: islandKind as IslandParseRequest['islandKind'],
    targetShape,
    parserConfigKey,
    sourceVersion,
    start: Number(start),
    end: Number(end),
    cacheKey
  };
}
