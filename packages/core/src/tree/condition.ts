import { type Context } from '../context'
import { Node, defineType } from './node'
import { Bool } from './bool'
import { Nil } from './nil'

/** @note Less will parse =< but it will be stored as <= */
export type ConditionOperator = 'and' | 'or' | '=' | '>' | '<' | '>=' | '<='

export type ConditionValue = [
  left: Node
] | [
  left: Node,
  op: ConditionOperator,
  right: Node
]

export type ConditionOptions = {
  negate?: boolean
}

export class Condition extends Node<ConditionValue, ConditionOptions> {
  get left() {
    return this.data.get('value')[0]
  }

  get op() {
    return this.data.get('value')[1]
  }

  get right() {
    return this.data.get('value')[2]
  }

  toTrimmedString() {
    let [left, op, right] = this.value
    let output = `${left}${op ? ` ${op} ${right}` : ''}`
    if (this.options?.negate) {
      return `not(${output})`
    }
    return output
  }

  async eval(context: Context): Promise<Bool> {
    let [left, op, right] = this.value
    let negated = !!this.options?.negate

    let a = await left.eval(context)

    const getBool = (node: Node) => {
      if (node instanceof Bool) {
        if (negated) {
          node.value = !node.value
        }
        return node
      }
      if (node instanceof Nil) {
        return new Bool(negated)
      }
      return new Bool(true && !negated)
    }

    if (!right) {
      /**
       * If there's no right-hand side node,
       * we coerce the left-hand side node to a boolean
       */
      return getBool(left)
    }

    let b = await right.eval(context)

    const getResult = () => {
      switch (op) {
        case 'and': return getBool(a).value && getBool(b).value
        case 'or': return getBool(a).value || getBool(b).value
        default:
          switch (a.compare(b)) {
            case -1:
              return op === '<' || op === '<='
            case 0:
              return op === '=' || op === '>=' || op === '<='
            case 1:
              return op === '>' || op === '>='
            default:
              return false
          }
      }
    }
    let result = getResult()
    return new Bool(negated ? !result : result).inherit(this)
  }
}
export const condition = defineType(Condition, 'Condition')