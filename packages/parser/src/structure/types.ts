import type { ParserDiagnostic } from '../scanner/index.js';
import type { SourceText, TriviaRun } from '../source/index.js';
import type { IslandKind, LanguageProfile } from '../profiles/index.js';
import type { FieldRangeTable } from './field-ranges.js';

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

/**
 * Shared range and parent metadata for every structural node.
 *
 * Ranges are source-owned half-open offsets. Parent links describe structural
 * containment only and do not imply compiler AST parentage.
 */
export type StructuralNodeBase = {
  kind: StructuralNodeKind;
  start: number;
  end: number;
  parent?: StructuralContainerNode;
};

/**
 * Container node whose children own nested structural ranges.
 *
 * `headerStart`/`headerEnd` identify the pre-block header that can later be
 * promoted as selector, at-rule prelude, mixin signature, or another provider
 * target without parsing the body.
 */
export type StructuralContainerNode = StructuralNodeBase & {
  kind: 'at-rule' | 'block' | 'document' | 'mixin-definition' | 'rule';
  headerStart: number;
  headerEnd: number;
  bodyStart: number;
  children: StructuralNode[];
};

/**
 * Leaf statement with name/value spans but no language-specific AST payload.
 *
 * Consumers that only need indexing can read these offsets directly; consumers
 * that need expression/value ASTs should request the corresponding raw island.
 */
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

/** Cold structural parser report used by performance guard tests. */
export type StructuralDocumentStats = {
  readonly sourceBytes: number;
  readonly structuralRecords: number;
  readonly recordsPerInputByte: number;
  readonly maxBlockDepth: number;
  readonly diagnostics: number;
  readonly rawIslands: number;
  readonly triviaRanges: number;
  readonly changedRanges?: number;
};

/**
 * Scanner options that affect trivia ownership but not language semantics.
 *
 * Language packages choose these options when they expose structural parse
 * entrypoints; changing them should not alter compiler AST behavior.
 */
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
  fieldRanges: FieldRangeTable<StructuralNode>;
};
