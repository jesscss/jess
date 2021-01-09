import { expect } from 'chai'
import 'mocha'
import { decl, spaced, expr } from '..'

describe('Declaration', () => {
  it('should serialize a declaration', () => {
    const rule = decl({ name: expr(['color']), value: spaced(['#eee']) })
    expect(`${rule}`).to.eq('color: #eee;')
  })
})