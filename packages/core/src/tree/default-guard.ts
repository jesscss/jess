import { type Context } from '../context'
import { Node, defineType } from './node'
import { Bool } from './bool'

export class DefaultGuard extends Node {
  toTrimmedString() {
    return 'default'
  }

  async eval(context: Context): Promise<Bool> {
    return new Bool(context.isDefault).inherit(this)
  }
}
export const defaultguard = defineType(DefaultGuard, 'DefaultGuard')