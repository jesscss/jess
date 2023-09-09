import { el, js } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Element', () => {
  beforeEach(() => {
    context = new Context()
    out = new OutputCollector()
  })
  it('should identify a class', () => {
    const rule = el('.foo')
    expect(rule.isClass).toBe(true)
  })
  it('should identify an id', () => {
    const rule = el('#id')
    expect(rule.isId).toBe(true)
  })
  it('should identify a pseudo-class', () => {
    const rule = el(':foo')
    expect(rule.isPseudo).toBe(true)
  })
  it('should identify an attribute', () => {
    const rule = el('[foo]')
    expect(rule.isAttr).toBe(true)
  })
  it('should identify an ident', () => {
    const rule = el('foo')
    expect(rule.isIdent).toBe(true)
  })
  it('should serialize a module', () => {
    let rule = el('foo')
    rule.toModule(context, out)
    expect(out.toString()).toBe('$J.el($J.anon("foo"))')

    rule = el(js('colorBrand'))
    out = new OutputCollector()
    rule.toModule(context, out)
    expect(out.toString()).toBe('$J.el(colorBrand)')
  })
})