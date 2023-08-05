import { sel, el } from '..'

describe('Selector', () => {
  it('should serialize to a selector', () => {
    let rule = sel([
      el('.foo'),
      '>',
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
      ' ',
      el('#bar')
    ])
    expect(`${rule}`).toBe('.foo #bar')
  })
})