import { CssParser } from '../src/cssParser'

describe('produces a valid AST', () => {
  it('should produce a valid AST', () => {
    const parser = new CssParser()
    const { cst, tree } = parser.parseTree('a/**/b { color: red blue; }')
    expect(`${tree}`).toBeString(`
      a/**/b {
        color: red blue;
      }
    `)
  })
})