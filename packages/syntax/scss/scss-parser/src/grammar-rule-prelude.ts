import { authoredSource, isExtendInstruction, rule, selist, simpleSelector, withBlockBody } from '@jesscss/core/ast';
import type { Ruleset, SelectorList } from '@jesscss/core/ast';
import { InvalidRulePreludeError } from '@jesscss/core/diagnostics';
import { reportRecovered, requireSelectorList, requireToken, statementChildren } from './grammar-helpers.js';

/** Where the rest of a rule's prelude ends, past the selector that read its start. */
export interface RulePreludeRestEnd {
  readonly preludeEnd: number;
}

export const rulePreludeRest = (span: { readonly end: number }): RulePreludeRestEnd => ({ preludeEnd: span.end });

const isRulePreludeRest = (value: unknown): value is RulePreludeRestEnd => typeof value === 'object' && value !== null && 'preludeEnd' in value;

/**
 * A prelude no selector reads, as written, in one simple selector, and the error
 * at it (ledger P45). A raw-grammar run has no source to quote and keeps no reports.
 */
function unreadableRulePrelude(rest: RulePreludeRestEnd, start: number, state: unknown): SelectorList {
  const written = typeof state === 'object' && state !== null && 'source' in state
    ? authoredSource({ start, end: rest.preludeEnd }, state, 'A rule prelude')
    : '';
  const text = written.trim();
  const offset = start + written.length - written.trimStart().length;
  const selector = simpleSelector(text);
  reportRecovered(new InvalidRulePreludeError(offset, offset + text.length, selector), state);
  return selist(selector);
}

/** A rule from its children: the selector, or the prelude's rest with or without a selector before it, then the block. */
export function ruleFromPrelude(children: readonly unknown[], span: { readonly start: number; readonly end: number }, rawChildren: readonly unknown[], state: unknown): Ruleset {
  const open = isRulePreludeRest(children[1]) ? 2 : 1;
  if (children.length < open + 2 || requireToken(children[open]).value !== '{' || requireToken(children[children.length - 1]).value !== '}') {
    throw new TypeError('SCSS rule produced unexpected children.');
  }
  const prelude = children[open - 1];
  const extendInstructions = children.filter(isExtendInstruction);
  return withBlockBody(rule(
    isRulePreludeRest(prelude) ? unreadableRulePrelude(prelude, span.start, state) : requireSelectorList(children[0]),
    statementChildren(children.slice(open + 1, -1), true),
    extendInstructions.length > 0 ? extendInstructions : undefined
  ), rawChildren);
}
