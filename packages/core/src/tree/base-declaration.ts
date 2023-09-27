import {
  Node,
  type NodeOptions
} from './node'
import { Nil } from './nil'
import type { Context } from '../context'
import { Interpolated } from './interpolated'
import type { Anonymous } from './anonymous'

export type Name = Interpolated | Anonymous | string

export type BaseDeclarationValue<U extends Node = Node, T extends Name = Name> = {
  name: T
  value: U
}

/**
 * A base class with a name / value pair
 */
export abstract class BaseDeclaration<
  T extends Name = Name,
  U extends Node = Node,
  O extends NodeOptions = NodeOptions
> extends Node<BaseDeclarationValue<U, T>, O> {
  get name(): T {
    return this.data.get('name')
  }

  set name(v: T) {
    this.data.set('name', v)
  }

  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let node = this.clone() as BaseDeclaration
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
      let newValue = await value.eval(context)
      if (newValue instanceof Nil) {
        return newValue.inherit(node)
      } else {
        node.value = newValue as U
      }
      return node
    })
  }
}