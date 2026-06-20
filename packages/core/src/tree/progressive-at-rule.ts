import { type Context } from '../context.js';
import { F_VISIBLE, Node, defineType, type LocationInfo } from './node.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';
import { ProgressiveDeclaration } from './progressive-declaration.js';
import { ProgressiveRuleset } from './progressive-ruleset.js';
import { indent } from './util/serialize-helper.js';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './util/print.js';
import { isRenderBuffer, type RenderBuffer } from './util/render-buffer.js';

export type ProgressiveAtRuleValue = {
  name: string;
  prelude?: string;
  rules: Array<string | Node>;
};

function isRenderableProgressiveRule(rule: string | Node): boolean {
  return typeof rule === 'string' || rule.visible || rule.fullRender;
}

/**
 * Experimental scanner-first at-rule block node.
 *
 * This proves simple block at-rules can render from scanner-native strings and
 * progressive child nodes without allocating canonical prelude/value nodes.
 */
export class ProgressiveAtRule extends Node<ProgressiveAtRuleValue> {
  static override childKeys = ['name', 'prelude', 'rules'] as const;

  readonly name: string;
  readonly prelude: string | undefined;
  readonly rules: Array<string | Node>;

  override allowRuleRoot = true;
  override allowRoot = true;

  constructor(
    value: ProgressiveAtRuleValue,
    options?: undefined,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.name = value.name;
    this.prelude = value.prelude;
    this.rules = value.rules;
    if (!this.rules.some(isRenderableProgressiveRule)) {
      this.removeFlag(F_VISIBLE);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const mark = printOptions.writer.mark();
    this.writeSyntax(printOptions);
    return printOptions.writer.getSince(mark);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    if (!this.visible && !this.fullRender) {
      return;
    }
    if (options.compress) {
      this.writeCompressedSyntax(options);
      return;
    }

    const writer = options.writer;
    const currentIndent = indent(options.depth);
    const childIndent = indent(options.depth + 1);
    const prelude = this.prelude ? ` ${this.prelude}` : '';
    writer.add(`${currentIndent}${this.name}${prelude} {\n`, this);
    options.depth++;
    for (const rule of this.rules) {
      if (typeof rule !== 'string' && !rule.visible && !rule.fullRender) {
        continue;
      }
      if (typeof rule === 'string') {
        writer.add(childIndent, this);
        writer.add(rule, this);
        if (!writer.endsWith('\n')) {
          writer.add('\n');
        }
        continue;
      }
      if (rule instanceof ProgressiveDeclaration) {
        writer.add(childIndent, rule);
        rule.writeSyntax(options);
        writer.add(';\n');
        continue;
      }
      if (rule instanceof ProgressiveRuleset || rule instanceof ProgressiveAtRule) {
        rule.writeSyntax(options);
        continue;
      }
      writer.add(childIndent, rule);
      rule.writeSyntax(options);
      if (!writer.endsWith('\n')) {
        writer.add('\n');
      }
    }
    options.depth--;
    writer.add(`${currentIndent}}\n`, this);
  }

  private writeCompressedSyntax(options: FinalPrintOptions): void {
    if (!this.visible && !this.fullRender) {
      return;
    }
    const writer = options.writer;
    const prelude = this.prelude ? ` ${this.prelude}` : '';
    writer.add(`${this.name}${prelude} {`, this);
    for (const rule of this.rules) {
      if (typeof rule !== 'string' && !rule.visible && !rule.fullRender) {
        continue;
      }
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

export const progressiveatrule = defineType(ProgressiveAtRule, 'ProgressiveAtRule', 'progressive-at-rule') as (
  value: ProgressiveAtRuleValue,
  options?: undefined,
  location?: LocationInfo
) => ProgressiveAtRule;
