/**
 * @import RESOLUTION + inlining (front end).
 *
 * This file lives OUTSIDE `tree2/` on purpose. The hard module boundary forbids
 * any file under `tree2/` from importing the legacy `../tree`; import RESOLUTION
 * (finding, reading, and parsing the imported file) is a FRONT-END concern — the
 * same category as parsing itself — not the eval/render machinery tree2 replaces.
 * The output is pure tree2 nodes spliced at the import site; tree2 never sees a
 * file system, a path, or a `StyleImport`.
 *
 * Strategy (matches the legacy import fold for the shapes tree2 supports): a
 * plain Less `@import "x"` resolves the path relative to the importing file,
 * reads + parses the target, bridges it to tree2 statements, and INLINES those
 * statements at the import site. Because Less imports share the importing scope,
 * inlining the imported statements directly into the parent body is exactly the
 * right semantic: tree2's per-scope `collectVars` then sees the imported
 * variables alongside the importing file's own (so a `@c` defined in the import
 * resolves in the importer), with NO clone / inherit / materialize op.
 *
 * Dedup: `@import` is `once` by default — a second import of the same resolved
 * path emits NO output but still contributes scope. `(multiple)` / `once: false`
 * re-emits at every position. `(reference)` registers scope but suppresses output
 * (correct for the no-extend fixtures tree2 covers). `(optional)` swallows a
 * missing file. CSS-passthrough (`(css)`, a `.css`/`url()`/remote specifier) is
 * NOT yet reproduced byte-faithfully (it hoists to the top of the document), so
 * it raises `UnsupportedShape` — the census counts it rather than mis-emitting.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as t2 from '../tree2/index.js';
import { Kind } from '../tree2/index.js';

/** Shared, mutable state threaded through a whole (recursive) bridge run. */
export interface ImportState {
  /** Resolved absolute paths already emitted (the `once` dedup set). */
  readonly seen: Set<string>;
  /** Guard against an import cycle (a file importing itself, directly or not). */
  readonly stack: string[];
}

export function createImportState(): ImportState {
  return { seen: new Set(), stack: [] };
}

/** A node the bridge reads structurally; mirrors bridge.ts's local shape. */
type AnyNode = Record<string, unknown> & { type?: unknown };

function isNode(x: unknown): x is AnyNode {
  return !!x && typeof x === 'object';
}

function nodeType(x: unknown): string {
  if (isNode(x)) {
    return String(
      (x as AnyNode).type ??
        (x as { constructor?: { name?: string } }).constructor?.name ??
        'unknown',
    );
  }
  return typeof x;
}

/** Read the raw specifier string from a `StyleImport`'s `path` (Quoted | Url). */
function specifierOf(node: AnyNode): string | null {
  const p = node.path;
  if (!isNode(p)) return null;
  const value = (p as AnyNode).value;
  if (typeof value === 'string') return value;
  return null;
}

interface ImportFlags {
  reference: boolean;
  optional: boolean;
  multiple: boolean;
  inline: boolean;
  css: boolean;
  escaped: boolean;
  isUrl: boolean;
}

function readFlags(node: AnyNode): ImportFlags {
  const io = isNode(node.options) ? ((node.options as AnyNode).importOptions as AnyNode | undefined) : undefined;
  const p = isNode(node.path) ? (node.path as AnyNode) : undefined;
  return {
    reference: io?.reference === true,
    optional: io?.optional === true,
    multiple: io?.multiple === true || io?.once === false,
    inline: io?.inline === true,
    css: io?.css === true || (isNode(io) && (io as AnyNode).type === 'css'),
    escaped: p?.escaped === true,
    isUrl: nodeType(p) === 'Url',
  };
}

/**
 * A specifier resolves to a plain-CSS `@import` (which the legacy path hoists to
 * the top of the document as a literal `@import`) when it is a `url(...)`, has a
 * `.css` extension, or is a remote/protocol-relative URL. tree2 does not yet
 * reproduce the top-of-document hoist, so these are rejected (not mis-inlined).
 */
function isCssPassthrough(spec: string, flags: ImportFlags): boolean {
  if (flags.css || flags.isUrl) return true;
  const lower = spec.toLowerCase();
  if (/\.css([?#].*)?$/.test(lower)) return true;
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('//');
}

/** Resolve a Less import specifier against the importing file's directory. */
function resolveLessPath(spec: string, fromDir: string): string | null {
  const joined = path.resolve(fromDir, spec);
  const candidates = path.extname(joined) ? [joined] : [`${joined}.less`, joined];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not found; try next */
    }
  }
  return null;
}

/**
 * Resolve + bridge a `StyleImport` node into the tree2 statements to splice at
 * the import site. `bridgeBody` is the recursive bridge entry (passed in to keep
 * this module free of a hard cycle with bridge.ts) — it parses + bridges the
 * imported file's source into a list of top-level statements.
 */
export function resolveImportStatements(
  node: AnyNode,
  fromFilePath: string | undefined,
  state: ImportState,
  bridgeBody: (source: string, filePath: string, state: ImportState) => t2.Statement[],
  unsupported: (feature: string, detail: string) => never,
): t2.Statement[] {
  if (isNode(node.options) && (node.options as AnyNode).type !== 'import') {
    unsupported('import:compose', String((node.options as AnyNode).type));
  }
  if (node.with !== undefined && node.with !== null) unsupported('import:with', 'configured import');

  const spec = specifierOf(node);
  if (spec === null) unsupported('import:specifier', nodeType(node.path));

  const flags = readFlags(node);
  if (flags.escaped) unsupported('import:escaped-path', spec);
  if (flags.inline) unsupported('import:inline', spec);
  if (isCssPassthrough(spec, flags)) unsupported('import:css-passthrough', spec);

  const fromDir = fromFilePath ? path.dirname(fromFilePath) : process.cwd();
  const resolved = resolveLessPath(spec, fromDir);
  if (resolved === null) {
    if (flags.optional) return [];
    unsupported('import:unresolved', spec);
  }
  if (state.stack.includes(resolved)) unsupported('import:cycle', resolved);

  // `once` dedup (default): a repeat import of the same file emits nothing.
  if (!flags.multiple && state.seen.has(resolved)) return [];

  // `(multiple)` re-imports the whole subtree at every position — including any
  // nested `once` imports the file contains (Less re-emits them per placement).
  // So a multiple import recurses under a FRESH dedup scope (its descendants
  // re-emit) that shares the cycle stack; it never registers in the parent's
  // once-set (a multiple import is, by definition, never deduped).
  const recurseState: ImportState = flags.multiple
    ? { seen: new Set(), stack: state.stack }
    : state;

  const source = fs.readFileSync(resolved, 'utf8');
  state.stack.push(resolved);
  let statements: t2.Statement[];
  try {
    statements = bridgeBody(source, resolved, recurseState);
  } finally {
    state.stack.pop();
  }
  if (!flags.multiple) state.seen.add(resolved);

  // `(reference)` suppresses OUTPUT (scope/extend still run in the full engine).
  // For the no-extend fixtures tree2 covers, that means: keep only definition
  // statements (which emit nothing) so downstream references still resolve.
  if (flags.reference) return statements.filter(isDefinitionStatement);

  return statements;
}

/** A statement that emits no bytes on its own (contributes only scope). */
function isDefinitionStatement(s: t2.Statement): boolean {
  return s.kind === Kind.VarDeclaration || s.kind === Kind.MixinDef;
}
