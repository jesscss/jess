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
import type * as t2 from '../index.js';
import { rawInline as rawInlineStatement, styleImport } from '../index.js';
import type { BuildArgs, Span } from './host-context.js';

/**
 * INJECTED legacy Less parse used ONLY to sniff a file's literal `@var` scope for
 * interpolated import PATHS (`@import "@{theme}.less"`) — see `collectFileVars`.
 * Core imports no parser; the caller (the Less render binding in `@jesscss/plugin-less`
 * / the test harness) supplies `@jesscss/less-parser`'s `parseLessFn`. When absent
 * (a dialect that never needs cross-file literal-var lookup, or a caller that opts
 * out), interpolated paths needing cross-file vars simply stay deferred — identical
 * to the behaviour when the legacy parse fails to read/parse a file.
 */
export type FileVarParse = (source: string) => { errors: readonly unknown[]; tree: unknown };

/**
 * [import:module] INJECTED node_modules / package-specifier resolver. A bare Less
 * import specifier (`@import "@less/pkg/one/1.less"`, `@import "pkg/theme"`) is NOT
 * a relative path — it names a package to be located via Node's module-resolution
 * algorithm (walking `node_modules`). Core imports no resolver and touches no
 * package layout, so the caller (the Less render binding in `@jesscss/plugin-less`
 * / the test harness) supplies one — backed by `@jesscss/plugin-node-modules`,
 * exactly like `parseFileVars` is supplied by `@jesscss/less-parser`. Given a
 * resolvable specifier and the importing file's directory it returns the target's
 * absolute path (already `.less`-suffixed by the caller-tried candidate); a
 * non-package or unresolvable specifier returns `null`. Absent → package
 * specifiers stay unresolved (deferred verbatim), identical to a relative miss.
 */
export type ModuleResolver = (spec: string, fromDir: string) => string | null;

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
  /**
   * [import:specifier] Injected legacy Less parse (see {@link FileVarParse}). Kept
   * on the state so it threads through the whole recursive bridge run without
   * widening `resolveDirectImports`' signature. Absent → `collectFileVars` yields
   * no cross-file scope (graceful; interpolated paths needing it stay deferred).
   */
  readonly parseFileVars?: FileVarParse;
  /**
   * [import:module] Injected node_modules / package-specifier resolver (see
   * {@link ModuleResolver}). Threaded on the state so it reaches every recursive
   * bridge step (a package-imported file may itself import a package). Absent →
   * bare specifiers stay unresolved (deferred verbatim).
   */
  readonly resolveModule?: ModuleResolver;
}

export function createImportState(parseFileVars?: FileVarParse, resolveModule?: ModuleResolver): ImportState {
  return { seen: new Set(), stack: [], varScopeCache: new Map(), entry: { file: undefined }, parseFileVars, resolveModule };
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

/**
 * [import:specifier] Fill a direct-host `Interp` path template (`@import
 * "@{theme}.less"`) from `vars`: literal parts pass through; each `@{name}` ref
 * is replaced by the name's literal value. Returns null if any ref is not a plain
 * `VarRef` or resolves to no known literal (→ the caller defers the import
 * verbatim). Mirrors the bridge's `fillInterpTemplate` on the ast `Interp` shape.
 */
function fillAstInterp(tpl: t2.Interp, vars: ReadonlyMap<string, string>): string | null {
  let out = '';
  for (const part of tpl.parts) {
    if ('lit' in part) {
      out += part.lit;
      continue;
    }
    const ref = part.ref;
    if (ref.type !== 'VarRef') return null;
    const v = vars.get(ref.name);
    if (v === undefined) return null;
    out += v;
  }
  // The template's literal chunks retain the specifier's own surrounding quotes
  // (`"import/…"`); the resolved PATH is the unquoted inner text.
  const q = out[0];
  if ((q === '"' || q === "'") && out.endsWith(q)) return out.slice(1, -1);
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
  const parseFileVars = state.parseFileVars;
  if (parseFileVars !== undefined) {
    try {
      const parsed = parseFileVars(fs.readFileSync(filePath, 'utf8'));
      if (parsed.errors.length === 0 && isNode(parsed.tree) && Array.isArray((parsed.tree as AnyNode).rules)) {
        rules = (parsed.tree as AnyNode).rules as unknown[];
      }
    } catch {
      /* unreadable/unparsable file contributes no scope */
    }
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
      const child = resolveLessPath(spec, fromDir, state.resolveModule);
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
  /** Explicit `(css)` option — force CSS-passthrough regardless of extension. */
  css?: boolean;
  /** Explicit `(less)` option — force Less parsing/inlining even for a `.css` target. */
  less?: boolean;
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
    less: io?.less === true,
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
 *
 * An explicit `(less)` option forces LESS parsing regardless of extension, so
 * `@import (less) "x.css"` inlines the target as Less (verified against Less 4.x —
 * `(less)` overrides the `.css` heuristic). It wins over the extension test below.
 */
function isCssPassthrough(spec: string, flags: ImportFlags): boolean {
  if (flags.less === true) return false;
  if (flags.css === true) return true;
  const lower = spec.toLowerCase();
  if (/\.css([?#].*)?$/.test(lower)) return true;
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('//');
}

/**
 * [import:module] A bare package specifier is one that is neither relative
 * (`./`, `../`) nor absolute — it names a `node_modules` package to resolve
 * (`@less/pkg/x.less`, `pkg/theme`). Relative/absolute specifiers resolve against
 * the importing directory and never touch the module resolver.
 */
function isBareSpecifier(spec: string): boolean {
  return !spec.startsWith('.') && !spec.startsWith('/') && !path.isAbsolute(spec);
}

/**
 * Resolve a Less import specifier against the importing file's directory, then —
 * for a bare package specifier and when a {@link ModuleResolver} is injected —
 * via node_modules resolution ([import:module]). The extensionless `.less`
 * candidate is tried for BOTH paths (`@import "pkg/one/2"` → `.../2.less`),
 * mirroring Less's own extension probing.
 */
function resolveLessPath(spec: string, fromDir: string, resolveModule?: ModuleResolver): string | null {
  const joined = path.resolve(fromDir, spec);
  const candidates = path.extname(joined) ? [joined] : [`${joined}.less`, joined];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not found; try next */
    }
  }
  // [import:module] Fall back to node_modules resolution for a bare specifier.
  if (resolveModule !== undefined && isBareSpecifier(spec)) {
    const specs = path.extname(spec) ? [spec] : [`${spec}.less`, spec];
    for (const candidate of specs) {
      const resolved = resolveModule(candidate, fromDir);
      if (resolved === null) continue;
      try {
        if (fs.statSync(resolved).isFile()) return resolved;
      } catch {
        /* resolver returned a non-file; try next candidate */
      }
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
  if (flags.inline && hasPostlude(node)) unsupported('import:inline-media', spec);

  const fromDir = fromFilePath ? path.dirname(fromFilePath) : process.cwd();
  return spliceImport(spec, flags, fromDir, state, bridgeBody, unsupported);
}

/**
 * The shape-neutral import RESOLUTION tail, shared by the bridge (`StyleImport`
 * legacy node) and the direct build host (`t2.StyleImport`): given the already-
 * extracted specifier + option flags + importing directory, apply Less's
 * inline / css-passthrough / once / multiple / cycle / reference semantics and
 * return the statements to splice at the import site. `bridgeBody` parses +
 * (recursively) resolves the imported file's source into tree2 statements.
 */
function spliceImport(
  spec: string,
  flags: ImportFlags,
  fromDir: string,
  state: ImportState,
  bridgeBody: (source: string, filePath: string, state: ImportState) => t2.Statement[],
  unsupported: (feature: string, detail: string) => never,
  media: string | null = null,
): t2.Statement[] {
  // [import:inline] `@import (inline) "x"` splices the target file's RAW bytes
  // verbatim (unparsed, unreformatted) at the import site. A media-query postlude
  // (`@import (inline) "x" (min-width:…)`) is carried on the `RawInline` node so
  // the serializer wraps the splice in an `@media <media> { … }` block.
  if (flags.inline) {
    const rawPath = resolveLessPath(spec, fromDir, state.resolveModule);
    if (rawPath === null) {
      if (flags.optional) return [];
      unsupported('import:unresolved', spec);
    }
    return [rawInlineStatement(fs.readFileSync(rawPath, 'utf8'), media)];
  }

  if (isCssPassthrough(spec, flags)) unsupported('import:css-passthrough', spec);

  const resolved = resolveLessPath(spec, fromDir, state.resolveModule);
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
    ? {
        seen: new Set(),
        stack: state.stack,
        varScopeCache: state.varScopeCache,
        entry: state.entry,
        parseFileVars: state.parseFileVars,
        resolveModule: state.resolveModule,
      }
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

  // `(reference)` HIDES the imported content: it emits nothing on its own, but
  // stays available for `:extend`/mixin to pull into visibility. We keep the
  // DEFINITIONS (var/mixin — invisible anyway; a mixin called at a visible site
  // emits normally) and every RULESET, tagged `reference:true` so the serializer
  // (a) drops it from direct output and (b) can fold a VISIBLE extender branch
  // into it. Rulesets are ALSO the ambient mixins Less resolves (`.mixin()`,
  // `#Namespace > .mixin()`), so keeping them indexed is required for #1896/#1851.
  // Loose declarations / comments / at-rule blocks from a referenced file are NOT
  // individually pullable, so they are dropped (fixes #2991 empty-@media leak).
  if (flags.reference) return hideReferenced(statements);

  return statements;
}

/**
 * Apply `(reference)` visibility to an imported file's TOP-LEVEL statements — a flat
 * O(top-level) pass, NO recursive descendant walk (the byte-tuned engine is perf-
 * sensitive). Keep every top-level ruleset (flagged `reference:true` — a single
 * boundary flag the serializer skips by default, overridden per-branch when extend
 * pulls it in) and every definition (var/mixin, which emit nothing on their own but
 * expand normally when called from a visible site). Drop all other top-level content
 * (loose declarations, comments, at-rule blocks/statements, raw inline) — none is
 * individually pullable, so leaving it in would leak invisible output (fixes #2991).
 * A rule's own body/descendants are NOT marked: a hidden rule is skipped whole, so
 * its descendants are never reached; only the boundary flag is needed.
 */
function hideReferenced(statements: t2.Statement[]): t2.Statement[] {
  const out: t2.Statement[] = [];
  for (const s of statements) {
    if (s.type === 'Rule') out.push({ ...s, reference: true });
    else if (s.type === 'VarDeclaration' || s.type === 'MixinDef') out.push(s);
    // else: not individually pullable — dropped.
  }
  return out;
}

/* ============================================================ DIRECT HOST ==
 * The tree2 build host delivers `@import` as a STRUCTURED `AtRuleStatement`
 * shape: the option keywords, the built path `Word`, and the media postlude
 * arrive as separated children (P0 — the parser owns the structure). The build
 * host turns that head into a `t2.StyleImport` node (`buildStyleImportNode`),
 * which the post-parse pass (`resolveDirectImports`) resolves via the SAME
 * `spliceImport` tail the bridge uses — one resolution semantics, two front ends.
 */

/** A parseman child leaf `{ _tag:'leaf', value, span }`. */
interface ImportLeaf {
  readonly _tag?: string;
  readonly value?: unknown;
  readonly span?: Span;
}
function importLeafValue(x: unknown): string | undefined {
  const leaf = x as ImportLeaf | undefined;
  return leaf?._tag === 'leaf' && typeof leaf.value === 'string' ? leaf.value : undefined;
}

/** The at-keyword that opens a Less import statement (`@import`/`@-import`/`@-export`).
 * The grammar already lexes the head as an `atKeyword` leaf; this narrows that leaf to
 * the import family without a regex (LAW: no regex outside Parseman `regex()`). */
const IMPORT_KEYWORDS = new Set(['@import', '@-import', '@-export']);
function isImportKeyword(name: string): boolean {
  return IMPORT_KEYWORDS.has(name.toLowerCase());
}

/**
 * The specifier string a built path leaf carries, plus whether it is variable-
 * interpolated (`@{…}`) — which the direct host defers (emitting the import
 * verbatim) rather than resolving. A `Quoted` leaf carries its inner text in
 * `value`; a `url(…)` leaf (opaque `Any`) carries `url(target)` in `src`, whose
 * target is unwrapped here.
 */
function directSpecifier(pathNode: t2.ValueNode): { spec: string | null; interp: t2.Interp | null } {
  // A variable-interpolated path (`@import "@{theme}.less"`) is an `Interp`: the
  // §3.3 Less `Quoted` grammar SPLIT the `@{name}` out of the string, so the
  // interpolated-vs-plain decision reads the built node's STRUCTURE (P0 KEYSTONE),
  // not a byte substring. The template is carried on the built `StyleImport` so the
  // resolution pass can fill it from the file's literal-variable scope.
  if (pathNode.type === 'Interp') return { spec: null, interp: pathNode };
  const raw =
    pathNode.type === 'Quoted'
      ? pathNode.value
      : pathNode.type === 'Any'
        ? unwrapUrl(pathNode.src)
        : null;
  if (raw === null) return { spec: null, interp: null };
  return { spec: raw, interp: null };
}

/** Unwrap a `url( … )` word to its inner target (quotes stripped), else null. */
function unwrapUrl(text: string): string | null {
  const m = /^url\(\s*(.*?)\s*\)$/is.exec(text);
  if (m === null) return null;
  const inner = m[1] ?? '';
  const q = inner[0];
  return (q === '"' || q === "'") && inner.endsWith(q) ? inner.slice(1, -1) : inner;
}

/** Parse the `(option, …)` keyword list into resolution flags. */
function flagsFromOptions(options: string): ImportFlags {
  const set = new Set(
    options
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
  return {
    reference: set.has('reference'),
    optional: set.has('optional'),
    // `once` is the default; `multiple` opts out of dedup.
    multiple: set.has('multiple') && !set.has('once'),
    inline: set.has('inline'),
    escaped: false,
    css: set.has('css') && !set.has('less'),
    less: set.has('less'),
  };
}

/**
 * Build a `t2.StyleImport` from the direct host's structured import children, or
 * return `null` when the shape is NOT an import (a generic `@charset`/`@namespace`
 * statement) — the charset family then falls back to a generic `AtRuleStatement`.
 * The import shape is recognised by the import keyword plus a built path node
 * child (a `Quoted` string, a `url(…)` `Any`, or a §3.3 `Interp` for an
 * interpolated path `@import "@{theme}.less"`; a generic statement carries only
 * leaves, so it does not match and defers to a generic statement / verbatim emit).
 * An interpolated path is recognised here but its spec is `null`, so the resolver
 * defers it verbatim.
 */
export function buildStyleImportNode(args: BuildArgs): t2.StyleImport | null {
  const children = args.children;
  const name = importLeafValue(children[0]);
  if (name === undefined || !isImportKeyword(name)) return null;

  // Locate the built path leaf (the sole non-leaf value child) and the option leaf.
  let pathNode: t2.ValueNode | undefined;
  let options = '';
  let media: string | null = null;
  let seenPath = false;
  for (let i = 1; i < children.length; i++) {
    const child = children[i];
    const leaf = importLeafValue(child);
    if (leaf !== undefined) {
      if (leaf === '(' || leaf === ')') continue;
      if (leaf === ';') continue;
      // A leaf before the path is the `(options)` body; a leaf after it (that is
      // not `;`) is the media postlude the grammar scanned to the terminator.
      if (!seenPath) options = leaf;
      else media = leaf.trim() || null;
      continue;
    }
    // The first (and only) non-leaf child is the path leaf (`Quoted` / url `Any`).
    if (!seenPath && isPathNode(child)) {
      pathNode = child;
      seenPath = true;
    }
  }
  if (pathNode === undefined) return null;

  const { spec, interp } = directSpecifier(pathNode);
  const flags = flagsFromOptions(options);
  const raw = args.ctx.src.slice(args.span.start, args.span.end);
  return styleImport({
    raw,
    spec,
    ...(interp !== null ? { interp } : {}),
    reference: flags.reference,
    optional: flags.optional,
    multiple: flags.multiple,
    inline: flags.inline,
    css: flags.css === true,
    less: flags.less === true,
    escaped: false,
    media,
  });
}

function isPathNode(x: unknown): x is t2.ValueNode {
  if (!x || typeof x !== 'object') return false;
  const t = (x as { type?: unknown }).type;
  // `Quoted` / url `Any` are plain paths; `Interp` is a §3.3-structured
  // interpolated path (`@import "@{theme}.less"`) — all three are import paths the
  // direct host recognises (the interpolated one is then deferred verbatim).
  return t === 'Quoted' || t === 'Any' || t === 'Interp';
}

/** The resolution flags carried on a `t2.StyleImport`. */
function directFlags(imp: t2.StyleImport): ImportFlags {
  return {
    reference: imp.reference,
    optional: imp.optional,
    multiple: imp.multiple,
    inline: imp.inline,
    escaped: imp.escaped,
    css: imp.css,
    less: imp.less,
  };
}

/**
 * Resolve every `@import` in a direct-host statement list, recursively: each
 * `StyleImport` is replaced in place by the imported file's spliced statements
 * (applying once / multiple / reference / optional / inline semantics via the
 * shared `spliceImport`), and imports nested inside `Rule` / `AtRuleBlock` bodies
 * resolve too. `parse` turns imported SOURCE into the direct host's top-level
 * statements (injected to keep this module free of a hard cycle with the host).
 *
 * A deferred shape (interpolated / escaped path, or a CSS-passthrough import) —
 * or a genuinely unresolvable non-optional target — leaves the `StyleImport` node
 * in place, so the serializer emits the authored `@import …;` verbatim rather than
 * mis-resolving or aborting the whole render. `onDefer` is notified with the
 * feature tag for each such import (the driver surfaces it as a diagnostic).
 */
export function resolveDirectImports(
  statements: readonly t2.Statement[],
  fromFilePath: string | undefined,
  state: ImportState,
  parse: (source: string) => t2.Statement[],
  onDefer?: (feature: string, detail: string) => void,
): t2.Statement[] {
  if (state.entry.file === undefined && fromFilePath !== undefined) state.entry.file = fromFilePath;
  const raise = (feature: string, detail: string): never => {
    throw new ImportDeferral(feature, detail);
  };
  const bridgeBody = (source: string, filePath: string, st: ImportState): t2.Statement[] =>
    resolveDirectImports(parse(source), filePath, st, parse, onDefer);

  const out: t2.Statement[] = [];
  for (const s of statements) {
    if (s.type === 'StyleImport') {
      let spec = s.spec;
      if (spec === null && s.interp !== undefined) {
        // [import:specifier] A variable-interpolated path (`@import "@{theme}.less"`):
        // fill the template from the literal-variable scope reachable at this import
        // site (own + ancestor files, Less-lazy). Unresolvable → fall through to the
        // verbatim defer below (a referenced variable is not a known literal).
        spec = fillAstInterp(s.interp, importScopeVars(fromFilePath, state));
      }
      if (spec === null) {
        // An interpolated / opaque path — the direct host defers it verbatim.
        onDefer?.('import:specifier', 'interpolated/opaque path');
        out.push(s);
        continue;
      }
      const flags = directFlags(s);
      // [import:hoist] A plain-CSS `@import` (`(css)` / `.css` / remote) is NOT
      // inlined — Less keeps it as a literal `@import` and HOISTS it to the top
      // of the output document (verified vs Less 4.x + the alpha goldens). Mark
      // it for the serializer's hoist pass and leave it in the stream at its
      // source position, so the hoist pass emits the collected imports in
      // document-encounter order ahead of all other content.
      if (!flags.inline && isCssPassthrough(spec, flags)) {
        out.push({ ...s, hoist: true });
        continue;
      }
      try {
        const fromDir = fromFilePath ? path.dirname(fromFilePath) : process.cwd();
        const spliced = spliceImport(spec, flags, fromDir, state, bridgeBody, raise, s.media);
        for (const r of spliced) out.push(r);
      } catch (e) {
        if (!(e instanceof ImportDeferral)) throw e;
        onDefer?.(e.feature, e.detail);
        out.push(s); // leave the import verbatim
      }
    } else if (s.type === 'Rule') {
      out.push({ ...s, body: resolveDirectImports(s.body, fromFilePath, state, parse, onDefer) });
    } else if (s.type === 'AtRuleBlock') {
      out.push({ ...s, body: resolveDirectImports(s.body, fromFilePath, state, parse, onDefer) });
    } else {
      out.push(s);
    }
  }
  return out;
}

/** A deferred / unresolvable import, caught per-import to fall back to verbatim. */
class ImportDeferral extends Error {
  constructor(readonly feature: string, readonly detail: string) {
    super(`${feature}: ${detail}`);
    this.name = 'ImportDeferral';
  }
}
