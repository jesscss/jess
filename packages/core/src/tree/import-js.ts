import type { Context } from '../context.js';
import { F_MAY_ASYNC, F_NON_STATIC, Node, defineType, type NodeLocation } from './node.js';
import { type Quoted } from './quoted.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';

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
  constructor(value: JsImportValue, options?: JsImportOptions, location?: NodeLocation) {
    super(value, options, location);
    // JS imports are always non-static and may be async
    this.addFlags(F_MAY_ASYNC, F_NON_STATIC);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    const { path } = this.value;
    const namespace = this._options?.namespace;
    const imports = this.value.imports ?? (Array.isArray(this._options?.imports) ? this._options.imports : undefined);

    w.add('@-use ');
    path.writeSyntax(options);
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
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override resolve(_context: Context): this {
    return this;
  }
}

export const js = defineType<JsImportValue>(JsImport, 'JsImport', 'js');
