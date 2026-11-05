/*
 * What `ReferenceCallOrAtRule` builds when its call head turns out to open an
 * at-rule: the head's bytes start the prelude and the rest continues it.
 */
import type { Span } from 'parseman';
import type { AtRuleBlock, AtRuleStatement, Block, ExtendInstruction, SourceSpan, Statement, UnknownAtRuleBlock } from '@jesscss/core/ast';
import { any, atRuleBlock, atRuleStatement, block, bodySpanFromRaw, interpolation, isInterpolation, isSpannedToken, semanticGapText, sourceEndOf, sourceStartOf, spaced, unknownAtRuleBlock, withBodySpan, withSourceSpan } from '@jesscss/core/ast';
import { bodyExtensionsOf, isAny, isLessTerminalText, isLessValueSlotValue, isReferenceTailFact, isStatement, isVarRef, staticText } from './grammar-helpers.js';
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
 * The head of an at-rule is its prelude, where a bare `@name` is an error (ledger
 * P7). Walks what the head read, not its bytes, so a string's `@x` is not one. A
 * named argument is a declaration value, which P7 exempts, and a `@{…}` is not bare.
 */
function rejectBareVariableIn(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectBareVariableIn);
    return;
  }
  if (typeof value !== 'object' || value === null || isInterpolation(value)) {
    return;
  }
  if ('spread' in value && 'name' in value && value.name !== undefined) {
    return;
  }
  if (isVarRef(value)) {
    rejectBareVariable(sourceStartOf(value), sourceEndOf(value), value.name);
  }
  Object.values(value).forEach(rejectBareVariableIn);
}

function holdsInterpolation(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(holdsInterpolation);
  }
  return typeof value === 'object' && value !== null && (isInterpolation(value) || Object.values(value).some(holdsInterpolation));
}

/**
 * A head holding `@{…}`, as the paren group its one call read, so the value it
 * parsed carries the interpolation to evaluation, as a prelude group's does.
 * Other heads have no such reading: several calls or arguments do not keep their
 * gaps or which separator they had, so they stay the error they were rather than
 * print the `@{…}` unresolved.
 */
function headGroup(tails: readonly unknown[]): Block {
  const tail = tails[0];
  const argument = tails.length === 1 && isReferenceTailFact(tail) && tail.step.type === 'Call' && tail.step.args.length === 1
    ? tail.step.args[0]
    : undefined;
  if (argument === undefined || argument.name !== undefined || !isLessValueSlotValue(argument.value)) {
    throw new TypeError('Less at-rule head cannot carry an interpolation in this form.');
  }
  return block(argument.value);
}

/**
 * What `ReferenceCallOrAtRule` read past its head, as an at-rule named `name`, or
 * `null` when the head stayed a call. The head's source reads as a prelude group
 * does, one space per gap, and the rest continues it with a space if one was left.
 */
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
  const rest = isInterpolation(next) || (isAny(next) && next.src !== '') ? next : undefined;
  const group = holdsInterpolation(children.slice(2, at)) ? headGroup(children.slice(2, at)) : null;
  const prelude = group !== null
    ? (rest === undefined ? group : spaced([group, rest]))
    : isInterpolation(next)
      ? interpolation([{ lit: head }, ...next.parts])
      : any(isAny(next) ? head + next.src : head.trimEnd());
  const tail = children[at + 1];
  if (!isBlockTail(tail)) {
    return atRuleStatement(name, prelude);
  }
  const block = atRuleBlock(name, prelude, [...tail.rules], tail.extensions);
  return withSourceSpan(tail.bodySpan === undefined ? block : withBodySpan(block, tail.bodySpan), span);
}
