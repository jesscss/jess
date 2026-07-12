import { N, isNode, type Node } from '@jesscss/core';
import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

/** Walk the tree collecting the first Quoted node found. */
function findQuoted(node: unknown): any | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  if ((node as any).type === 'Quoted') {
    return node;
  }
  for (const key of ['value', 'rules', 'prelude', 'name', 'path']) {
    const child = (node as any)[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        const found = findQuoted(c);
        if (found) {
          return found;
        }
      }
    } else {
      const found = findQuoted(child);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function refNames(interp: any): string[] {
  const reps = interp?.replacements ?? [];
  return reps.map((r: any) => {
    const key = r?.key;
    return typeof key === 'string' ? key : String(key?.valueOf?.() ?? key);
  });
}

describe('@{var} interpolation inside quoted strings', () => {
  it('splits a double-quoted string on @{x}', () => {
    const { tree: root, errors } = parse('.x { foo: "pre-@{x}-post"; }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const q = findQuoted(root);
    expect(q).toBeDefined();
    expect(isNode(q.value, N.Interpolated)).toBe(true);
    expect(refNames(q.value)).toEqual(['x']);
    expect(String(q.value.source)).toBe('pre-%%-post');
  });

  it('splits an escaped single-quoted string on @{a}/@{b}', () => {
    const { tree: root, errors } = parse(".x { foo: ~'@{a}/@{b}'; }", 'Stylesheet');
    expect(errors.length).toBe(0);
    const q = findQuoted(root);
    expect(q).toBeDefined();
    expect(q.escaped).toBe(true);
    expect(isNode(q.value, N.Interpolated)).toBe(true);
    expect(refNames(q.value)).toEqual(['a', 'b']);
    expect(String(q.value.source)).toBe('%%/%%');
  });

  it('interpolates an @import path @{theme}-e.less', () => {
    const { tree: root, errors } = parse('@import "@{theme}-e.less";', 'Stylesheet');
    expect(errors.length).toBe(0);
    const q = findQuoted(root);
    expect(q).toBeDefined();
    expect(isNode(q.value, N.Interpolated)).toBe(true);
    expect(refNames(q.value)).toEqual(['theme']);
  });

  it('keeps a plain string flat (no interpolation)', () => {
    const { tree: root, errors } = parse('.x { foo: "plain"; }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const q = findQuoted(root);
    expect(q).toBeDefined();
    expect(typeof q.value).toBe('string');
    expect(q.value).toBe('plain');
  });
});
