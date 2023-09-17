import { Selector } from '../selector-sequence'
import { sel, el, co } from '..'
import type { Class } from 'type-fest'
import type { Node } from '../node'

/** @todo - move to https://github.com/SamVerschueren/tsd */
test('Test types', () => {
  expectTypeOf(Selector).toMatchTypeOf<Class<Node>>()
})

describe('Selector', () => {
  it('should serialize to a selector', () => {
    let rule = sel([
      el('.foo'),
      co('>'),
      el('#bar')
    ])
    expect(`${rule}`).toBe('.foo > #bar')
    rule = sel([
      el('.foo'),
      el('#bar')
    ])
    expect(`${rule}`).toBe('.foo#bar')
    rule = sel([
      el('.foo'),
      co(' '),
      el('#bar')
    ])
    expect(`${rule}`).toBe('.foo #bar')
  })
})