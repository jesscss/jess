import { serializeTypes } from '@jesscss/core';
import { Parser } from '../src/jess.js';

const parser = new Parser();
const parse = parser.parse;

describe('bare keyword mixin param/arg is a Keyword node (not a raw string)', () => {
  it('mixin param default (.default(@a: inherit))', () => {
    const { errors, tree } = parse('.default(@a: inherit) {}', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Keyword');
    expect(out).not.toContainString('value: \'inherit\'');
  });

  it('named arg (.m(@a: A))', () => {
    const { errors, tree } = parse('.m(@a: A);', 'MixinCall');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Keyword');
    expect(out).not.toContainString('value: \'A\'');
  });
});
