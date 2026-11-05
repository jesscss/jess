/*
 * What a canonical document carries of its session, apart from the session
 * (`context.ts`, which reads files), so the evaluator a browser bundle runs takes
 * no `node:` import.
 */
import type { DocumentContextOptions, ResolvedOptions } from './context.js';
import type { PluginInterface } from './plugin.js';
import type { TriviaMap } from './types/index.js';

/** Private parser-provenance slot on the exported document identity. */
const DOCUMENT_TRIVIA: unique symbol = Symbol('jess.context.document-trivia');

/**
 * Source identity carried by canonical AST documents for one Context session.
 * It intentionally has no legacy node scope, selector cache, or placement state.
 */
export class DocumentContext {
  private _options: Readonly<ResolvedOptions>;

  /** Immutable view of the resolved policy owned by the active source. */
  get options(): Readonly<ResolvedOptions> {
    return this._options;
  }

  isModule: boolean | undefined;
  file?: DocumentContextOptions['file'];
  plugin?: PluginInterface;

  constructor(options: Readonly<ResolvedOptions>, opts: DocumentContextOptions = {}) {
    this._options = options;
    this.isModule = opts.isModule;
    this.file = opts.file;
    this.plugin = opts.plugin;
  }
}

/** Attach canonical-document trivia without changing the public class declaration. */
export function attachDocumentFacts(
  context: DocumentContext,
  trivia: TriviaMap | undefined
): void {
  Object.defineProperty(context, DOCUMENT_TRIVIA, { value: trivia });
}

/** Core-internal access; intentionally absent from the package-root exports. */
export function documentTriviaOf(context: DocumentContext): TriviaMap | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- canonical contexts receive this module-private slot in rememberDocumentContext.
  return (context as DocumentContext & {
    readonly [DOCUMENT_TRIVIA]: TriviaMap | undefined;
  })[DOCUMENT_TRIVIA];
}
