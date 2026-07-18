/**
 * Comments family: lift STANDALONE block comments (`/* … *​/`)
 * into `Comment` body children, in source order.
 *
 * Comments are parseman TRIVIA — no `build('Comment', …)` call is ever emitted —
 * so this family cannot register a per-type action for a "Comment" grammar rule.
 * Instead it OVERRIDES the `Stylesheet` and `Ruleset` body-assembly actions
 * (appended AFTER the ruleset family in `ACTION_LIST`, so its `type` entries win),
 * reusing the ruleset family's selector/statement derivation and then INTERLEAVING
 * lifted comments between the body statements.
 *
 * Source of truth is the parser's per-node TRIVIA LOG (P0): each build receives
 * the comment ranges its rule consumed (`blockCommentTrivia`), so the lift reads
 * structured comment spans instead of re-tokenizing `ctx.src`. Rules:
 *   - A comment is emitted VERBATIM from its own source bytes; block comments only
 *     (line `// …` comments are dropped by Less, so the log helper omits them).
 *   - A comment on the same source line as the FOLLOWING node stays inline
 *     (trivia, not lifted) ONLY when that node is a nested rule; before a
 *     declaration (or at the root) it is always lifted.
 *
 * The one gap the per-node log can't cover is the Stylesheet TRAILING region: the
 * parser consumes end-of-source trivia in a throwaway context that never reaches
 * the root node's log, so a trailing root comment (`a{}\n/* c *​/`) is lifted by a
 * small residual source scan — see `scanTrailingBlockComments`. A ruleset's
 * trailing region (before `}`) IS in the log and needs no scan.
 *
 * Boundary: front-end only — touches `../../tree2` + the sibling ruleset family's
 * public `RULESET_ACTIONS`; never the legacy `../../tree`.
 */
import * as t2 from '../../index.js';
import {
  type BuildAction,
  type BuildArgs,
  type CommentRange,
  type Span,
  blockCommentTrivia,
  isStatement,
  rulesetBodyWindow,
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
 * Emit a `Comment` for `src[start, end)` unless it is inline — i.e. it ends on
 * the same source line the following node starts on AND that node is a nested
 * rule (whose leading trivia the serializer recovers from the trivia map). A
 * same-line comment ahead of a declaration, or at the root, is always lifted.
 */
function maybeEmitComment(
  src: string,
  start: number,
  end: number,
  followingStart: number | undefined,
  followingIsNestedRule: boolean,
  out: t2.Statement[]
): void {
  if (followingIsNestedRule && followingStart !== undefined && sameLine(src, end - 1, followingStart)) {
    return;
  }
  out.push(t2.comment(src.slice(start, end)));
}

/**
 * Interleave lifted standalone comments (from the trivia-log `comments`, in
 * source order) between `statements`. Each source gap `[gapStart, stmt.start)`
 * emits the comments that fall in it; comments inside a statement's own span are
 * skipped (its inline trivia). The trailing region after the last statement emits
 * its comments too — from the log for a ruleset, and (since the root log omits
 * end-of-source trivia) from a residual source scan for the stylesheet.
 */
function liftComments(
  src: string,
  statements: readonly SpannedStatement[],
  comments: readonly CommentRange[],
  bodyStart: number,
  bodyEnd: number,
  atRoot: boolean
): t2.Statement[] {
  const out: t2.Statement[] = [];
  let ci = 0;
  let gapStart = bodyStart;
  const emitGap = (gapEnd: number, followingStart: number | undefined, followingIsNestedRule: boolean) => {
    while (ci < comments.length && comments[ci]!.start < gapStart) ci++;
    while (ci < comments.length && comments[ci]!.start < gapEnd) {
      const { start, end } = comments[ci++]!;
      maybeEmitComment(src, start, end, followingStart, followingIsNestedRule, out);
    }
  };
  for (const s of statements) {
    if (s.start >= gapStart) {
      const followingIsNestedRule = !atRoot && s.node.type === 'Rule';
      emitGap(s.start, s.start, followingIsNestedRule);
      gapStart = s.end;
    }
    out.push(s.node);
  }
  // Trailing region (after the last node): no following node → always standalone.
  if (atRoot) {
    scanTrailingBlockComments(src, gapStart, bodyEnd, out);
  } else {
    emitGap(bodyEnd, undefined, false);
  }
  return out;
}

/**
 * Residual source scan for the Stylesheet TRAILING gap only: emit a `Comment` for
 * each block comment in `src[gapStart, bodyEnd)`. Needed because the parser drops
 * end-of-source trivia from the root node's trivia log (it is consumed in a
 * throwaway trailing-trivia context), so these comments never reach the log.
 * TODO(A0.2): remove once the tree2 driver threads the end-of-source trivia run
 * onto the Stylesheet node (a `dispatch-host` change, out of this task's scope).
 */
function scanTrailingBlockComments(src: string, gapStart: number, gapEnd: number, out: t2.Statement[]): void {
  let i = gapStart;
  while (i < gapEnd) {
    const c = src.charCodeAt(i);
    if (c === 47 /* / */ && src.charCodeAt(i + 1) === 42 /* * */) {
      let j = i + 2;
      while (j + 1 < gapEnd && !(src.charCodeAt(j) === 42 && src.charCodeAt(j + 1) === 47)) j++;
      const end = Math.min(j + 2, gapEnd);
      out.push(t2.comment(src.slice(i, end)));
      i = end;
      continue;
    }
    if (c === 47 /* / */ && src.charCodeAt(i + 1) === 47 /* / */) {
      let j = i + 2;
      while (j < gapEnd && src.charCodeAt(j) !== 10 && src.charCodeAt(j) !== 13) j++;
      i = j;
      continue;
    }
    i++;
  }
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
    const body = liftComments(src, spannedStatements(args), blockCommentTrivia(args.triviaLog), bodyStart, bodyEnd, true);
    return t2.root(body);
  }
};

const ruleset: BuildAction = {
  type: 'Ruleset',
  build: (args) => {
    // Reuse the ruleset family's selector derivation (its own build), then rebuild
    // the body with lifted comments interleaved.
    const base = baseRuleset(args);
    if (!(t2.isNode(base) && base.type === 'Rule')) {
      return base;
    }
    // Body window: [after `{` … before `}`], from the brace literal leaves.
    const window = rulesetBodyWindow(args.rawChildren) ?? { start: args.span.start, end: args.span.end };
    const body = liftComments(
      args.ctx.src,
      spannedStatements(args),
      blockCommentTrivia(args.triviaLog),
      window.start,
      window.end,
      false
    );
    return t2.rule(base.selector, body, base.extendInstructions, base.guard);
  }
};

export const COMMENTS_ACTIONS: readonly BuildAction[] = [stylesheet, ruleset];
