/**
 * Public functional Less parser: the build host (reuses LessGrammar's Less +
 * inherited CSS `buildNode`) and the `parseLessFn` / `LessParser` entry points.
 * The grammar itself lives in ./grammar.ts; the shared driver is reused from
 * @jesscss/css-parser.
 */
import type { Span } from 'parseman';
import { nil, type MathMode, type Rules, type TreeContext } from '@jesscss/core';
import {
  runFunctionalParse, toParseError, buildLazyTriviaMap,
  type FunctionalParseHost, type FunctionalParseResult
} from '@jesscss/css-parser';
import { LessGrammar } from './builders.js';
import { lessGrammar } from './grammar.js';

// ---------------------------------------------------------------------------
// Builder host — reuse LessGrammar's builders (Less + inherited CSS buildNode).
// ---------------------------------------------------------------------------

class BuilderHost extends LessGrammar implements FunctionalParseHost {
  /**
   * The TreeContext threaded in by the caller (the plugin's per-file context),
   * held for the duration of one parse. Currently a pass-through: it's carried
   * back out in the result so a caller can hand one context in and read it back.
   * Grammar rules (e.g. a future `@compose`/`@use` rule) can read/mutate it —
   * e.g. set `context.opts.strict` — and the mutation is visible to the caller
   * since it's the same object.
   */
  context?: TreeContext;

  setSource(src: string) {
    this._source = src;
  }

  resetWarnings() {
    this._warnings = [];
    this._errors = [];
    this._liftedCommentRanges = [];
  }

  getWarnings() {
    return this._warnings.slice();
  }

  getErrors() {
    return this._errors.slice();
  }

  /** `ctx.build` host: every structural `node(type, …)` builds through this,
   * reusing LessGrammar's (Less + inherited CSS) `buildNode` verbatim. */
  build(type: string, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>, span: { start: number; end: number }): unknown {
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
    return (this as unknown as {
      buildNode(t: string, s: Span, c: ReadonlyArray<unknown>, st: unknown, r: ReadonlyArray<unknown>): unknown;
    }).buildNode(type, { start: span.start, end: span.end } as Span, children, undefined, rawChildren);
    /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
  }
}

const host = new BuilderHost();

export type LessFnParseResult = FunctionalParseResult & {
  /** The TreeContext the caller threaded in (if any), passed back out. */
  context?: TreeContext;
};

// `rule` is a grammar rule name — the root `Stylesheet` by default, or any rule
// (e.g. `Declaration`, `Guard`, `SelectorList`) to parse that fragment directly.
export function parseLessFn(
  input: string,
  rule = 'Stylesheet',
  mathMode: MathMode = 'parens-division',
  context?: TreeContext
): LessFnParseResult {
  // mathMode comes from the threaded context when present (the caller's per-file
  // TreeContext carries it, alongside every other option); the `mathMode` param
  // is only the context-less fallback for bare `parseLessFn(src)` callers.
  host.mathMode = context?.mathMode ?? mathMode;
  host.context = context;
  const g = lessGrammar as Record<string, unknown>;
  // Less trivia includes `//` line comments, so trailing `//…` is not leftover.
  const result = runFunctionalParse(input, g[rule], host, { trivia: g.rw });
  // Carry the (possibly rule-mutated) context back out; clear the singleton's
  // reference so it isn't retained across parses.
  const threaded = host.context;
  host.context = undefined;
  return { ...result, context: threaded };
}

/**
 * Index of the first backtick in CODE position (i.e. real inline JS), or -1.
 * Skips `//` line comments, `/* … *​/` block comments, and quoted strings so a
 * backtick inside a comment/string (common in Less doc comments) is not
 * mistaken for inline JavaScript.
 */
function firstInlineJsBacktick(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '`') return i;
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i + 2);
      if (nl === -1) return -1;
      i = nl;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return -1;
      i = end + 1;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') i++;
        i++;
      }
    }
  }
  return -1;
}

/** Functional Less parser — call .parse(text) to get a Jess AST. */
export class LessParser {
  private readonly _mathMode: MathMode;

  constructor(config?: { mathMode?: MathMode } & Record<string, unknown>) {
    this._mathMode = config?.mathMode ?? 'parens-division';
  }

  // Arrow field so `const parse = parser.parse` (used in tests) keeps `this`.
  // `options.context` threads a caller-owned TreeContext through the parse and
  // is carried back out on the result (same object) — the seam a future
  // `@compose`/`@use` rule uses to set `context.opts.strict`.
  parse = (text: string, rule = 'Stylesheet', options?: { context?: TreeContext }): LessFnParseResult => {
    // Inline JavaScript (backticks) was removed in v5 — report it as a normal
    // parse error at the backtick, NOT by throwing (a parser must not throw).
    // Only a backtick in CODE position is inline JS: skip backticks inside line/
    // block comments and quoted strings (e.g. markdown links in doc comments).
    const backtick = firstInlineJsBacktick(text);
    if (backtick !== -1) {
      return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        tree: nil() as unknown as Rules,
        errors: [toParseError('Inline JavaScript using backticks is not supported. Use @use / @-use to import a script module instead.', backtick, text)],
        warnings: [],
        trivia: buildLazyTriviaMap([], text),
        liftedCommentRanges: [],
        context: options?.context
      };
    }
    return parseLessFn(text, rule, this._mathMode, options?.context);
  };
}
