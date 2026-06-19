import type { ParserDiagnostic } from '../scanner/index.js';
import type { SourceText, TriviaRun } from '../source/index.js';
import type { IslandKind, LanguageProfile } from '../profiles/index.js';

/**
 * Node kinds produced by the scanner-first structural parser.
 *
 * These nodes own source ranges and containment only; language-specific ASTs
 * are represented by `raw-island` promotion points.
 */
export type StructuralNodeKind =
  | 'at-rule'
  | 'block'
  | 'declaration'
  | 'document'
  | 'error'
  | 'import'
  | 'mixin-call'
  | 'mixin-definition'
  | 'raw-island'
  | 'rule'
  | 'variable-declaration';

/** Shared range and parent metadata for every structural node. */
export type StructuralNodeBase = {
  kind: StructuralNodeKind;
  start: number;
  end: number;
  parent?: StructuralContainerNode;
};

/** Container node whose children own nested structural ranges. */
export type StructuralContainerNode = StructuralNodeBase & {
  kind: 'at-rule' | 'block' | 'document' | 'mixin-definition' | 'rule';
  headerStart: number;
  headerEnd: number;
  children: StructuralNode[];
};

/** Leaf statement with name/value spans but no language-specific AST payload. */
export type StructuralStatementNode = StructuralNodeBase & {
  kind: 'declaration' | 'import' | 'mixin-call' | 'variable-declaration';
  nameStart: number;
  nameEnd: number;
  valueStart: number;
  valueEnd: number;
};

/**
 * Deferred parse target owned by the nearest structural node.
 *
 * Services use the owner relation to request richer ASTs lazily without copying
 * or materializing the whole document.
 */
export type RawIslandNode = StructuralNodeBase & {
  kind: 'raw-island';
  islandKind: IslandKind;
  owner: StructuralNode;
};

/** Error marker inserted into the structural tree at recovery boundaries. */
export type ErrorNode = StructuralNodeBase & {
  kind: 'error';
  diagnostic: ParserDiagnostic;
};

/** Union of all structural nodes emitted by the scanner-first pass. */
export type StructuralNode =
  | StructuralContainerNode
  | StructuralStatementNode
  | RawIslandNode
  | ErrorNode;

/** Half-open range suitable for editor folding. */
export type FoldingRange = {
  start: number;
  end: number;
};

/** Coarse symbol emitted from structural names and headers. */
export type DocumentSymbol = {
  name: string;
  kind: StructuralNodeKind;
  start: number;
  end: number;
};

/** One changed source window between two structural document snapshots. */
export type ChangedRange = {
  start: number;
  oldEnd: number;
  newEnd: number;
};

/** Scanner options that affect trivia ownership but not language semantics. */
export type ParseStructureOptions = {
  lineComments?: boolean;
};

/** Parser input accepted by `parseStructure`. */
export type ParseStructureInput = SourceText | string;

/** Constructor data for an immutable `StructuralDocument` facade. */
export type StructuralDocumentData = {
  source: SourceText;
  profile: LanguageProfile;
  root: StructuralContainerNode;
  diagnostics: ParserDiagnostic[];
  trivia: TriviaRun[];
  islands: RawIslandNode[];
};
