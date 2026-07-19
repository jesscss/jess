import { parseCss } from '../src/cst-css.js';

function segmentText(tree: ReturnType<typeof parseCss>['tree']): Array<[string, string]> {
  return tree.children.map((child) => {
    if (child._tag !== 'node') {
      throw new Error('expected a prelude segment node');
    }
    return [child.grammarType, child.children.map((leaf) => {
      if (leaf._tag !== 'leaf') {
        throw new Error('expected a segment leaf');
      }
      return leaf.value;
    }).join('')];
  });
}

describe('lossless at-rule prelude segments', () => {
  test('direct CST grammar keeps every header byte in a typed segment', () => {
    const source = ' screen/*note*/, func(") /* ] */") "x y" [theme=") /* ] */"] foo\\ bar ';
    const result = parseCss(source, 'AtRulePreludeSegments');

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.unconsumedFrom).toBeNull();
    expect(segmentText(result.tree)).toEqual([
      ['AtPreludeWhitespace', ' '],
      ['AtPreludeText', 'screen'],
      ['AtPreludeComment', '/*note*/'],
      ['AtPreludeComma', ','],
      ['AtPreludeWhitespace', ' '],
      ['AtPreludeText', 'func'],
      ['AtPreludeGroup', '(") /* ] */")'],
      ['AtPreludeWhitespace', ' '],
      ['AtPreludeQuoted', '"x y"'],
      ['AtPreludeWhitespace', ' '],
      ['AtPreludeGroup', '[theme=") /* ] */"]'],
      ['AtPreludeWhitespace', ' '],
      ['AtPreludeText', 'foo\\ bar'],
      ['AtPreludeWhitespace', ' '],
    ]);
  });

  test('does not accept dialect interpolation as a static-CSS segment', () => {
    const result = parseCss('@{theme}', 'AtRulePreludeSegments');

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBe(1);
    expect(segmentText(result.tree)).toEqual([['AtPreludeText', '@']]);
  });
});
