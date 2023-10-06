import {
  Node
} from './node'
import { Nil } from './nil'
import type { Context } from '../context'
import { Interpolated } from './interpolated'
import type { Anonymous } from './anonymous'

export type Name = Interpolated | Anonymous | string

export type BaseDeclarationValue<N extends Name = Name> = {
  name?: N
  value: unknown
}

export type AssignmentType =
  ':'     // normal assignment
  | '+:'  // merge (or add with math) -- similar to `+=` in JS
  //         however, with sequences or lists, will add value to a member of the sequence or list
  | '-:'  // only valid for math operations -- similar to `-=` in JS
  | '*:'  // only valid for math operations -- similar to `*=` in JS
  | '/:'  // only valid for math operations -- similar to `/=` in JS
  | '?:'  // assign only if not already defined
  | '?+:' // add if present, otherwise assign
  | '?-:' // subtract if present, otherwise assign
  | '?*:' // multiply if present, otherwise assign
  | '?/:' // divide if present, otherwise assign

  | '+?:' // Legacy Less flag -- merge only declarations that have '+?:'
  //         into a List or Sequence, otherwise assign

export type BaseDeclarationOptions = {
  assign?: AssignmentType
  /**
   * Instead of implicitly declaring or overriding,
   * requires a variable to previously be explicitly
   * declared within scope.
   *
   * Used by SCSS (!global) and Jess's (@set)
   */
  setDefined?: boolean

  /** Defined in a mixin definition */
  paramVar?: boolean

  /** Used by SCSS (!default) and Jess (?:) */
  // setIfUndefined?: boolean
  /**
   * Throw if already defined in the immediate scope
   * Will not throw if defined in a parent scope.
   *
   * Used by Jess (@let) and SCSS in the case of mixins
   */
  throwIfDefined?: boolean
}

/**
 * A base class with a name / value pair
 */
export abstract class BaseDeclaration<
  N extends Name = Name,
  T extends BaseDeclarationValue = BaseDeclarationValue<N>,
  O extends BaseDeclarationOptions = BaseDeclarationOptions,
> extends Node<T, O> {
  get name(): Name | undefined {
    return this.data.get('name')
  }

  set name(v: Name | undefined) {
    this.data.set('name', v)
  }

  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let node = this.clone()
      node.evaluated = true
      let { name, value } = node
      /**
       * Name may be a variable or a sequence containing a variable
       *
       * @todo - is this valid if rulesets pre-emptively evaluate names?
       */
      if (name instanceof Interpolated) {
        node.name = await name.eval(context)
      } else {
        node.name = name
      }
      if (value instanceof Node) {
        let newValue = await value.eval(context)
        if (newValue instanceof Nil) {
          return newValue.inherit(node)
        } else {
          node.value = newValue
        }
      }
      return node
    })
  }
}