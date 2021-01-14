import { expect } from 'chai'
import 'mocha'
import { sel, el } from '..'

describe('Selector', () => {
  it('should serialize to a selector', () => {
    let rule = sel([
      el('.foo'),
      '>',
      el('#bar')
    ])
    expect(`${rule}`).to.eq('.foo > #bar')
    rule = sel([
      el('.foo'),
      el('#bar')
    ])
    expect(`${rule}`).to.eq('.foo#bar')
    rule = sel([
      el('.foo'),
      ' ',
      el('#bar')
    ])
    expect(`${rule}`).to.eq('.foo #bar')
  })
})