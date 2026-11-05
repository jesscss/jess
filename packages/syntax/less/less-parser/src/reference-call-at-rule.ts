/*
 * What `ReferenceCallOrAtRule` builds when its call head turns out to open an
 * at-rule: the head's bytes start the prelude and the rest continues it.
 */
import type { Span } from 'parseman';
import type { AtRuleBlock, AtRuleStatement, ExtendInstruction, SourceSpan, Statement, UnknownAtRuleBlock } from '@jesscss/core/ast';
import { any, atRuleBlock, atRuleStatement, bodySpanFromRaw, interpolation, isInterpolation, isSpannedToken, semanticGapText, sourceEndOf, sourceStartOf, unknownAtRuleBlock, withBodySpan, withSourceSpan } from '@jesscss/core/ast';
import { bodyExtensionsOf, isAny, isLessTerminalText, isReferenceTailFact, isStatement, isVarRef, staticText } from './grammar-helpers.js';
import { rejectBareVariable } from './parse-state.js';

type BlockTail = {
  readonly rules: readonly Statement[];
  readonly extensions: readonly ExtendInstruction[];
  readonly bodySpan: SourceSpan | undefined;
};
type OpaqueTail = { readonly prelude: unknown; readonly rawBody: string };

export function atRuleBlockTailFrom(children: readonly unknown[], rawChildren: readonly unknown[]): BlockTail {
  return { rules: children.filter(isStatement), extensions: bodyExtensionsOf(children), bodySpan: bodySpanFromRaw(rawChildren) };
}

/* The body capture emits no child when the block is empty, as in `UnknownAtRuleBlock`. */
export function unknownAtRuleBlockTailFrom(children: readonly unknown[]): OpaqueTail {
  return { prelude: children[0], rawBody: children.length === 4 ? staticText(children[2]) : '' };
}

function isBlockTail(value: unknown): value is BlockTail {
  return typeof value === 'object' && value !== null && 'bodySpan' in value;
}

function isOpaqueTail(value: unknown): value is OpaqueTail {
  return typeof value === 'object' && value !== null && 'rawBody' in value;
}

/**
 * What `ReferenceCallOrAtRule` read past its head, as an at-rule named `name`, or
 * `null` when the head stayed a call. The head's source reads as a prelude group
 * does, one space per gap, and the rest continues it with a space if one was left.
 */
/**
 * The head of an at-rule is its prelude, where a bare `@name` is an error (ledger
 * P7). Walks what the head read, not its bytes, so a string's `@x` is not one. A
 * named argument or `(name: value)` is a declaration value, which P7 exempts, and
 * a `@{…}` is not bare.
 */
function rejectBareVariableIn(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectBareVariableIn);
    return;
  }
  if (typeof value !== 'object' || value === null || isInterpolation(value)) {
    return;
  }
  if (('spread' in value && 'name' in value && value.name !== undefined) || ('type' in value && value.type === 'Branch')) {
    return;
  }
  if (isVarRef(value)) {
    rejectBareVariable(sourceStartOf(value), sourceEndOf(value), value.name);
  }
  Object.values(value).forEach(rejectBareVariableIn);
}

export function atRuleAfterReferenceCall(
  name: string,
  children: readonly unknown[],
  rawChildren: readonly unknown[],
  span: Span
): AtRuleBlock | UnknownAtRuleBlock | AtRuleStatement | null {
  let text = '';
  let end = -1;
  let at = 2;
  for (; isReferenceTailFact(children[at]); at++) {
    const piece = rawChildren[at];
    if (!isSpannedToken(piece)) {
      throw new TypeError('Less reference call lost the source of its head.');
    }
    text += end !== -1 && piece.span.start > end ? ` ${piece.value}` : piece.value;
    end = piece.span.end;
  }
  const next = children[at];
  if (next === undefined || isLessTerminalText(next, ';')) {
    return null;
  }
  children.slice(2, at).forEach(rejectBareVariableIn);
  const raw = rawChildren[at];
  const head = semanticGapText(text) + (isSpannedToken(raw) && raw.span.start > end ? ' ' : '');
  if (isOpaqueTail(next)) {
    return unknownAtRuleBlock(name, typeof next.prelude === 'string' ? head + next.prelude : head.trimEnd(), next.rawBody);
  }
  const prelude = isInterpolation(next)
    ? interpolation([{ lit: head }, ...next.parts])
    : any(isAny(next) ? head + next.src : head.trimEnd());
  const tail = children[at + 1];
  if (!isBlockTail(tail)) {
    return atRuleStatement(name, prelude);
  }
  const block = atRuleBlock(name, prelude, [...tail.rules], tail.extensions);
  return withSourceSpan(tail.bodySpan === undefined ? block : withBodySpan(block, tail.bodySpan), span);
}
