/**
 * Context-owned request facts for a stylesheet or module import.
 *
 * These select plugin dispatch and import behavior. Legacy tree-only placement
 * data intentionally lives with the legacy import implementation instead.
 */
export interface ImportOptions {
  /** Select a parser/module plugin instead of extension routing. */
  type?: string;

  /** Resolved rules are available for lookup but omitted from output. */
  reference?: boolean;
  optional?: boolean;
  inline?: boolean;

  /**
   * The import has no CSS meaning, so it can never stay a CSS `@import`:
   * `(inline)`, `(reference)`, `(less)`, `@-import`, `@compose`. An external
   * specifier no plugin claims is then an error rather than a CSS terminal.
   */
  mustLoad?: boolean;

  /** Retain repeated imports rather than the default once behavior. */
  multiple?: boolean;

  /** Permit extends to cross this import boundary. */
  mutable?: boolean;

  /** Sass forwarding and member-filter facts. */
  forward?: boolean;
  forwardAsPrefix?: string;
  forwardShow?: string[];
  forwardHide?: string[];

  /** Variables imported through this boundary cannot be reassigned. */
  readonly?: boolean;

  /** Internal once-render marker. */
  _dedupe?: boolean;
}

/**
 * An import identifier that names a URL (`https:…`, any other scheme, or
 * protocol-relative `//host/…`) rather than a file. A scheme needs two or more
 * characters, so a Windows drive path (`C:\…`, `C:/…`) stays a file path.
 */
export const EXTERNAL_IMPORT_SPECIFIER = /^(?:[a-z][a-z0-9+.-]+:|\/\/)/iu;
