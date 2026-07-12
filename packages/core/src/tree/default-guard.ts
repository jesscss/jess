import { type Context } from '../context';
import { Node, defineType } from './node';
import { Bool } from './bool';

export class DefaultGuard extends Node<string> {
  type = 'DefaultGuard' as const;
  shortType = 'defaultguard' as const;

  override toTrimmedString() {
    return 'default';
  }

  override async evalNode(context: Context): Promise<Bool> {
    return new Bool(Boolean(context.isDefault)).inherit(this);
  }
}
export const defaultguard = defineType(DefaultGuard, 'DefaultGuard');