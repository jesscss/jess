import { num, seq } from '..'

/**
 * @todo - add tests for list bubbling
 */
describe('Sequence', () => {
  it('should serialize to a single value', () => {
    let rule = seq([num(10), num(20), num(30)])
    expect(`${rule}`).toBe('102030')
  })
})