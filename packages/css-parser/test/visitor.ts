import { CssParser } from '../src/cssParser'

describe('produces a valid AST', () => {
  it('should produce a valid AST', () => {
    const parser = new CssParser()
    const { tree } = parser.parseTree('a { color: red; }')
    expect(`${tree}`).toMatch('a { color: red; }')
  })
})