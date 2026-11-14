import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';

/*
 * The ruleset, mixin and each() reducers read the body from the child position
 * the production fixes: after the selector, the optional guard (and the gap
 * before `{`), and the `{`. Reading one child late drops the body's first
 * statement silently, so each case writes a first statement and checks it.
 */

/** Each body in the tree, depth first, as its declaration names (other statements by type). */
function bodies(node: unknown, out: string[][] = []): string[][] {
  if (typeof node === 'object' && node !== null && 'rules' in node && Array.isArray(node.rules)) {
    const rules: unknown[] = node.rules;
    if (node.type !== 'Stylesheet') {
      out.push(rules.map(rule =>
        typeof rule === 'object' && rule !== null && 'type' in rule
          ? rule.type === 'Declaration' && 'name' in rule && typeof rule.name === 'string' ? rule.name : String(rule.type)
          : typeof rule
      ));
    }
    for (const rule of rules) {
      bodies(rule, out);
    }
  }
  return out;
}

const BODY = '{ first: 1; second: 2 }';
const FIRST = ['first', 'second'];

describe('Less body start positions', () => {
  describe.each([
    ['element-led', 'div'],
    ['class-led', '.a'],
    ['id-led', '#a'],
    ['multi-branch', '.a, .b'],
    ['inline extend on the first branch', '.a:extend(.z)'],
    ['inline extend on the first of two branches', '.a:extend(.z), .b']
  ])('%s ruleset', (_label, selector) => {
    it.each([
      ['no guard', `${selector} ${BODY}`],
      ['a guard', `${selector} when (@x) ${BODY}`],
      ['a guard and comments', `${selector} /* a */ when (@x) /* b */ ${BODY}`]
    ])('keeps the first statement with %s', (_case, source) => {
      expect(bodies(parse(source))).toEqual([FIRST]);
    });
  });

  it.each([
    ['no guard', `.p { & .c ${BODY} }`],
    ['a guard', `.p { & .c when (@x) ${BODY} }`],
    ['a guard and comments', `.p { & .c /* a */ when (@x) /* b */ ${BODY} }`]
  ])('keeps the first statement of a nested `&` ruleset with %s', (_case, source) => {
    expect(bodies(parse(source))).toEqual([['Ruleset'], FIRST]);
  });

  it.each([
    ['no guard', `.m(@a) ${BODY}`],
    ['a guard', `.m(@a) when (@x) ${BODY}`],
    ['a guard and comments', `.m(@a) /* a */ when (@x) /* b */ ${BODY}`]
  ])('keeps the first statement of a mixin definition with %s', (_case, source) => {
    expect(bodies(parse(source))).toEqual([FIRST]);
  });

  it('keeps the first statement of an each() callback with comments between its arguments', () => {
    const source = `.p { each(/* a */ @list /* b */, /* c */ ${BODY}); }`;
    expect(bodies(parse(source)).at(-1)).toEqual(FIRST);
  });
});
