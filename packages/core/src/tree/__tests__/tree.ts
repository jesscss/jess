import { TreeNode } from '../tree'

describe('Tree', () => {
  test('get all tree paths', () => {
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
    expect(tree.getPaths()).toBe([
      ['.a', '.b', '.c'],
      ['.a', '.b', '.d'],
      ['.a', '.e', '.f'],
      ['.a', '.e', '.g']
    ])
  })
})