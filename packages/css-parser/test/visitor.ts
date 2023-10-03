import { type Visitor } from 'core/src/visitor'
import { CssParser } from '../src/cssParser'
import { CssCstVisitor } from '../src/cssCstVisitor'

// type Obj = Record<any, any>
// /** @see https://stackoverflow.com/questions/2257993/how-to-display-all-methods-of-an-object */
// const isGetter = (x: Obj, name: string) => Boolean((Object.getOwnPropertyDescriptor(x, name) ?? {})?.get)
// const isFunction = (x: Obj, name: string) => typeof x[name] === 'function'
// const deepFunctions = (x: Obj): string[] =>
//   (x && x !== Object.prototype &&
//   Object.getOwnPropertyNames(x)
//     .filter(name => isGetter(x, name) || isFunction(x, name))
//     .concat(deepFunctions(Object.getPrototypeOf(x)) || [])) || []

// const distinctDeepFunctions = (x: Obj) => Array.from(new Set(deepFunctions(x)))
// const getMethods = (obj: Obj) => distinctDeepFunctions(obj).filter(
//   name => name !== 'constructor' && !~name.indexOf('__'))

describe('CSS CST Visitor', () => {
  describe('produces a valid AST', () => {
    let parser: CssParser
    beforeAll(() => {
      parser = new CssParser()
    })
    it('should produce a valid AST', () => {
      const { tree } = parser.parseTree('a/**/b { color: red blue; }')
      expect(`${tree}`).toBeString(`
        a/**/b {
          color: red blue;
        }
      `)
    })
  })

  describe.only('visits every visitor method', () => {
    let parser: CssParser
    beforeAll(() => {
      parser = new CssParser()
    })
    /**
     * Note, with no input (or skipped input), the location info
     * will be all NaN.
    */
    it('Root', () => {
      let { tree } = parser.parseTree('')
      expect(tree!.type).toBe('Root')
    })
    it('Qualified Rule', () => {
      let { tree } = parser.parseTree('a { color: red; }')
      expect(tree).toMatchSnapshot()
    })
    it('Calc', () => {
      let { tree } = parser.parseTree('a { b: calc(1 + 1) }')
      expect(tree).toMatchSnapshot()
    })
  })
})