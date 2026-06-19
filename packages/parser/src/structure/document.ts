import type {
  ChangedRange,
  DocumentSymbol,
  FoldingRange,
  RawIslandNode,
  StructuralContainerNode,
  StructuralDocumentData,
  StructuralNode
} from './types.js';
import type { IslandKind, LanguageProfile } from '../profiles/index.js';
import type { ParserDiagnostic } from '../scanner/index.js';
import type { SourceText, TriviaRun } from '../source/index.js';

/**
 * Read-only facade over the scanner-first structural tree.
 *
 * The document owns diagnostics, trivia, and raw island indexes produced during
 * parsing; richer language ASTs are intentionally left to service plans. Query
 * methods operate on offsets and structural nodes only, so editor/index
 * consumers can use them without triggering island materialization.
 */
export class StructuralDocument {
  readonly source: SourceText;
  readonly profile: LanguageProfile;
  readonly root: StructuralContainerNode;
  readonly diagnostics: readonly ParserDiagnostic[];
  readonly trivia: readonly TriviaRun[];

  #islands: readonly RawIslandNode[];

  constructor(data: StructuralDocumentData) {
    this.source = data.source;
    this.profile = data.profile;
    this.root = data.root;
    this.diagnostics = data.diagnostics;
    this.trivia = data.trivia;
    this.#islands = data.islands;
  }

  /** Finds the deepest structural node whose range contains `offset`. */
  findNodeAt(offset: number): StructuralNode | undefined {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.source.length) {
      throw new RangeError(`Offset ${offset} is outside the source range.`);
    }
    return findDeepest(this.root, offset);
  }

  /** Returns the container chain from document root to the node at `offset`. */
  scopeAt(offset: number): readonly StructuralContainerNode[] {
    const scope: StructuralContainerNode[] = [];
    let node = this.findNodeAt(offset);

    while (node) {
      if ('children' in node) {
        scope.push(node);
      }
      node = node.parent;
    }

    return scope.reverse();
  }

  /** Produces foldable container ranges without materializing island ASTs. */
  foldingRanges(): readonly FoldingRange[] {
    const ranges: FoldingRange[] = [];
    walk(this.root, node => {
      if ('children' in node && node.kind !== 'document' && node.end > node.start) {
        ranges.push({ start: node.start, end: node.end });
      }
    });
    return ranges;
  }

  /** Produces coarse document symbols from structural names and headers. */
  symbols(): readonly DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];
    walk(this.root, node => {
      if (node.kind === 'document' || node.kind === 'raw-island' || node.kind === 'error') {
        return;
      }
      symbols.push({
        name: symbolName(this.source, node),
        kind: node.kind,
        start: node.start,
        end: node.end
      });
    });
    return symbols;
  }

  /** Returns all raw islands, optionally filtered by lazy parse kind. */
  islands(kind?: IslandKind): readonly RawIslandNode[] {
    return kind ? this.#islands.filter(island => island.islandKind === kind) : this.#islands;
  }

  /**
   * Computes one minimal changed range between two source snapshots.
   *
   * This is a structural invalidation aid, not a full text diff.
   */
  changedRanges(previousDocument: StructuralDocument): readonly ChangedRange[] {
    if (
      previousDocument.source.version === this.source.version &&
      previousDocument.source.text === this.source.text
    ) {
      return [];
    }

    const oldText = previousDocument.source.text;
    const newText = this.source.text;
    let start = 0;
    const commonLength = Math.min(oldText.length, newText.length);

    while (start < commonLength && oldText.charCodeAt(start) === newText.charCodeAt(start)) {
      start++;
    }

    let oldEnd = oldText.length;
    let newEnd = newText.length;

    while (
      oldEnd > start &&
      newEnd > start &&
      oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)
    ) {
      oldEnd--;
      newEnd--;
    }

    return [{ start, oldEnd, newEnd }];
  }
}

function findDeepest(node: StructuralNode, offset: number): StructuralNode | undefined {
  if (offset < node.start || offset > node.end) {
    return undefined;
  }

  if ('children' in node) {
    for (const child of node.children) {
      const found = findDeepest(child, offset);
      if (found) {
        return found;
      }
    }
  }

  return node;
}

function walk(node: StructuralNode, visit: (node: StructuralNode) => void): void {
  visit(node);
  if ('children' in node) {
    for (const child of node.children) {
      walk(child, visit);
    }
  }
}

function symbolName(source: SourceText, node: StructuralNode): string {
  if ('headerStart' in node) {
    return source.slice(node.headerStart, node.headerEnd).trim();
  }
  if ('nameStart' in node) {
    return source.slice(node.nameStart, node.nameEnd).trim();
  }
  return node.kind;
}
