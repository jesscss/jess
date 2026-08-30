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
