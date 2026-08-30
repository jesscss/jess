/**
 * Types for `materialize-css-corpus.mjs`.
 *
 * The materializer stays plain `.mjs` so it runs under bare `node` with no
 * build step — `pnpm install` and a fresh worktree both need it before anything
 * is compiled. This declaration is what lets `test/css-corpus/corpus.test.ts`
 * consume it without an `any` crossing the boundary.
 */

/** Entry count each source must yield, asserted by `buildManifest`. */
export declare const EXPECTED_ENTRIES: Readonly<Record<string, number>>;

export type CorpusEntry = {
  /** Stable, unique across the whole corpus. */
  readonly id: string;
  /** A COMPLETE stylesheet — fragments are wrapped by the loader. */
  readonly source: string;
  /** The un-wrapped upstream text, when the entry was a fragment. */
  readonly raw?: string;
  readonly expect: 'accept' | 'reject';
  /** The upstream grammar production the case was written against. */
  readonly context: string;
  readonly source_name: string;
  /** Upstream file and case name, for attribution and triage. */
  readonly origin: string;
};

export type CorpusManifest = {
  readonly total: number;
  readonly accept: number;
  readonly reject: number;
  readonly sources: Readonly<Record<string, {
    readonly entries: number;
    readonly skipped: Readonly<Record<string, number>>;
    readonly commit?: string;
    readonly license?: string;
  }>>;
  readonly entries: readonly CorpusEntry[];
};

/** Throws if any source is missing, unresolvable, or the wrong size. */
export declare function buildManifest(): CorpusManifest;
