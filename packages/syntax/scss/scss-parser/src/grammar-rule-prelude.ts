import { authoredSource, isExtendInstruction, rule, selist, simpleSelector, sourceStartOf, withBlockBody } from '@jesscss/core/ast';
import type { AstSourceSpan, Ruleset, SelectorList, SimpleSelector } from '@jesscss/core/ast';
import { InvalidRulePreludeError } from '@jesscss/core/diagnostics';
import { reportRecovered, requireSelectorList, requireToken, statementChildren } from './grammar-helpers.js';

/** What a rule's prelude holds past any selector: its span, and the parse state its error reports through. */
export class RulePreludeRest {
  readonly start: number;
  readonly end: number;
  readonly state: unknown;

  constructor(start: number, end: number, state: unknown) {
    this.start = start;
    this.end = end;
    this.state = state;
  }
}

/** The bytes at a span, for a rule whose node keeps them: a raw-grammar run has no source to quote. */
export function writtenAt(span: AstSourceSpan, state: unknown, what: string): string {
  return typeof state === 'object' && state !== null && 'source' in state ? authoredSource(span, state, what) : '';
}

/**
 * A prelude no selector reads, as written, in one simple selector, and the error
 * at it (ledger P45). A raw-grammar run keeps no reports.
 */
function unreadableRulePrelude({ end, state }: RulePreludeRest, start: number): SelectorList {
  const written = writtenAt({ start, end }, state, 'A rule prelude');
  const text = written.trim();
  const offset = start + written.length - written.trimStart().length;
  const selector = simpleSelector(text);
  reportRecovered(new InvalidRulePreludeError(offset, offset + text.length, selector), state);
  return selist(selector);
}

/** A known pseudo its argument rule cannot read, as written in one simple selector, and the error at it (ledger P45). */
export function unreadablePseudo(span: AstSourceSpan, state: unknown): SimpleSelector {
  const selector = simpleSelector(writtenAt(span, state, 'A pseudo'));
  reportRecovered(new InvalidRulePreludeError(span.start, span.end, selector), state);
  return selector;
}

/**
 * A rule from its children: a selector, a prelude's rest or both, then the block.
 * It takes no span or state, which every rule would pay for, since the rest carries its own.
 */
export function ruleFromPrelude(children: readonly unknown[], rawChildren: readonly unknown[]): Ruleset {
  const first = children[0];
  const second = children[1];
  const open = second instanceof RulePreludeRest ? 2 : 1;
  if (children.length < open + 2 || requireToken(children[open]).value !== '{' || requireToken(children[children.length - 1]).value !== '}') {
    throw new TypeError('SCSS rule produced unexpected children.');
  }
  const prelude = first instanceof RulePreludeRest
    ? unreadableRulePrelude(first, first.start)
    : second instanceof RulePreludeRest
      ? unreadableRulePrelude(second, sourceStartOf(requireSelectorList(first)))
      : requireSelectorList(first);
  const extendInstructions = children.filter(isExtendInstruction);
  return withBlockBody(rule(
    prelude,
    statementChildren(children.slice(open + 1, -1), true),
    extendInstructions.length > 0 ? extendInstructions : undefined
  ), rawChildren);
}
