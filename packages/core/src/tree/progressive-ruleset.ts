import { type Context } from '../context.js';
import { Node, defineType, type LocationInfo } from './node.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';
import { ProgressiveDeclaration } from './progressive-declaration.js';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './util/print.js';
import { isRenderBuffer, type RenderBuffer } from './util/render-buffer.js';

export type ProgressiveRulesetValue = {
  selector: string;
  rules: Array<string | Node>;
};

/**
 * Experimental ruleset node for scanner-first progressive parsing.
 *
 * It keeps selector and body payloads thin so tests can prove a structural parse
 * can render and serialize before selector/declaration materialization exists.
 */
export class ProgressiveRuleset extends Node<ProgressiveRulesetValue> {
  static override childKeys = ['selector', 'rules'] as const;

  readonly selector: string;
  readonly rules: Array<string | Node>;

  override allowRuleRoot = true;
  override allowRoot = true;

  constructor(
    value: ProgressiveRulesetValue,
    options?: undefined,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.selector = value.selector;
    this.rules = value.rules;
  }

  override toTrimmedString(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const mark = printOptions.writer.mark();
    this.writeSyntax(printOptions);
    return printOptions.writer.getSince(mark);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    const writer = options.writer;
    writer.add(`${this.selector} {`, this);
    for (const rule of this.rules) {
      writer.add(' ');
      if (typeof rule === 'string') {
        writer.add(rule, this);
      } else {
        rule.writeSyntax(options);
        if (rule instanceof ProgressiveDeclaration) {
          writer.add(';');
        }
      }
    }
    writer.add(' }', this);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    return isRenderBuffer(bufferOrOptions)
      ? Node.prototype.render.call(this, context, bufferOrOptions, options)
      : Node.prototype.render.call(this, context, bufferOrOptions);
  }
}

export const progressiveruleset = defineType(ProgressiveRuleset, 'ProgressiveRuleset', 'progressive-ruleset') as (
  value: ProgressiveRulesetValue,
  options?: undefined,
  location?: LocationInfo
) => ProgressiveRuleset;
