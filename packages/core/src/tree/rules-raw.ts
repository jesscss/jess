import { defineType, Node } from './node.js';
import type { Context } from '../context.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { Rules } from './rules.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import type { RenderBuffer } from './util/render-buffer.js';
import { emitNodeSourceSyntaxWithTrivia } from './util/trivia.js';

/**
 * A rules container that emits its content verbatim inside braces,
 * without parent-managed newlines or indentation.
 */
export class RawRules extends Rules {
  // Do not add newlines/indent; emit children exactly as-is
  override toBraced(rawOptions?: PrintOptions) {
    const options = getPrintOptions(rawOptions);
    if (this.rules.length === 0) {
      options.writer.add('{}', this);
      return '{}';
    }
    const mark = options.writer.mark();
    this.writeBracedSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  writeBracedSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('{');
    for (let i = 0; i < this.rules.length; i++) {
      const child = this.rules[i]!;
      const trivia = options.trivia ?? child.sourceRoot?._treeContext?.opts?.trivia;
      if (trivia) {
        emitNodeSourceSyntaxWithTrivia(child, options);
      } else {
        child.writeSyntax(options);
      }
    }
    w.add('}');
  }

  // Keep trimmed output minimal – emit children verbatim without extras
  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    for (let i = 0; i < this.rules.length; i++) {
      const child = this.rules[i]!;
      const trivia = options.trivia ?? child.sourceRoot?._treeContext?.opts?.trivia;
      if (trivia) {
        emitNodeSourceSyntaxWithTrivia(child, options);
      } else {
        child.writeSyntax(options);
      }
    }
  }

  override toTrimmedString(rawOptions?: PrintOptions) {
    const options = getPrintOptions(rawOptions);
    if (this.rules.length === 0) {
      return '';
    }
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override resolve(_context: Context): this {
    return this;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    // RawRules is source-only even though it inherits from Rules, whose render
    // path evaluates child rules. Opt back into the base Node source renderer.
    // Call Node.prototype.render directly to use source render, not the Rules eval path.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const nodeRender = Node.prototype.render as (context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions) => MaybePromise<string>;
    return nodeRender.call(this, context, bufferOrOptions, options);
  }
}

export const rawrules = defineType(RawRules, 'RawRules', 'rules-raw');
