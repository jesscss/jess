import type { IslandKind } from '../profiles/index.js';
import type {
  RawIslandNode,
  StructuralDocument,
  StructuralNode,
  StructuralStatementNode
} from '../structure/index.js';
import { IslandParsePlan } from './island-parse-plan.js';
import type { IslandParseRequestId, IslandTargetShape } from './types.js';

/** Import discovered from structural syntax only. */
export type IndexedImport = {
  node: StructuralStatementNode;
  specifier: string;
};

/** Variable declaration discovered from structural syntax only. */
export type IndexedVariable = {
  node: StructuralStatementNode;
  name: string;
};

/** Mixin definition/call plus lazy request ids for richer signatures. */
export type IndexedMixin = {
  node: StructuralNode;
  name: string;
  requestIds: readonly IslandParseRequestId[];
};

/** Extend candidate island queued for selector parsing. */
export type IndexedExtendCandidate = {
  island: RawIslandNode;
  requestId: IslandParseRequestId;
};

/** Value/reference island queued for target-shape parsing. */
export type IndexedReference = {
  island: RawIslandNode;
  requestId: IslandParseRequestId;
};

/** Counters for separating structural index work from lazy island fills. */
export type SemanticIndexCounters = {
  structuralIndexBuilds: number;
  lazyIndexFills: number;
  importCount: number;
  variableCount: number;
  mixinCount: number;
  extendCandidateCount: number;
  referenceCount: number;
};

/**
 * Builds semantic indexes from a structural document on demand.
 *
 * Structural indexes are filled independently from lazy island request indexes,
 * so consumers can ask for imports or variables without promoting selector and
 * value ASTs.
 */
export class SemanticIndexBuilder {
  readonly document: StructuralDocument;
  readonly plan: IslandParsePlan;
  readonly counters: SemanticIndexCounters = {
    structuralIndexBuilds: 0,
    lazyIndexFills: 0,
    importCount: 0,
    variableCount: 0,
    mixinCount: 0,
    extendCandidateCount: 0,
    referenceCount: 0
  };

  #imports: IndexedImport[] | undefined;
  #variables: IndexedVariable[] | undefined;
  #mixins: IndexedMixin[] | undefined;
  #extends: IndexedExtendCandidate[] | undefined;
  #references: IndexedReference[] | undefined;

  constructor(document: StructuralDocument, plan = new IslandParsePlan(document)) {
    this.document = document;
    this.plan = plan;
  }

  /** Returns imports, materialized from structural nodes on first access. */
  imports(): readonly IndexedImport[] {
    return (this.#imports ??= this.#buildImports());
  }

  /** Returns variables, materialized from structural nodes on first access. */
  variables(): readonly IndexedVariable[] {
    return (this.#variables ??= this.#buildVariables());
  }

  /** Returns mixin entries and request ids for richer signature parsing. */
  mixins(targetShape: IslandTargetShape = 'mixin-signature'): readonly IndexedMixin[] {
    return (this.#mixins ??= this.#buildMixins(targetShape));
  }

  /** Returns extend-candidate islands queued for lazy selector parsing. */
  extendCandidates(
    targetShape: IslandTargetShape = 'selector'
  ): readonly IndexedExtendCandidate[] {
    return (this.#extends ??= this.#buildIslandRequests(
      'extend-candidate',
      targetShape,
      'extendCandidateCount'
    ));
  }

  /** Returns reference islands queued for lazy value/reference parsing. */
  references(targetShape: IslandTargetShape = 'value-reference'): readonly IndexedReference[] {
    return (this.#references ??= this.#buildIslandRequests(
      'variable-reference',
      targetShape,
      'referenceCount'
    ));
  }

  #buildImports(): IndexedImport[] {
    this.counters.structuralIndexBuilds++;
    const imports: IndexedImport[] = [];
    walk(this.document.root, node => {
      if (node.kind === 'import') {
        imports.push({
          node,
          specifier: extractStringLiteral(this.document.source.slice(node.valueStart, node.valueEnd))
        });
      }
    });
    this.counters.importCount = imports.length;
    return imports;
  }

  #buildVariables(): IndexedVariable[] {
    this.counters.structuralIndexBuilds++;
    const variables: IndexedVariable[] = [];
    walk(this.document.root, node => {
      if (node.kind === 'variable-declaration') {
        variables.push({
          node,
          name: this.document.source.slice(node.nameStart, node.nameEnd)
        });
      }
    });
    this.counters.variableCount = variables.length;
    return variables;
  }

  #buildMixins(targetShape: IslandTargetShape): IndexedMixin[] {
    this.counters.structuralIndexBuilds++;
    const mixins: IndexedMixin[] = [];
    walk(this.document.root, node => {
      if (node.kind === 'mixin-definition' || node.kind === 'mixin-call') {
        mixins.push({
          node,
          name: nodeName(this.document, node),
          requestIds: this.plan.requestNode(node, targetShape)
        });
      }
    });
    this.counters.mixinCount = mixins.length;
    return mixins;
  }

  #buildIslandRequests<T extends IndexedExtendCandidate | IndexedReference>(
    islandKind: IslandKind,
    targetShape: IslandTargetShape,
    countKey: 'extendCandidateCount' | 'referenceCount'
  ): T[] {
    this.counters.lazyIndexFills++;
    const items = this.document.islands(islandKind).map(island => ({
      island,
      requestId: this.plan.requestIsland(island, targetShape)
    })) as T[];
    this.counters[countKey] = items.length;
    return items;
  }
}

function walk(node: StructuralNode, visit: (node: StructuralNode) => void): void {
  visit(node);
  if ('children' in node) {
    for (const child of node.children) {
      walk(child, visit);
    }
  }
}

function nodeName(document: StructuralDocument, node: StructuralNode): string {
  if ('headerStart' in node) {
    return document.source.slice(node.headerStart, node.headerEnd).trim();
  }
  if ('nameStart' in node) {
    return document.source.slice(node.nameStart, node.nameEnd).trim();
  }
  return node.kind;
}

function extractStringLiteral(text: string): string {
  const trimmed = text.trim();
  const quote = trimmed.charCodeAt(0);
  if (
    trimmed.length >= 2 &&
    (quote === Char.DoubleQuote || quote === Char.SingleQuote) &&
    trimmed.charCodeAt(trimmed.length - 1) === quote
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const enum Char {
  DoubleQuote = 34,
  SingleQuote = 39
}
