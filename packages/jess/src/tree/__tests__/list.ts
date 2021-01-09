import { expect } from 'chai'
import 'mocha'
import { list, spaced, num } from '..'

describe('List', () => {
  it('should serialize to a list', () => {
    const rule = list([spaced([num(1), '2', '3']), 'four'])
    expect(`${rule}`).to.eq('1 2 3, four')
  })
})