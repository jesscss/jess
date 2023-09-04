import { num, seq } from '..'

describe('Expression', () => {
  it('should serialize an expression', () => {
    const rule = seq([num(10), num(20), num(30)])
    expect(`${rule}`).toBe('102030')
  })
})