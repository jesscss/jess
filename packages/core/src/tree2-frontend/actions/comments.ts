/**
 * [tree2-native] Comments family: lift STANDALONE block comments (`/* … *​/`)
 * into `Comment` body children, in source order.
 *
 * Comments are parseman TRIVIA — no `build('Comment', …)` call is ever emitted —
 * so this family cannot register a per-type action for a "Comment" grammar rule.
 * Instead it OVERRIDES the `Stylesheet` and `Ruleset` body-assembly actions
 * (appended AFTER the ruleset family in `ACTION_LIST`, so its `type` entries win),
 * reusing the ruleset family's selector/statement derivation and then INTERLEAVING
 * lifted comments between the body statements.
 *
 * The lift ports the legacy CST builder's `_liftStandaloneComments` /
 * `_maybeEmitComment` (`@jesscss/css-parser` builders) — the exact source the
 * bridge oracle (`bridge.ts` `case 'Comment'`) consumes:
 *   - A comment is emitted VERBATIM from its own source bytes (the `/* … *​/`
 *     text), never from an over-wide node span (which would re-dump the enclosing
 *     scope — the prior O(n²) bug).
 *   - A comment on the same source line as the FOLLOWING node stays inline
 *     (trivia, not lifted) ONLY when that node is a nested rule; before a
 *     declaration (or at the root) it is always lifted.
 *   - Line comments (`// …`) are DROPPED (Less drops them; the bridge's Comment
 *     case returns null for `//`), so this family never emits them.
 *
 * Boundary: front-end only — touches `../../tree2` + the sibling ruleset family's
 * public `RULESET_ACTIONS`; never the legacy `../../tree`.
 */
import * as t2 from '../../tree2/index.js';
import {
  type BuildAction,
  type BuildArgs,
  type Span,
  isStatement
} from '../host-context.js';
import { RULESET_ACTIONS } from './ruleset.js';

/** The ruleset family's own (comment-blind) builders — reused for the selector /
 *  statement derivation so this family adds ONLY the comment interleave. */
const baseRuleset = RULESET_ACTIONS.find(a => a.type === 'Ruleset')!.build;

/** A body statement paired with its source span (from the parallel rawChildren). */
interface SpannedStatement {
  readonly node: t2.Statement;
  readonly start: number;
  readonly end: number;
}

/** Whether offsets `a` and `b` sit on the same source line (no `\n` between). */
function sameLine(src: string, a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.min(Math.max(a, b), src.length);
  for (let i = lo; i < hi; i++) {
    if (src.charCodeAt(i) === 10 /* \n */) {
      return false;
    }
  }
  return true;
}

/**
 * Scan `src[gapStart, gapEnd)` for comments and push a `Comment` for each
 * STANDALONE block comment. A block comment stays inline (skipped) when it ends on
 * the same line the following node starts on AND that node is a nested rule. Line
 * comments are always skipped (dropped by Less). Ports `_scanStandaloneComments` +
 * `_maybeEmitComment`.
 */
function scanStandalone(
  src: string,
  gapStart: number,
  gapEnd: number,
  followingStart: number | undefined,
  followingIsNestedRule: boolean,
  out: t2.Statement[]
): void {
  let i = gapStart;
  while (i < gapEnd) {
    const c = src.charCodeAt(i);
    // Block comment: /* … */
    if (c === 47 /* / */ && src.charCodeAt(i + 1) === 42 /* * */) {
      let j = i + 2;
      while (j + 1 < gapEnd && !(src.charCodeAt(j) === 42 && src.charCodeAt(j + 1) === 47)) {
        j++;
      }
      const end = Math.min(j + 2, gapEnd);
      const inline =
        followingIsNestedRule && followingStart !== undefined && sameLine(src, end - 1, followingStart);
      if (!inline) {
        out.push(t2.comment(src.slice(i, end)));
      }
      i = end;
      continue;
    }
    // Line comment: // … (to end of line) — dropped, but advance past it.
    if (c === 47 /* / */ && src.charCodeAt(i + 1) === 47 /* / */) {
      let j = i + 2;
      while (j < gapEnd && src.charCodeAt(j) !== 10 && src.charCodeAt(j) !== 13) {
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
}

/**
 * Interleave lifted standalone comments between `statements`, scanning the source
 * gaps [bodyStart … stmt.start), each inter-statement gap, and the trailing gap.
 * Ports `_liftStandaloneComments`.
 */
function liftComments(
  src: string,
  statements: readonly SpannedStatement[],
  bodyStart: number,
  bodyEnd: number,
  atRoot: boolean
): t2.Statement[] {
  const out: t2.Statement[] = [];
  let gapStart = bodyStart;
  for (const s of statements) {
    if (s.start >= gapStart) {
      const followingIsNestedRule = !atRoot && s.node instanceof t2.Rule;
      scanStandalone(src, gapStart, s.start, s.start, followingIsNestedRule, out);
      gapStart = s.end;
    }
    out.push(s.node);
  }
  // Trailing gap (after the last node): no following node → always standalone.
  scanStandalone(src, gapStart, bodyEnd, undefined, false, out);
  return out;
}

/** Pair each statement child with its source span from the parallel rawChildren. */
function spannedStatements(args: BuildArgs): SpannedStatement[] {
  const out: SpannedStatement[] = [];
  for (let i = 0; i < args.children.length; i++) {
    const node = args.children[i];
    if (!isStatement(node)) {
      continue;
    }
    const raw = args.rawChildren[i] as { span?: Span } | undefined;
    if (!raw?.span) {
      continue;
    }
    out.push({ node, start: raw.span.start, end: raw.span.end });
  }
  return out;
}

const stylesheet: BuildAction = {
  type: 'Stylesheet',
  build: (args) => {
    const src = args.ctx.src;
    // Stylesheet span ends at the last consumed statement; trailing trivia (a
    // comment on the last line) sits past `span.end` — scan to the true source end.
    const bodyStart = args.span.start;
    const bodyEnd = Math.max(args.span.end, src.length);
    const body = liftComments(src, spannedStatements(args), bodyStart, bodyEnd, true);
    return t2.root(body);
  }
};

const ruleset: BuildAction = {
  type: 'Ruleset',
  build: (args) => {
    const src = args.ctx.src;
    // Reuse the ruleset family's selector derivation (its own build), then rebuild
    // the body with lifted comments interleaved.
    const base = baseRuleset(args);
    if (!(base instanceof t2.Rule)) {
      return base;
    }
    // Body window: [after `{` … before the matching `}`], mirroring _buildRuleset.
    const selectorSpan = (args.rawChildren[0] as { span?: Span } | undefined)?.span;
    const braceIdx = src.indexOf('{', selectorSpan ? selectorSpan.end : args.span.start);
    const bodyStart = braceIdx >= 0 ? braceIdx + 1 : args.span.start;
    const closeIdx = src.lastIndexOf('}', args.span.end - 1);
    const bodyEnd = closeIdx >= bodyStart ? closeIdx : args.span.end;
    const body = liftComments(src, spannedStatements(args), bodyStart, bodyEnd, false);
    return new t2.Rule(base.selector, body, base.extendInstructions);
  }
};

export const COMMENTS_ACTIONS: readonly BuildAction[] = [stylesheet, ruleset];
