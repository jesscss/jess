import { beforeEach, describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Context } from '../../context.js';
import { any, comment, decl, el, rules, ruleset, sel, vardecl } from '../index.js';
import { createTriviaMap } from '../util/trivia.js';

const token = (image: string, tokenTypeName = 'WS'): IToken => ({
  image,
  tokenType: { name: tokenTypeName } as IToken['tokenType'],
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

describe('Comment', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders block comment syntax through toTrimmedString()', () => {
    expect(comment('/* keep me */').toTrimmedString()).toBe('/* keep me */');
  });

  it('renders visible block comments through render(context)', () => {
    const node = comment('/* keep me */');

    expect(node.render(context)).toBe('/* keep me */');
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
  });

  it('preserves printable block trivia before invisible nodes', () => {
    const hidden = vardecl({ name: 'tone', value: any('red') });
    hidden._location = [100, 1, 1, 110, 1, 11];
    const visible = ruleset({
      selector: sel([el('.a')]),
      rules: rules([
        decl({ name: any('color'), value: any('red') })
      ])
    });
    visible._location = [120, 8, 1, 136, 10, 1];
    const trivia = createTriviaMap({
      before: new Map([
        [hidden.location[0], [
          token('// source-only', 'LineComment'),
          token('\n'),
          token('/*\n\n    Comment\n\n*/', 'Comment'),
          token('\n\n'),
          token('/*\n * Keep indent\n */', 'Comment'),
          token('\n')
        ]]
      ]),
      after: new Map<number, IToken[]>()
    });

    expect(rules([hidden, visible]).toString({ context, trivia })).toBe(`/*

    Comment

*/
/*
 * Keep indent
 */
.a {
  color: red;
}
`);
  });

  it('preserves printable block trivia before visible rulesets', () => {
    const visible = ruleset({
      selector: sel([el('.a')]),
      rules: rules([
        decl({ name: any('color'), value: any('red') })
      ])
    });
    visible._location = [100, 8, 1, 116, 10, 1];
    visible.value.selector._location = visible.location;
    const trivia = createTriviaMap({
      before: new Map([
        [visible.location[0], [
          token('/* Colors\n * ------\n */', 'Comment'),
          token('\n')
        ]]
      ]),
      after: new Map<number, IToken[]>()
    });

    expect(rules([visible]).toString({ context, trivia })).toBe(`/* Colors
 * ------
 */
.a {
  color: red;
}
`);
  });

  it('keeps block trivia from hidden nodes on its own line', () => {
    const hidden = vardecl({ name: 'void-result', value: any('') });
    hidden._location = [100, 1, 1, 110, 1, 11];
    const visible = decl({ name: any('color'), value: any('green') });
    visible._location = [140, 4, 3, 152, 4, 15];
    const container = ruleset({
      selector: sel([el('.a')]),
      rules: rules([hidden, visible])
    });
    container._location = [90, 1, 1, 160, 5, 1];
    const hiddenPost = [
      token(' '),
      token('/* results in void */', 'Comment'),
      token('\n\n  ')
    ];
    const trivia = createTriviaMap({
      before: new Map([
        [visible.location[0], hiddenPost]
      ]),
      after: new Map([
        [hidden.location[3], hiddenPost]
      ])
    });

    expect(rules([container]).toString({ context, trivia })).toBe(`.a {
  /* results in void */
  color: green;
}
`);
  });

  it('uses context-owned trivia for cloned nodes with source offsets', () => {
    const empty = rules([]);
    empty._location = [100, 1, 1, 100, 1, 1];
    const visible = decl({ name: any('color'), value: any('red') });
    visible._location = [120, 2, 3, 130, 2, 13];
    const container = ruleset({
      selector: sel([el('.a')]),
      rules: rules([empty, visible])
    });
    const trivia = createTriviaMap({
      before: new Map([
        [empty.location[0], [
          token('/**/', 'Comment')
        ]]
      ]),
      after: new Map<number, IToken[]>()
    });
    context.opts.trivia = trivia;

    expect(rules([container]).toString({ context })).toBe(`.a {
  /**/
  color: red;
}
`);
  });

  it('preserves printable block trivia after visible rulesets', () => {
    const visible = ruleset({
      selector: sel([el('.a')]),
      rules: rules([
        decl({ name: any('color'), value: any('red') })
      ])
    });
    visible._location = [100, 8, 1, 116, 10, 1];
    const tokens = [
      token('\n'),
      token('/*comment on last line*/', 'Comment'),
      token('\n')
    ];
    const trivia = createTriviaMap({
      before: new Map([[Infinity, tokens]]),
      after: new Map([
        [visible.location[3], tokens]
      ])
    });

    expect(rules([visible]).toString({ context, trivia })).toBe(`.a {
  color: red;
}
/*comment on last line*/
`);
  });

  it('resolves comments without touching render state', async () => {
    const resolved = await comment('/* keep me */').resolve(context);

    expect(resolved.toTrimmedString()).toBe('/* keep me */');
    expect(context.printState.writer).toBeUndefined();
  });
});
