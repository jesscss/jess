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
import { parseLessFn } from '@jesscss/less-parser';
import type * as t2 from '../index.js';
import { Kind, rawInline as rawInlineStatement } from '../index.js';

/** Shared, mutable state threaded through a whole (recursive) bridge run. */
export interface ImportState {
  /** Resolved absolute paths already emitted (the `once` dedup set). */
  readonly seen: Set<string>;
  /** Guard against an import cycle (a file importing itself, directly or not). */
  readonly stack: string[];
  /**
   * [import:specifier] Per-file cache of the simple (literal) top-level variable
   * bindings reachable from a file — its own `@var: "literal"` decls plus those
   * of the files it plainly imports (transitively). Used to resolve interpolated
   * import PATHS (`@import "@{theme}.less"`) at bridge time. Keyed by absolute
   * path; the value is the file's own+descendant literal-variable scope.
   */
  readonly varScopeCache: Map<string, ReadonlyMap<string, string>>;
  /**
   * [import:specifier] The entry (root) file of the whole bridge run, in a mutable
   * box set on first import resolution. The root is never pushed onto `stack`
   * (only imported files are), so its literal-variable scope must be included
   * explicitly when resolving an interpolated path reached from a deep import
   * (Less hoists the root's variables into every descendant scope).
   */
  readonly entry: { file: string | undefined };
}

export function createImportState(): ImportState {
  return { seen: new Set(), stack: [], varScopeCache: new Map(), entry: { file: undefined } };
}

/** A node read structurally by the import + bridge front ends. */
export type AnyNode = Record<string, unknown> & { type?: unknown };

export function isNode(x: unknown): x is AnyNode {
  return !!x && typeof x === 'object';
}

export function nodeType(x: unknown): string {
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
  // A `Quoted` path carries the specifier directly as a string.
  if (typeof value === 'string') return value;
  // [import:specifier] An unquoted `url(...)` path (`@import url(foo.less)`) wraps
  // its target in an inner value node whose `.value` is the raw URL string. A
  // QUOTED url (`url("foo.less")`) parses as a plain `Quoted` and is handled by
  // the branch above. An interpolated inner value (an `Interpolated`, which has no
  // string `.value`) is deliberately not matched here — it falls through to the
  // interpolation-template path.
  if (isNode(value)) {
    const inner = (value as AnyNode).value;
    if (typeof inner === 'string') return inner;
  }
  return null;
}

/**
 * [import:specifier] The `path`'s inner `Interpolated` template, when the import
 * specifier is a variable-interpolated string (`@import "@{theme}/x.less"`). The
 * parser wraps the template in a `Quoted` whose `.value` is an `Interpolated`
 * (`source` with `%%` placeholders + `replacements` — each a variable `Reference`
 * with a `.key`). A plain string specifier has no template (returns null).
 */
function interpTemplateOf(node: AnyNode): AnyNode | null {
  const p = node.path;
  if (!isNode(p)) return null;
  const value = (p as AnyNode).value;
  if (isNode(value) && nodeType(value) === 'Interpolated') return value as AnyNode;
  return null;
}

/** The variable name a template `replacement` (a `Reference`) interpolates. */
function replacementKey(rep: unknown): string | null {
  if (isNode(rep) && typeof (rep as AnyNode).key === 'string') return (rep as AnyNode).key as string;
  return null;
}

/**
 * [import:specifier] Substitute an `Interpolated` path template's `%%` slots with
 * the string values of its variable replacements, resolved from `vars`. Returns
 * the concrete specifier, or null if any referenced variable is not a known
 * literal (that import can't be resolved at bridge time → the caller rejects it).
 */
function fillInterpTemplate(tpl: AnyNode, vars: ReadonlyMap<string, string>): string | null {
  const source = typeof tpl.source === 'string' ? tpl.source : '';
  const replacements = Array.isArray(tpl.replacements) ? tpl.replacements : [];
  const segs = source.split('%%');
  let out = '';
  for (let i = 0; i < segs.length; i++) {
    out += segs[i] ?? '';
    if (i < replacements.length) {
      const key = replacementKey(replacements[i]);
      if (key === null) return null;
      const v = vars.get(key);
      if (v === undefined) return null;
      out += v;
    }
  }
  return out;
}

/** The literal string a simple `VarDeclaration` value carries, else null. */
function literalVarValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isNode(value)) return null;
  const v = value as AnyNode;
  const t = nodeType(v);
  // A `Quoted` literal (`@x: "s"`) contributes its unquoted text (Less strips the
  // quotes when a variable is interpolated into a path).
  if (t === 'Quoted' && typeof v.value === 'string') return v.value;
  // A numeric literal (`@x: 3`) with no unit interpolates as its bare number.
  if (t === 'Num' && typeof v.number === 'number' && v.unit == null) return String(v.number);
  return null;
}

/**
 * [import:specifier] Build (memoised) the literal top-level variable scope
 * reachable from `filePath`: its own `@var: <literal>` declarations plus those of
 * every file it PLAINLY imports (a non-interpolated, non-CSS, resolvable path),
 * transitively. This mirrors Less's lazy cross-file variable scope for the narrow
 * case an interpolated import PATH needs — a value known before render. Files that
 * fail to read/parse, and non-literal values, simply don't contribute.
 */
function collectFileVars(
  filePath: string,
  state: ImportState,
  visiting: Set<string>,
): ReadonlyMap<string, string> {
  const cached = state.varScopeCache.get(filePath);
  if (cached) return cached;
  if (visiting.has(filePath)) return new Map();
  visiting.add(filePath);

  const vars = new Map<string, string>();
  let rules: unknown[] = [];
  try {
    const parsed = parseLessFn(fs.readFileSync(filePath, 'utf8'));
    if (parsed.errors.length === 0 && isNode(parsed.tree) && Array.isArray((parsed.tree as AnyNode).rules)) {
      rules = (parsed.tree as AnyNode).rules as unknown[];
    }
  } catch {
    /* unreadable/unparsable file contributes no scope */
  }

  // Walk the rules in SOURCE ORDER, folding both own `@var` decls and the vars
  // of each plainly-imported file at the position the `@import` appears. Less is
  // last-declaration-wins BY POSITION — an imported file's bindings are spliced
  // at its import site, so a later own decl overrides an earlier import and a
  // later import overrides an earlier own decl (both verified against Less 4.x).
  // Assigning unconditionally in source order realises exactly that ordering.
  const fromDir = path.dirname(filePath);
  for (const r of rules) {
    if (!isNode(r)) continue;
    const t = nodeType(r);
    if (t === 'VarDeclaration' && typeof (r as AnyNode).name === 'string') {
      const lit = literalVarValue((r as AnyNode).value);
      if (lit !== null) vars.set((r as AnyNode).name as string, lit);
    } else if (t === 'StyleImport') {
      // Only descend into PLAIN, statically-resolvable imports for scope; an
      // interpolated child import can't be followed without a value it may not
      // yet have, and CSS-passthrough imports contribute no Less variables.
      const spec = specifierOf(r as AnyNode);
      if (spec === null) continue;
      const flags = readFlags(r as AnyNode);
      if (flags.inline || isCssPassthrough(spec, flags)) continue;
      const child = resolveLessPath(spec, fromDir);
      if (child === null) continue;
      for (const [k, v] of collectFileVars(child, state, visiting)) vars.set(k, v);
    }
  }

  visiting.delete(filePath);
  state.varScopeCache.set(filePath, vars);
  return vars;
}

/**
 * [import:specifier] The literal variable scope visible to an interpolated import
 * in `fromFilePath`: the file's own+descendant scope unioned with each ancestor
 * file's (Less hoists imported variables into the importing scope, so an inner
 * file sees its importers' definitions).
 */
function importScopeVars(
  fromFilePath: string | undefined,
  state: ImportState,
): ReadonlyMap<string, string> {
  const merged = new Map<string, string>();
  const files: string[] = [];
  if (fromFilePath) files.push(fromFilePath);
  for (const f of state.stack) files.push(f);
  if (state.entry.file) files.push(state.entry.file);
  // `files` runs importer-inward-first (this file, then its importers, then the
  // entry root): a variable defined in an INNER scope shadows the same name in an
  // outer one (verified against Less 4.x — an inner redefinition wins), so keep
  // the first (innermost) value seen and let outer scopes only fill gaps.
  for (const f of files) {
    for (const [k, v] of collectFileVars(f, state, new Set())) {
      if (!merged.has(k)) merged.set(k, v);
    }
  }
  return merged;
}

interface ImportFlags {
  reference: boolean;
  optional: boolean;
  multiple: boolean;
  inline: boolean;
  escaped: boolean;
}

/**
 * [import:inline] Whether an import carries a media-query postlude
 * (`@import (inline) "x" (min-width:…)`), which wraps the splice in an @media
 * block. Stored on `options.importOptions.postlude` (a QueryCondition node).
 */
function hasPostlude(node: AnyNode): boolean {
  const io = isNode(node.options) ? ((node.options as AnyNode).importOptions as AnyNode | undefined) : undefined;
  return isNode(io) && io.postlude != null;
}

function readFlags(node: AnyNode): ImportFlags {
  const io = isNode(node.options) ? ((node.options as AnyNode).importOptions as AnyNode | undefined) : undefined;
  const p = isNode(node.path) ? (node.path as AnyNode) : undefined;
  return {
    reference: io?.reference === true,
    optional: io?.optional === true,
    multiple: io?.once === false,
    inline: io?.inline === true,
    escaped: p?.escaped === true,
  };
}

/**
 * A specifier resolves to a plain-CSS `@import` (which the legacy path hoists to
 * the top of the document as a literal `@import`) when it carries the explicit
 * `(css)` option, has a `.css` extension, or is a remote/protocol-relative URL.
 * tree2 does not yet reproduce the top-of-document hoist, so these are rejected
 * (not mis-inlined).
 *
 * A bare `url(...)` wrapper does NOT force CSS — Less decides import kind from the
 * extension/options alone, so `@import url(foo.less)` is a LESS import that inlines
 * (verified against Less 4.x), while `@import url(foo.css)` is caught by the `.css`
 * test below. Only an explicit `(css)` option or a `.css`/remote target is CSS.
 */
function isCssPassthrough(spec: string, flags: ImportFlags): boolean {
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

  // [import:specifier] Record the entry file once (the outermost importer), so a
  // deep interpolated import still sees the root's hoisted literal variables.
  if (state.entry.file === undefined && fromFilePath !== undefined) state.entry.file = fromFilePath;

  // [import:specifier] A plain string specifier is read directly; a variable-
  // interpolated one (`@import "@{theme}.less"`) is filled from the literal
  // variable scope reachable at bridge time. An interpolation that references a
  // value not statically known is rejected (counted, never mis-resolved).
  let spec = specifierOf(node);
  if (spec === null) {
    const tpl = interpTemplateOf(node);
    if (tpl !== null) spec = fillInterpTemplate(tpl, importScopeVars(fromFilePath, state));
  }
  if (spec === null) unsupported('import:specifier', nodeType(node.path));

  const flags = readFlags(node);
  if (flags.escaped) unsupported('import:escaped-path', spec);

  const fromDir = fromFilePath ? path.dirname(fromFilePath) : process.cwd();

  // [import:inline] `@import (inline) "x"` splices the target file's RAW bytes
  // verbatim (unparsed, unreformatted) at the import site. A media-query postlude
  // (`@import (inline) "x" (min-width:…)`) would wrap the raw bytes in an @media
  // block — that shape needs the postlude query serialized as a prelude and is
  // deferred, so only the plain top-level inline splice is produced here.
  if (flags.inline) {
    if (hasPostlude(node)) unsupported('import:inline-media', spec);
    const rawPath = resolveLessPath(spec, fromDir);
    if (rawPath === null) {
      if (flags.optional) return [];
      unsupported('import:unresolved', spec);
    }
    return [rawInlineStatement(fs.readFileSync(rawPath, 'utf8'))];
  }

  if (isCssPassthrough(spec, flags)) unsupported('import:css-passthrough', spec);

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
    ? { seen: new Set(), stack: state.stack, varScopeCache: state.varScopeCache, entry: state.entry }
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
