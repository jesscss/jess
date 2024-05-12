import { TreeNode, CompoundTreeNode, ComplexTreeNode } from '../tree'
import { sellist, sel, compound, el, pseudo, co } from '..'
import { getPaths, getTreeNode } from '../util/selector'

describe('Tree', () => {
  test.skip('get all tree paths', () => {
    let tree = new TreeNode('.a', [
      new TreeNode('.b', [
        new TreeNode('.c', []),
        new TreeNode('.d', [])
      ]),
      new TreeNode('.e', [
        new TreeNode('.f', []),
        new TreeNode('.g', [])
      ])
    ])
    expect(tree.getPaths()).toEqual([
      ['.a', '.b', '.c'],
      ['.a', '.b', '.d'],
      ['.a', '.e', '.f'],
      ['.a', '.e', '.g']
    ])
  })

  describe('Tree nodes', () => {
    test('simple selector', () => {
      const sel1 = el('.a')
      expect(getTreeNode(sel1)).toEqual(new TreeNode(sel1))
    })

    test('compound selector', () => {
      const sel1 = compound([el('.a'), el('.b'), el('.c')])
      expect(getTreeNode(sel1)).toEqual(
        new CompoundTreeNode(sel1, [
          new TreeNode(el('.a')),
          new TreeNode(el('.b')),
          new TreeNode(el('.c'))
        ])
      )
    })

    test('complex selector', () => {
      const sel1 = sel([el('.a'), co('+'), el('.b')])
      expect(getTreeNode(sel1)).toEqual(
        new ComplexTreeNode(sel1, [
          new TreeNode(el('.b'), [
            new TreeNode(co('+'), [
              new TreeNode(el('.a'))
            ])
          ])
        ])
      )
    })

    test(':is selector', () => {
      const p = pseudo([
        ['value', ':is'],
        ['arg', el('.a')]
      ])
      const sel1 = compound(
        [
          p,
          el('.b')
        ]
      )
      expect(getTreeNode(sel1)).toEqual(
        new CompoundTreeNode(sel1, [
          new TreeNode(p, [
            new TreeNode(el('.a'))
          ]),
          new TreeNode(el('.b'))
        ])
      )
    })

    test(':is selector w/ list', () => {
      const p = pseudo([
        ['value', ':is'],
        ['arg', sellist([el('.a'), el('.b')])]
      ])
      const sel1 = compound(
        [
          p,
          el('.c')
        ]
      )
      expect(getTreeNode(p)).toEqual(
        new TreeNode(p, [
          new TreeNode(el('.a')),
          new TreeNode(el('.b'))
        ])
      )
      expect(getTreeNode(sel1)).toEqual(
        new CompoundTreeNode(sel1, [
          new TreeNode(p, [
            new TreeNode(el('.a')),
            new TreeNode(el('.b'))
          ]),
          new TreeNode(el('.c'))
        ])
      )
    })

    test(':is selector w/ compound', () => {
      const innerCompound = compound([el('.a'), el('.b')])
      const p = pseudo([
        ['value', ':is'],
        ['arg', innerCompound]
      ])
      const sel1 = compound(
        [
          p,
          el('.c')
        ]
      )
      expect(getTreeNode(sel1)).toEqual(
        new CompoundTreeNode(sel1, [
          new TreeNode(p, [
            new CompoundTreeNode(innerCompound, [
              new TreeNode(el('.a')),
              new TreeNode(el('.b'))
            ])
          ]),
          new TreeNode(el('.c'))
        ])
      )
    })

    test('turn a compound into complex paths', () => {
      const sel1 = compound([el('.a'), el('.b'), el('.c')])
      expect(getPaths(sel1)).toEqual([sel([sel1])])
    })
  })
})