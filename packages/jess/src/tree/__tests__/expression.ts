import { expect } from 'chai'
import 'mocha'
import { num, expr } from '..'

describe('Expression', () => {
  it('should serialize an expression', () => {
    const rule = expr([num(10), num(20), num(30)])
    expect(`${rule}`).to.eq('102030')
  })
})