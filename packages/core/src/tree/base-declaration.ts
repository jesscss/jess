import {
  Node,
  type NodeOptions
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

/**
 * A base class with a name / value pair
 */
export abstract class BaseDeclaration<
  N extends Name = Name,
  T extends BaseDeclarationValue = BaseDeclarationValue<N>,
  O extends NodeOptions = NodeOptions,
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