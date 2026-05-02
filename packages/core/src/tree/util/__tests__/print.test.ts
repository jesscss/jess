import { describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Any } from '../../../index.js';

const token = (image: string, name = 'WS'): IToken => ({
  image,
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length,
  tokenType: { name } as IToken['tokenType']
});

describe('TriviaMap serialization', () => {
  it('serializes trivia looked up before a node offset', () => {
    const node = new Any('test', undefined, [10, 1, 11, 13, 1, 14]);
    const trivia = {
      before: new Map([[10, [token('\n  '), token('/* keep */', 'BlockComment')]]]),
      after: new Map<number, IToken[]>()
    };

    expect(node.toString({ trivia })).toBe('\n  /* keep */test');
  });

  it('serializes trivia looked up after a node offset', () => {
    const node = new Any('test', undefined, [10, 1, 11, 13, 1, 14]);
    const trivia = {
      before: new Map<number, IToken[]>(),
      after: new Map([[13, [token('\n  ')]]])
    };

    expect(node.toString({ trivia })).toBe('test\n  ');
  });

  it('does not use boundary intent as trivia storage', () => {
    const node = new Any('test', { preIntent: 'explicit_space' });

    expect(node.toString()).toBe('test');
  });

  it('consumes shared trivia once across copied nodes in one print state', () => {
    const node = new Any('test', undefined, [10, 1, 11, 13, 1, 14]);
    const copied = node.copy(true);
    const tokens = [token(' '), token('/* keep me */', 'BlockComment')];
    const trivia = {
      before: new Map<number, IToken[]>(),
      after: new Map([[13, tokens]])
    };
    const options = { trivia };

    expect(node.toString(options)).toBe('test /* keep me */');
    expect(copied.toString(options)).toBe('test');
    expect(tokens.map(item => item.image)).toEqual([' ', '/* keep me */']);
  });
});
