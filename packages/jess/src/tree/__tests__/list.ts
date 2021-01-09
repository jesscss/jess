import { expect } from 'chai'
import 'mocha'
import { list, expr, num } from '..'

describe('List', () => {
  it('should serialize to a list', () => {
    const rule = list([expr([num(1), '2', '3']), 'four'])
    expect(`${rule}`).to.eq('1 2 3, four')
  })
})