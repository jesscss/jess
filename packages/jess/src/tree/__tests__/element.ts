import { expect } from 'chai'
import 'mocha'
import { el } from '..'

describe('Element', () => {
  it('should identify a class', () => {
    const rule = el('.foo')
    expect(rule.isClass).to.eq(true)
  })
  it('should identify an id', () => {
    const rule = el('#id')
    expect(rule.isId).to.eq(true)
  })
  it('should identify a pseudo-class', () => {
    const rule = el(':foo')
    expect(rule.isPseudo).to.eq(true)
  })
  it('should identify an attribute', () => {
    const rule = el('[foo]')
    expect(rule.isAttr).to.eq(true)
  })
  it('should identify an ident', () => {
    const rule = el('foo')
    expect(rule.isIdent).to.eq(true)
  })
})