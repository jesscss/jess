import { parseCssCst } from '../src/cst.js';

function segmentText(tree: ReturnType<typeof parseCssCst>['tree']): Array<[string, string]> {
  return tree.rules.map((child) => {
    if (child._tag !== 'node') {
      throw new Error('expected a prelude segment node');
    }
    return [child.grammarType, child.rules.map((leaf) => {
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
    const result = parseCssCst(source, 'AtRulePreludeSegments');

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.unconsumedFrom).toBeNull();
    const trivia = result.rootTrivia?.index.entries;
    expect(trivia).toBeDefined();
    expect(Array.from({ length: trivia?.length ?? 0 }, (_, index) => trivia?.text(index, source))).toContain('/*note*/');
    expect(segmentText(result.tree)).toEqual([
      ['AtRulePreludeWhitespace', ' '],
      ['AtRulePreludeText', 'screen'],
      ['AtRulePreludeComma', ','],
      ['AtRulePreludeWhitespace', ' '],
      ['AtRulePreludeText', 'func'],
      ['AtRulePreludeGroup', '(") /* ] */")'],
      ['AtRulePreludeWhitespace', ' '],
      ['AtRulePreludeQuoted', '"x y"'],
      ['AtRulePreludeWhitespace', ' '],
      ['AtRulePreludeGroup', '[theme=") /* ] */"]'],
      ['AtRulePreludeWhitespace', ' '],
      ['AtRulePreludeText', 'foo\\ bar'],
      ['AtRulePreludeWhitespace', ' ']
    ]);
  });

  test('does not accept dialect interpolation as a static-CSS segment', () => {
    const result = parseCssCst('@{theme}', 'AtRulePreludeSegments');

    /*
     * `ok` is false because `{theme}` is left over, which is the point of this
     * test: the static-CSS segment rule consumes `@` and refuses the rest.
     * `ok` means "this tree accounts for the whole input" for every start rule,
     * not just the document one — a caller that wants prefix semantics reads
     * `unconsumedFrom`, which is exact. This previously read `true`, which is
     * how a truncated stylesheet could report success with an empty `errors`.
     */
    expect(result.ok).toBe(false);
    expect(result.unconsumedFrom).toBe(1);
    expect(segmentText(result.tree)).toEqual([['AtRulePreludeText', '@']]);
  });
});
