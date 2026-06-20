import { type Context } from '../context.js';
import { F_VISIBLE, Node, defineType, type LocationInfo } from './node.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';
import { ProgressiveDeclaration } from './progressive-declaration.js';
import { indent } from './util/serialize-helper.js';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './util/print.js';
import { isRenderBuffer, type RenderBuffer } from './util/render-buffer.js';

export type ProgressiveRulesetValue = {
  selector: string;
  rules: Array<string | Node>;
};

function isProgressiveBlockNode(rule: Node): boolean {
  return rule instanceof ProgressiveRuleset || rule.type === 'ProgressiveAtRule';
}

function isRenderableProgressiveRule(rule: string | Node): boolean {
  return typeof rule === 'string' || rule.visible || rule.fullRender;
}

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
    const writer = options.writer;
    if (options.compress) {
      this.writeCompressedSyntax(options);
      return;
    }

    const currentIndent = indent(options.depth);
    const childIndent = indent(options.depth + 1);
    writer.add(`${currentIndent}${this.selector} {\n`, this);
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
      if (isProgressiveBlockNode(rule)) {
        rule.writeSyntax(options);
        continue;
      }
      writer.add(childIndent, rule);
      rule.writeSyntax(options);
      if (rule.requiredSemi === true && !writer.endsWith(';')) {
        writer.add(';');
      }
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
    writer.add(`${this.selector} {`, this);
    for (const rule of this.rules) {
      if (typeof rule !== 'string' && !rule.visible && !rule.fullRender) {
        continue;
      }
      writer.add(' ');
      if (typeof rule === 'string') {
        writer.add(rule, this);
      } else {
        rule.writeSyntax(options);
        if (rule instanceof ProgressiveDeclaration || rule.requiredSemi === true) {
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
