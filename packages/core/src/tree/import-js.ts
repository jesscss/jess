import type { Context } from '../context.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { F_MAY_ASYNC, F_NON_STATIC, Node, defineType } from './node.js';
import { type Quoted } from './quoted.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import {
  isRenderBuffer,
  type RenderBuffer,
  writeRenderText
} from './util/render-buffer.js';

/**
 * Imports of TS/JS ESM modules.
 *
 * `@-use 'foo.js' as foo;`
 */

type JsImportSpecifier = string | [string, string] | { name: string; alias?: string };

export type JsImportOptions = {
  /** e.g. `@-use 'foo.js' as foo` sets namespace to `foo` */
  namespace?: string;
  /**
   * - In array,
   *   - string is a plain import identifier
   *   - [string, string] is { [identifier1] as [identifier2] }
  */
  imports?: string | JsImportSpecifier[];
};

export type JsImportValue = {
  path: Quoted;
  imports?: JsImportSpecifier[];
};

export class JsImport extends Node<JsImportValue, JsImportOptions> {
  constructor(value: JsImportValue, options?: JsImportOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    // JS imports are always non-static and may be async
    this.addFlags(F_MAY_ASYNC, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { path } = this.value;
    const { namespace } = this.options;
    const imports = this.value.imports ?? (Array.isArray(this.options.imports) ? this.options.imports : undefined);

    w.add('@-use ');
    path.toString(options);
    let explicitNamespace = namespace;
    if (!explicitNamespace && imports?.length) {
      const nsSpec = imports.find((specifier) => {
        if (typeof specifier === 'string') {
          return false;
        }
        if (Array.isArray(specifier)) {
          return specifier[0] === '*';
        }
        return specifier.name === '*';
      });
      if (nsSpec) {
        explicitNamespace = Array.isArray(nsSpec)
          ? nsSpec[1]
          : (typeof nsSpec === 'string' ? undefined : nsSpec.alias);
      }
    }
    if (explicitNamespace) {
      w.add(` as ${explicitNamespace}`);
    }
    w.add(';');
    return w.getSince(mark);
  }

  override resolve(_context: Context): this {
    return this;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      const text = this.toTrimmedString(getPrintOptions({ ...options, context }));
      writeRenderText(bufferOrOptions, text);
      return text;
    }
    return super.render(context, bufferOrOptions);
  }
}

export const js = defineType<JsImportValue>(JsImport, 'JsImport', 'js');
