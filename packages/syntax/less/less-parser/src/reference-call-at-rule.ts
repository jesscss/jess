/*
 * What `ReferenceCallOrAtRule` builds when the token after its call head makes it
 * an at-rule: the head's bytes start the prelude and the rest continues it.
 */
import type { Span } from 'parseman';
import type { Any, AtRuleBlock, AtRuleStatement, ExtendInstruction, Interpolation, SourceSpan, Statement, UnknownAtRuleBlock } from '@jesscss/core/ast';
import { any, atRuleBlock, atRuleStatement, bodySpanFromRaw, holdsInterpolationOpener, interpolation, isInterpolation, isSpannedToken, semanticGapText, sourceEndOf, sourceStartOf, unknownAtRuleBlock, withBodySpan, withoutLineComments, withSourceSpan } from '@jesscss/core/ast';
import { isAny, readBody, isLessTerminalText, isReferenceTailFact, isVarRef, staticText, variableNameText } from './grammar-helpers.js';
import { LessUnresolvedPreludeInterpolationError } from './parse-error.js';
import { rejectBareVariable, reportRecovered } from './parse-state.js';

type BlockTail = {
  readonly rules: Statement[];
  readonly extensions: readonly ExtendInstruction[];
  readonly bodySpan: SourceSpan | undefined;
};
type OpaqueTail = { readonly rawBody: string };

export function atRuleBlockTailFrom(children: readonly unknown[], rawChildren: readonly unknown[]): BlockTail {
  const rules: Statement[] = [];
  const extensions = readBody(children, 0, rules);
  return { rules, extensions, bodySpan: bodySpanFromRaw(rawChildren) };
}

/* The body capture emits no child when the block is empty, as in `UnknownAtRuleBlock`. */
export function unknownAtRuleBlockTailFrom(children: readonly unknown[]): OpaqueTail {
  return { rawBody: children.length === 3 ? staticText(children[1]) : '' };
}

function isBlockTail(value: unknown): value is BlockTail {
  return typeof value === 'object' && value !== null && 'bodySpan' in value;
}

function isOpaqueTail(value: unknown): value is OpaqueTail {
  return typeof value === 'object' && value !== null && 'rawBody' in value;
}

/**
 * The head of an at-rule is its prelude, where a bare `@name` is an error (ledger
 * P7). Walks what the head read, not its bytes, so a string's `@x` is not one, and
 * neither is a `@{…}`. A named argument is a declaration value, which P7 exempts.
 * A value the head read may carry no span of its own; the error then points at the head.
 */
function rejectBareVariableIn(value: unknown, head: Span): void {
  if (Array.isArray(value)) {
    value.forEach(item => rejectBareVariableIn(item, head));
    return;
  }
  if (typeof value !== 'object' || value === null || isInterpolation(value)) {
    return;
  }
  if ('spread' in value && 'name' in value && value.name !== undefined) {
    return;
  }
  if (isVarRef(value)) {
    const start = sourceStartOf(value);
    if (start < 0) {
      rejectBareVariable(head.start, head.end, value.name);
    }
    rejectBareVariable(start, sourceEndOf(value), value.name);
  }
  Object.values(value).forEach(item => rejectBareVariableIn(item, head));
}

/**
 * What `ReferenceCallOrAtRule` read past its head, as an at-rule, or `null` when
 * the head stayed a call. The name is its token's bytes, as for any generic
 * at-rule (ledger P39, P40). The head's source reads as a prelude group does, and
 * the rest continues it with a space if one was left. A `@{…}` these bytes cannot
 * resolve must not reach the CSS, so it is reported on the at-rule (ledger P52).
 */
export function atRuleAfterReferenceCall(
  children: readonly unknown[],
  rawChildren: readonly unknown[],
  span: Span,
  state: unknown
): AtRuleBlock | UnknownAtRuleBlock | AtRuleStatement | null {
  let at = 2;
  while (isReferenceTailFact(children[at])) {
    at++;
  }
  const next = children[at];
  if (next === undefined || isLessTerminalText(next, ';') || (next === null && children[at + 1] === undefined)) {
    return null;
  }
  const raw = rawChildren[at];
  if (!isSpannedToken(raw)) {
    throw new TypeError('Less reference call lost the source of its head.');
  }
  let text = '';
  let end = -1;
  for (let index = 2; index < at; index++) {
    const piece = rawChildren[index];
    if (!isSpannedToken(piece)) {
      throw new TypeError('Less reference call lost the source of its head.');
    }
    text += end !== -1 && piece.span.start > end ? ` ${piece.value}` : piece.value;
    end = piece.span.end;
  }
  children.slice(2, at).forEach(value => rejectBareVariableIn(value, { start: span.start, end }));
  const head = semanticGapText(withoutLineComments(text, true));
  const opener = raw.span.start > end ? `${head} ` : head;
  const parts = isInterpolation(next) ? next.parts : null;
  const src = isAny(next) ? opener + next.src : head;
  const bytes = parts === null ? src : opener + parts.map(part => 'lit' in part ? part.lit : '').join('');
  const body = children[at + 1];
  const atRule = atRuleWithBody(`@${variableNameText(children[1])}`, parts === null ? any(src) : interpolation([{ lit: opener }, ...parts]), src, body, span);
  if (holdsInterpolationOpener(head)) {
    reportRecovered(new LessUnresolvedPreludeInterpolationError(span.start, end, atRule), state);
  } else if (holdsInterpolationOpener(bytes) || (parts !== null && isOpaqueTail(body))) {
    reportRecovered(new LessUnresolvedPreludeInterpolationError(raw.span.start, raw.span.end, atRule), state);
  }
  return atRule;
}

function atRuleWithBody(name: string, prelude: Any | Interpolation, src: string, body: unknown, span: Span): AtRuleBlock | UnknownAtRuleBlock | AtRuleStatement {
  if (isOpaqueTail(body)) {
    return unknownAtRuleBlock(name, src, body.rawBody);
  }
  if (!isBlockTail(body)) {
    return atRuleStatement(name, prelude);
  }
  const atRule = atRuleBlock(name, prelude, body.rules, body.extensions);
  return withSourceSpan(body.bodySpan === undefined ? atRule : withBodySpan(atRule, body.bodySpan), span);
}
