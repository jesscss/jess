import {
  Node,
  defineType,
  type NodeData
} from './node'
import { isNode } from './util'
import { Nil } from './nil'
import type { Context } from '../context'
import { Interpolated } from './interpolated'
import type { General, Name } from './general'
import { Reference } from './reference'
import { List } from './list'
import { spaced } from './sequence'
import { Operation } from './operation'

export const enum AssignmentType {
  Default = ':',
  Add = '+:',              // similar to += in JS, but merges lists / sequences / collections
  // Subtract = '-:',      // math subtraction, like -= in JS
  // Multiply = '*:',      // math multiplication, like *= in JS
  // Divide = '/:',        // math division, like /= in JS
  CondAssign = '?:',       // similar to ??= in JS or !default in Sass
  // CondAdd = '?+:',      // add if defined, otherwise assign
  // CondSubtract = '?-:', // subtract if defined, otherwise assign
  // CondMultiply = '?*:', // multiply if defined, otherwise assign
  // CondDivide = '?/:',   // divide if defined, otherwise assign

  /** Legacy Less flags */
  MergeList = '&,:',    // merge into a list if another prop exists with this flag
  MergeSequence = '&_:' // merge into a sequence if another prop exists with this flag
}

export type DeclarationOptions = {
  assign?: AssignmentType
  semi?: boolean
  /**
   * Instead of implicitly declaring or overriding,
   * requires a variable to previously be explicitly
   * declared within scope.
   *
   * Used by SCSS (!global) and Jess's ($${var}:)
   */
  setDefined?: boolean

  /**
   * Used for mixin / function parameters (and args). It's not the
   * same kind of variable declaration.
   */
  paramVar?: boolean

  /** Used by SCSS (!default) and Jess (?:) */
  // setIfUndefined?: boolean
  /**
   * Throw if already defined in the immediate scope
   * Will not throw if defined in a parent scope.
   *
   * Used by SCSS in the case of mixins... not Jess?
   */
  throwIfDefined?: boolean
}

type NameValue = string | Name | Interpolated<'Name'>

export type DeclarationValue = {
  name: NameValue
  value: Node
  /** The actual string representation of important, if it exists */
  important?: General<'Flag'>
}

/**
 * A continuous collection of nodes.
 *
 * Initially, the name can be a Node or string.
 * Once evaluated, name must be a string
 */
export class Declaration extends Node<DeclarationValue, DeclarationOptions> {
  declare value: DeclarationValue
  declare data: NodeData<DeclarationValue>

  type = 'Declaration'
  shortType = 'decl'
  override allowRuleRoot = true
  override requiredSemi = true

  protected _declTrimmedString(depth?: number) {
    const { name, value, important } = this.value
    const { assign = ':' } = this.options
    let a = assign === ':' ? ':' : ` ${assign}`
    let returnVal = `${name}${a}${
      value.processPrePost('pre', ' ')
    }${
      value.toTrimmedString(depth)
    }${
      value.processPrePost('post')
    }`
    if (!isNode(value, 'Collection')) {
      returnVal += important ? `${important}` : ''
      if (this.options?.semi === true) {
        returnVal += ';'
      }
    }
    return returnVal
  }

  override toTrimmedString(depth?: number) {
    return this._declTrimmedString(depth)
  }

  override async preEvalNode(context: Context): Promise<this> {
    if (!this.preEvaluated) {
      let node = this.clone()
      node.options = { ...this.options }
      node.originalNode ??= this
      let { name, value } = node.value
      let key: string | Name
      if (name instanceof Interpolated) {
        key = await name.eval(context) as Name
        node.data.set('name', key)
      } else {
        key = name
      }
      /** Normalize assignment types */
      let assign = node.options?.assign
      if (assign) {
        value = value.clone()
        /** Reference type */
        let type: 'property' | 'variable' =
          node.type === 'Declaration' ? 'property' : 'variable'
        switch (assign) {
          case AssignmentType.MergeList:
          case AssignmentType.MergeSequence: {
            const ref = new Reference(key.toString(), {
              type,
              fallbackValue: new Nil(),
              filter: n => {
                const assign = n.options?.assign
                return assign === AssignmentType.MergeList
                  || assign === AssignmentType.MergeSequence
              },
            })
            /**
             * @note - It's up to Sequence and List to handle
             *         the merging of the values, if Nil()
             *         or a nested list.
             */
            value = assign === AssignmentType.MergeList
              ? new List([ref, value])
              : spaced([ref, value])
            
            node.data.set('value', value)
            break
          }
          case AssignmentType.Add: {
            node.data.set(
              'value',
              new Operation([
                new Reference(key.toString(), { type }),
                '+',
                value
              ])              
            )
            break
          }
          case AssignmentType.CondAssign: {
            node.data.set(
              'value',
              new Reference(key.toString(), {
                type,
                fallbackValue: value
              })
            )
            break
          }
        }
        node.options.assign = AssignmentType.Default
      }
      return node
    }
    return this
  }

  override async evalNode(context: Context) {
    let node = await this.preEvalNode(context)
    let { name, value } = node.value
    /**
     * Name may be a variable or a sequence containing a variable
     *
     * @todo - is this valid if rulesets pre-emptively evaluate names?
     */
    if (name instanceof Interpolated) {
      node.data.set('name', await name.eval(context) as Name)
    } else {
      node.data.set('name', name)
    }
    if (value instanceof Node) {
      let newValue = await value.eval(context)
      if (newValue instanceof Nil) {
        return newValue.inherit(node)
      } else {
        node.data.set('value', newValue)
      }
    }
    return node
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.name.toCSS(context, out)
  //   out.add(': ')
  //   context.cast(this.value).toCSS(context, out)
  //   if (this.important) {
  //     out.add(' ')
  //     this.important.toCSS(context, out)
  //   }
  //   out.add(';')
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const pre = context.pre
  //   const loc = this.location
  //   out.add('$J.decl({\n', loc)
  //   context.indent++
  //   out.add(`  ${pre}name: `)
  //   this.name.toModule(context, out)
  //   out.add(`,\n  ${pre}value: `)
  //   this.value.toModule(context, out)
  //   if (this.important) {
  //     out.add(`,\n  ${pre}important: `)
  //     this.important.toModule(context, out)
  //   }
  //   context.indent--
  //   out.add(`\n${pre}})`)
  // }
}

type DeclarationParams = ConstructorParameters<typeof Declaration>

export const decl = defineType<DeclarationValue>(Declaration, 'Declaration', 'decl') as (
  value: DeclarationValue | DeclarationParams[0],
  options?: DeclarationParams[1],
  location?: DeclarationParams[2],
  treeContext?: DeclarationParams[3]
) => Declaration
