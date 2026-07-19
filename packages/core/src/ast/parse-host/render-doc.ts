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
import type { ValueEvaluator } from '../value-eval.js';
import { parseToAst } from './dispatch-host.js';
import { createImportState, resolveDirectImports, type FileVarParse, type ModuleResolver } from './import.js';
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
   * Injected legacy Less parse for interpolated `@import` PATH variable sniffing
   * (see {@link FileVarParse}). Core imports no parser, so the Less binding supplies
   * `@jesscss/less-parser`'s `parseLessFn`. Omitted → interpolated paths needing
   * cross-file literal vars stay deferred (graceful; unchanged from a parse miss).
   */
  parseFileVars?: FileVarParse;
  /**
   * Injected node_modules / package-specifier resolver for bare `@import`
   * specifiers (`@import "@less/pkg/x.less"`) — see {@link ModuleResolver}. Core
   * touches no package layout, so the Less binding supplies one backed by
   * `@jesscss/plugin-node-modules`. Omitted → bare specifiers stay deferred
   * verbatim (unchanged from a relative miss).
   */
  resolveModule?: ModuleResolver;
  /**
   * Output mode threaded to `serialize`. `false` = NESTED (Less v5 default),
   * `true`/omitted = FLAT (composed selectors). A fixture's `styles.config.ts`
   * (`output.collapseNesting`) governs this; the caller resolves it per file.
   */
  collapseNesting?: boolean;
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
    const resolved = resolveDirectImports(
      root.children,
      options.filePath,
      createImportState(options.parseFileVars, options.resolveModule),
      parse,
      (feature, detail) => deferredImports.push({ feature, detail }),
    );
    const resolvedRoot: Root = { ...root, children: resolved };
    const { css } = requireSync(
      serialize(resolvedRoot, {
        evaluator: options.evaluator,
        collapseNesting: options.collapseNesting,
        // [io] file-read capability for the IO built-ins (`data-uri`/`image-*`),
        // bound to the source file's directory. Resolves relative asset paths the
        // way Less resolves them against the entry file's location.
        io: createFsFnIo(options.filePath),
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
