import { type Visitor } from 'core/src/visitor'
import { CssParser } from '../src/cssParser'
import { CssCstVisitor } from '../src/cssCstVisitor'

type Obj = Record<any, any>
/** @see https://stackoverflow.com/questions/2257993/how-to-display-all-methods-of-an-object */
const isGetter = (x: Obj, name: string) => Boolean((Object.getOwnPropertyDescriptor(x, name) ?? {})?.get)
const isFunction = (x: Obj, name: string) => typeof x[name] === 'function'
const deepFunctions = (x: Obj): string[] =>
  (x && x !== Object.prototype &&
  Object.getOwnPropertyNames(x)
    .filter(name => isGetter(x, name) || isFunction(x, name))
    .concat(deepFunctions(Object.getPrototypeOf(x)) || [])) || []

const distinctDeepFunctions = (x: Obj) => Array.from(new Set(deepFunctions(x)))
const getMethods = (obj: Obj) => distinctDeepFunctions(obj).filter(
  name => name !== 'constructor' && !~name.indexOf('__'))

const parser = new CssParser()
let visitor = parser.visitor

describe('CSS CST Visitor', () => {
  describe('produces a valid AST', () => {
    it('should produce a valid AST', () => {
      const { tree } = parser.parseTree('a/**/b { color: red blue; }')
      expect(`${tree}`).toBeString(`
        a/**/b {
          color: red blue;
        }
      `)
    })
  })

  describe('visits every visitor method', () => {
    beforeAll(() => {
      for (let method of getMethods(visitor)) {
        vi.spyOn(visitor, method as keyof Visitor)
      }
    })
    it('stylesheet', () => {
      parser.parseTree('')
      expect(visitor.stylesheet).toHaveBeenCalled()
    })
  })
})