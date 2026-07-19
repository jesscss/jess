/**
 * Whole-document AST-v2 render PIPELINE (production, parser-agnostic).
 *
 * Renders a COMPLETE stylesheet through the `ast/` engine directly:
 *
 *     source bytes → parseToAst (the P0/P1-clean direct build host,
 *                    NO legacy `Rules` tree, NO bridge) → serialize → CSS bytes
 *
 * This is the core-side of the production `.less` ast/ render path (engine
 * cutover). It is deliberately DIALECT-AGNOSTIC: the grammar entry, the trivia
 * parser, and the inline-JS source guard are all INJECTED by the caller so this
 * module never imports `@jesscss/less-parser` (or any parser) and never imports
 * `@jesscss/fns` — the value EVALUATOR is injected too (mirroring `serialize`'s
 * evaluator seam). Core keeps its clean boundary: it drives `parseToAst` +
 * `../index.js` serialize + the dispatch host, never the legacy `../../tree`.
 *
 * The less-binding wrappers live in the consumer layers that are allowed to
 * import the parser + fns: `@jesscss/plugin-less` (production `renderLessViaAst`)
 * and the test-space `__tests__/whole-doc-driver.ts` harness. Both supply the
 * Less grammar + inline-JS guard + a built-in fn evaluator and call in here.
 *
 * Import threading: `filePath` is carried so import resolution resolves a
 * specifier against the file's own directory (`import.ts` otherwise falls back to
 * `process.cwd()`). After the parse, `resolveDirectImports` walks the built root,
 * resolving each `@import` by parsing the target through this SAME direct pipeline
 * and splicing its statements at the import site (once / multiple / reference /
 * optional / inline — gap G5). A deferred shape (interpolated / CSS-passthrough
 * path) stays verbatim and is reported on `deferredImports`.
 */
import * as fs from 'node:fs';
import { isThenable } from '@jesscss/awaitable-pipe';
import { serialize } from '../index.js';
import type { Root, Statement } from '../index.js';
import type { SerializeResult } from '../serialize.js';
import type { PluginHost, ValueEvaluator } from '../value-eval.js';
import { preWalkStatements } from '../pre-eval.js';
import { parseToAst } from './dispatch-host.js';
import { createImportState, resolveDirectImports, type ModuleResolver } from './import.js';
import { createFsFnIo } from './fn-io.js';

export interface AstRenderResult {
  /** Serialized CSS bytes, or `undefined` if the render threw before producing any. */
  css: string | undefined;
  /** Parse diagnostics surfaced by the dispatch host (position-tagged). */
  parseErrors: Array<{ message: string; offset?: number }>;
  /** A throw captured during parse/serialize (e.g. `UnsupportedShape`), or `null`. */
  threw: Error | null;
  /** `@import`s left verbatim (deferred shape / unresolved) with their feature tag. */
  deferredImports: Array<{ feature: string; detail: string }>;
}

export interface AstRenderOptions {
  /**
   * The `Stylesheet` grammar entry (untyped at the parseman boundary, exactly as
   * `dispatch-host.ts` types it). Supplied by the dialect-binding wrapper
   * (e.g. `lessGrammar.Stylesheet`).
   */
  grammar: unknown;
  /** The trivia parser entry (e.g. `lessGrammar.rw`). */
  trivia: unknown;
  /** Absolute path of the source file (threads import base dir; see module doc). */
  filePath?: string;
  /** Injected typed value evaluator (built via `buildEvaluator(registry)`). */
  evaluator?: ValueEvaluator;
  /**
   * Optional source guard run before parse (and on every imported file). Throws
   * to reject a construct the grammar cannot represent — Less injects the
   * inline-JS (backtick) migration guard here so the ast/ path errors identically
   * to `LessParser.parse`. The throw is captured on {@link AstRenderResult.threw}.
   */
  guardSource?: (src: string) => void;
  /**
   * Injected node_modules / package-specifier resolver for bare `@import`
   * specifiers (`@import "@less/pkg/x.less"`) — see {@link ModuleResolver}. Core
   * touches no package layout, so the Less binding supplies one backed by
   * `@jesscss/plugin-node-modules`. Omitted → bare specifiers stay deferred
   * verbatim (unchanged from a relative miss).
   */
  resolveModule?: ModuleResolver;
  /**
   * [import:paths] Configured include-path search directories (Less's `paths`
   * option). Threaded into BOTH `@import` resolution (probed after the importing
   * file's own directory) and the IO built-ins (`data-uri`/`image-*`, which
   * resolve asset paths through `paths` exactly as Less does). A relative entry is
   * resolved against the importing/source file's directory. Omitted → only the
   * source directory is searched, unchanged from before.
   */
  searchDirs?: readonly string[];
  /**
   * Output mode threaded to `serialize`. `false` = NESTED (Less v5 default),
   * `true`/omitted = FLAT (composed selectors). A fixture's `styles.config.ts`
   * (`output.collapseNesting`) governs this; the caller resolves it per file.
   */
  collapseNesting?: boolean;
  /**
   * [plugin/P2] OPTIONAL driver-injected plugin runtime, forwarded to `serialize`.
   * The Less consumer layer (`@jesscss/plugin-less`) builds it from the source's
   * `@plugin` directives + config-injected plugins; core stays plugin-agnostic.
   * Absent → no plugins (idle path, byte-identical).
   */
  pluginHost?: PluginHost;
}

/** The synchronous driver requires a synchronous evaluator; a Promise is a bug. */
function requireSync(r: ReturnType<typeof serialize>): SerializeResult {
  if (isThenable(r)) {
    throw new Error('serialize returned a Promise; the whole-doc pipeline requires a synchronous evaluator');
  }
  return r;
}

/**
 * Render a SOURCE string through the whole-document AST-v2 pipeline.
 * Never throws: any parse/serialize throw is captured on `.threw`.
 */
export function renderAstDoc(src: string, options: AstRenderOptions): AstRenderResult {
  const deferredImports: Array<{ feature: string; detail: string }> = [];
  const { grammar, trivia, guardSource } = options;
  try {
    guardSource?.(src);
    const { root, errors } = parseToAst(src, grammar, undefined, { trivia });
    if (root === undefined) {
      return {
        css: undefined,
        parseErrors: errors,
        threw: new Error(`parseToAst produced no root (parse errors: ${JSON.stringify(errors)})`),
        deferredImports,
      };
    }
    // [import G5] Resolve + inline `@import`s on the direct host: parse each
    // imported file through the SAME direct pipeline and splice its statements at
    // the import site (once / multiple / reference / optional / inline semantics
    // in `resolveDirectImports`). Deferred shapes stay verbatim (see driver doc).
    const parse = (source: string): Statement[] => {
      guardSource?.(source);
      const res = parseToAst(source, grammar, undefined, { trivia });
      return res.root ? res.root.children : [];
    };
    // Interpolated-import PATH var sniff (`@import "@{theme}.less"`): parse the
    // target through the SAME ast/ dispatch host and read its top-level `@var`
    // decls — BuilderHost-free, no legacy `tree/`. Distinct from `parse` in that it
    // does NOT run `guardSource` (a var sniff must not reject a file for a construct
    // unrelated to its literal-variable scope; an unparsable file just contributes
    // none), mirroring the prior sniffer's parse-only-then-read behaviour.
    const sniffFileVars = (source: string): Statement[] => {
      const res = parseToAst(source, grammar, undefined, { trivia });
      return res.root ? res.root.children : [];
    };
    const resolved = resolveDirectImports(
      root.children,
      options.filePath,
      createImportState(sniffFileVars, options.resolveModule, options.searchDirs),
      parse,
      (feature, detail) => deferredImports.push({ feature, detail }),
    );
    // [plugin/P3] Gated pre-eval visitor pre-walk. When the injected host carries
    // document-level pre-eval REPLACING visitors (from a `@plugin` that registered
    // one via `install`/`addVisitor`), rewrite the AST value nodes BEFORE serialize
    // so replacements (`@replace` → a literal) are in place when the single pass
    // evaluates. No visitors (every real document) ⇒ zero pre-walk, byte-identical.
    const preEvalVisitors = options.pluginHost?.preEvalVisitors;
    const preWalked = preEvalVisitors && preEvalVisitors.length > 0
      ? preWalkStatements(resolved, preEvalVisitors)
      : resolved;
    const resolvedRoot: Root = { ...root, children: preWalked };
    const { css } = requireSync(
      serialize(resolvedRoot, {
        evaluator: options.evaluator,
        collapseNesting: options.collapseNesting,
        pluginHost: options.pluginHost, // [plugin/P2] `@plugin` + config-plugin fns

        // [io] file-read capability for the IO built-ins (`data-uri`/`image-*`),
        // bound to the source file's directory. Resolves relative asset paths the
        // way Less resolves them against the entry file's location.
        io: createFsFnIo(options.filePath, options.searchDirs),
      }),
    );
    return { css, parseErrors: errors, threw: null, deferredImports };
  } catch (e) {
    return { css: undefined, parseErrors: [], threw: e instanceof Error ? e : new Error(String(e)), deferredImports };
  }
}

/** Render a FILE through the whole-document AST-v2 pipeline. */
export function renderAstFile(filePath: string, options: Omit<AstRenderOptions, 'filePath'>): AstRenderResult {
  const src = fs.readFileSync(filePath, 'utf8');
  return renderAstDoc(src, { ...options, filePath });
}
