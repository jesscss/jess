import { CssParser } from '@jesscss/css-parser'
import { getASTFromCST } from '..'

describe('produces a valid AST', () => {
  it('should produce a valid AST', () => {
    const parser = new CssParser()
    const { cst } = parser.parse('a { color: red; }')
    let ast = getASTFromCST(cst, parser.parser)
    expect(`${ast}`).toMatch('a { color: red; }')
  })
})