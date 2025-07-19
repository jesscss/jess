import { SelectorTree } from '../tree';
import { sellist, sel, compound, el, pseudo, co } from '..';
import { getPaths, getSelectorFromTree, getTreeNode } from '../util/selector';

describe('Selector tree', () => {
  // test.skip('get all tree paths', () => {
  //   let tree = new TreeNode('.a', [
  //     new TreeNode('.b', [
  //       new TreeNode('.c', []),
  //       new TreeNode('.d', [])
  //     ]),
  //     new TreeNode('.e', [
  //       new TreeNode('.f', []),
  //       new TreeNode('.g', [])
  //     ])
  //   ])
  //   expect(tree.getPaths()).toEqual([
  //     ['.a', '.b', '.c'],
  //     ['.a', '.b', '.d'],
  //     ['.a', '.e', '.f'],
  //     ['.a', '.e', '.g']
  //   ])
  // })

  describe('Tree nodes', () => {
    test('simple selector', () => {
      const sel1 = el('.a');
      expect(getTreeNode(sel1)).toEqual(new SelectorTree(sel1));
      expect(getSelectorFromTree(getTreeNode(sel1))).toEqual(sel1);
    });

    test('compound selector', () => {
      const sel1 = compound([el('.a'), el('.b'), el('.c')]);
      expect(getTreeNode(sel1)).toEqual(
        new SelectorTree(sel1, [
          new SelectorTree(el('.a')),
          new SelectorTree(el('.b')),
          new SelectorTree(el('.c'))
        ], 'compound')
      );
      expect(getSelectorFromTree(getTreeNode(sel1))).toEqual(sel1);
    });

    test('complex selector', () => {
      const sel1 = sel([el('.a'), co('+'), el('.b')]);
      expect(getTreeNode(sel1)).toEqual(
        new SelectorTree(sel1, [
          new SelectorTree(el('.b'), [
            new SelectorTree(co('+'), [
              new SelectorTree(el('.a'))
            ])
          ])
        ], 'complex')
      );
      expect(getSelectorFromTree(getTreeNode(sel1))).toEqual(sel1);
    });

    test(':is selector', () => {
      const p = pseudo([
        ['value', ':is'],
        ['arg', el('.a')]
      ]);
      const sel1 = compound(
        [
          p,
          el('.b')
        ]
      );
      expect(getTreeNode(sel1)).toEqual(
        new SelectorTree(sel1, [
          new SelectorTree(p, [
            new SelectorTree(el('.a'))
          ], 'is'),
          new SelectorTree(el('.b'))
        ], 'compound')
      );
      expect(getSelectorFromTree(getTreeNode(sel1))).toEqual(sel1);
    });

    test(':is selector w/ list', () => {
      const p = pseudo([
        ['value', ':is'],
        ['arg', sellist([el('.a'), el('.b')])]
      ]);
      const sel1 = compound(
        [
          p,
          el('.c')
        ]
      );
      expect(getTreeNode(p)).toEqual(
        new SelectorTree(p, [
          new SelectorTree(el('.a')),
          new SelectorTree(el('.b'))
        ], 'is')
      );
      expect(getTreeNode(sel1)).toEqual(
        new SelectorTree(sel1, [
          new SelectorTree(p, [
            new SelectorTree(el('.a')),
            new SelectorTree(el('.b'))
          ], 'is'),
          new SelectorTree(el('.c'))
        ], 'compound')
      );
      expect(getSelectorFromTree(getTreeNode(sel1))).toEqual(sel1);
    });

    test(':is selector w/ compound', () => {
      const innerCompound = compound([el('.a'), el('.b')]);
      const p = pseudo([
        ['value', ':is'],
        ['arg', innerCompound]
      ]);
      const sel1 = compound(
        [
          p,
          el('.c')
        ]
      );
      expect(getTreeNode(sel1)).toEqual(
        new SelectorTree(sel1, [
          new SelectorTree(p, [
            new SelectorTree(innerCompound, [
              new SelectorTree(el('.a')),
              new SelectorTree(el('.b'))
            ], 'compound')
          ], 'is'),
          new SelectorTree(el('.c'))
        ], 'compound')
      );
      expect(getSelectorFromTree(getTreeNode(sel1))).toEqual(sel1);
    });
  });

  describe('Find tree within tree', () => {
    test('match simple within simple', () => {
      const needle = getTreeNode(el('.a'));
      const haystack = getTreeNode(el('.a'));
      const result = haystack.find(needle);
      expect(result.matchEnd).toBe(haystack);
    });

    test('does not match simple within simple', () => {
      const needle = getTreeNode(el('.b'));
      const haystack = getTreeNode(el('.a'));
      const result = haystack.find(needle);
      expect(result.matchEnd).toBeUndefined();
    });

    test('match simple within compound', () => {
      const needle = getTreeNode(el('.a'));
      const haystack = getTreeNode(compound([el('.a'), el('.b')]));
      const result = haystack.find(needle);
      expect(result.matchEnd).toBe(haystack);
    });

    test('does not match simple within compound', () => {
      const needle = getTreeNode(el('.c'));
      const haystack = getTreeNode(compound([el('.a'), el('.b')]));
      const result = haystack.find(needle);
      expect(result.matchEnd).toBeUndefined();
    });

    test('match compound within compound', () => {
      const needle = getTreeNode(compound([el('.a'), el('.b')]));
      const haystack = getTreeNode(compound([el('.a'), el('.b')]));
      const result = haystack.find(needle);
      expect(result.matchEnd).toBe(haystack);
    });

    test('does match compound within compound', () => {
      const needle = getTreeNode(compound([el('.a'), el('.b'), el('.c')]));
      const haystack = getTreeNode(compound([el('.a'), el('.b')]));
      const result = haystack.find(needle);
      expect(result.matchEnd).toBeUndefined();
    });

    test('match simple within :is()', () => {
      const needle = getTreeNode(el('.a'));
      const haystack = getTreeNode(pseudo([
        ['value', ':is'],
        ['arg', el('.a')]
      ]));
      const result = haystack.find(needle);
      expect(result.matchEnd).toBe(haystack);
    });

    test('match simple within compound within :is()', () => {
      const needle = getTreeNode(el('.a'));
      const haystack = getTreeNode(pseudo([
        ['value', ':is'],
        ['arg', compound([el('.a'), el('.b')])]
      ]));
      const result = haystack.find(needle);
      expect(result.matchEnd).toBe(haystack.children.first);
    });

    test('does not match simple within :is()', () => {
      const needle = getTreeNode(el('.a'));
      const haystack = getTreeNode(pseudo([
        ['value', ':is'],
        ['arg', el('.b')]
      ]));
      const result = haystack.find(needle);
      expect(result.matchEnd).toBeUndefined();
    });
  });
});