import { type Context } from '../context';
import { Node, defineType } from './node';
import { cast } from './util/cast';

/**
 * Deprecated Less feature.
 */
export class JsExpression extends Node<string> {
  type = 'JsExpression' as const;
  shortType = 'jsexpr' as const;

  override toTrimmedString(): string {
    return '`' + this.value + '`';
  }

  /**
   * @todo - install deno-bin to run scripts securely
   */
  override async evalNode(context: Context) {
    const result = await eval(this.value);
    return cast(result);
  }
}
export const jsexpr = defineType(JsExpression, 'JsExpression', 'jsexpr');