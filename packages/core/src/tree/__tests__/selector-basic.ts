import { el } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('BasicSelector', () => {
  beforeEach(() => {
    context = new Context()
    out = new OutputCollector()
  })
  it('should identify a class', () => {
    let rule = el('.foo')
    expect(rule.isClass).toBe(true)
  })
  it('should identify an id', () => {
    let rule = el('#id')
    expect(rule.isId).toBe(true)
  })
  it('should identify a tag', () => {
    let rule = el('foo')
    expect(rule.isTag).toBe(true)
  })
  it('should identify a tag with escapes', () => {
    let rule = el('\\.foo')
    expect(rule.isTag).toBe(true)
  })
  // it('should serialize a module', () => {
  //   let rule = el('foo')
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.el($J.any("foo"))')

  //   rule = el(js('colorBrand'))
  //   out = new OutputCollector()
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.el(colorBrand)')
  // })
})