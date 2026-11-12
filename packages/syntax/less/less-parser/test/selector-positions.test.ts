import { describe, expect, it } from 'vitest';
import { selectorBranchCanonical } from '@jesscss/core/ast';
import type { ExtendInstruction, SelectorList } from '@jesscss/core/ast';
import { parse } from '../src/index.js';

/*
 * The selector, extend and at-rule body reducers read their children by the
 * position the production fixes. A late or early read either drops a part of the
 * selector or body without an error or reads the wrong child, so each case writes
 * every optional part and checks it survives.
 */

type Found = { selectors: string[]; extends: string[]; body: string[] };

/** The first node in the tree with a selector or a body, depth first, as its parts. */
function first(node: unknown, type: string): Found {
  const seen: unknown[] = [node];
  for (let i = 0; i < seen.length; i++) {
    const value = seen[i];
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    if ('type' in value && value.type === type) {
      return {
        selectors: 'selector' in value && isList(value.selector) ? value.selector.selectors.map(selectorBranchCanonical) : [],
        extends: 'extendInstructions' in value && Array.isArray(value.extendInstructions)
          ? value.extendInstructions.map(describeExtend)
          : [],
        body: 'rules' in value && Array.isArray(value.rules) ? value.rules.map(describeRule) : []
      };
    }
    for (const child of Object.values(value)) {
      seen.push(child);
    }
  }
  throw new Error(`no ${type}`);
}

function isList(value: unknown): value is SelectorList {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'SelectorList';
}

function describeExtend(instruction: ExtendInstruction): string {
  const subject = instruction.subject === undefined ? '' : `${instruction.subject.selectors.map(selectorBranchCanonical).join(',')} `;
  return `${subject}-> ${instruction.target.selectors.map(selectorBranchCanonical).join(',')}${instruction.partial ? ' all' : ''}`;
}

function describeRule(rule: unknown): string {
  if (typeof rule === 'object' && rule !== null && 'type' in rule) {
    return rule.type === 'Declaration' && 'name' in rule && typeof rule.name === 'string' ? rule.name : String(rule.type);
  }
  return typeof rule;
}

const BODY = '{ first: 1; second: 2 }';
const FIRST = ['first', 'second'];

describe('Less selector positions', () => {
  it('keeps every branch of a selector list', () => {
    expect(first(parse(`.a, .b > .c ${BODY}`), 'Ruleset').selectors).toEqual(['.a', '.b > .c']);
  });

  it('keeps a compound and its combinators', () => {
    expect(first(parse(`div.a#b:hover > .c ~ .d .e ${BODY}`), 'Ruleset').selectors).toEqual(['div.a#b:hover > .c ~ .d .e']);
  });

  it('keeps every branch of a pseudo argument, with and without a leading combinator', () => {
    expect(first(parse(`.p:is(.a, .b .c) ${BODY}`), 'Ruleset').selectors).toEqual(['.p:is(.a, .b .c)']);
    expect(first(parse(`.p:has(> .a .b, + .c) ${BODY}`), 'Ruleset').selectors).toEqual(['.p:has(> .a .b, + .c)']);
  });

  it('keeps a nested leading combinator', () => {
    expect(first(parse(`.p { > .c ${BODY} }`), 'Ruleset').body).toEqual(['Ruleset']);
    const nested = parse(`.p { > .c ${BODY} }`);
    const outer = first(nested, 'Ruleset');
    expect(outer.selectors).toEqual(['.p']);
    expect(JSON.stringify(nested)).toContain('RelativeSelector');
  });

  it.each([
    ['an inline extend', `.a:extend(.z) ${BODY}`, ['.a -> .z']],
    ['an inline extend with `all`', `.a:extend(.z all) ${BODY}`, ['.a -> .z all']],
    ['a list-wide `!all`', `.a:extend(.y, .z !all) ${BODY}`, ['.a -> .y all', '.a -> .z all']],
    ['a complex extend subject', `.x > .y:extend(.z) ${BODY}`, ['.x > .y -> .z']],
    ['an extend on the second branch', `.b, .a:extend(.z) ${BODY}`, ['.a -> .z']],
    ['a body extend', `.a { &:extend(.z); first: 1; second: 2 }`, ['-> .z']]
  ])('keeps %s', (_label, source, expected) => {
    expect(first(parse(source), 'Ruleset').extends).toEqual(expected);
  });

  it('keeps a body extend and the first statement after it', () => {
    expect(first(parse(`.a { &:extend(.z); first: 1; second: 2 }`), 'Ruleset').body).toEqual(FIRST);
  });

  it.each([
    ['a detached ruleset', `@d: ${BODY};`, 'AnonymousMixin'],
    ['@supports', `@supports (display: grid) ${BODY}`, 'AtRuleBlock'],
    ['@media', `.p { @media screen ${BODY} }`, 'AtRuleBlock'],
    ['a generic at-rule', `@page :first ${BODY}`, 'AtRuleBlock'],
    ['@layer', `@layer base ${BODY}`, 'AtRuleBlock'],
    ['a named each() callback', `.p { each(@list, .(@v) ${BODY}); }`, 'For']
  ])('keeps the first statement of %s', (_label, source, type) => {
    expect(first(parse(source), type).body).toEqual(FIRST);
  });
});
