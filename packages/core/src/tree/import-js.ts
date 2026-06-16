import type { Context } from '../context.js';
import { F_MAY_ASYNC, F_NON_STATIC, Node, defineType, type NodeLocation } from './node.js';
import { type Quoted } from './quoted.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';

/**
 * Imports of TS/JS ESM modules.
 *
 * `@-use 'foo.js' as foo;`
 * `@-from 'foo.js' import (bar as baz);`
 */

type JsImportSpecifier = string | [string, string] | { name: string; alias?: string };

export type JsImportOptions = {
  /** e.g. `@-use 'foo.js' as foo` or `@-from 'foo.js' import * as foo` sets namespace to `foo` */
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

    if (imports?.length) {
      w.add('@-from ');
      path.writeSyntax(options);
      w.add(' import ');
      const first = imports[0];
      const firstName = typeof first === 'string' ? first : (Array.isArray(first) ? first[0] : first.name);
      const firstAlias = typeof first === 'string' ? undefined : (Array.isArray(first) ? first[1] : first.alias);
      if (imports.length === 1 && firstName === '*' && firstAlias) {
        w.add(`* as ${firstAlias}`);
      } else {
        w.add('(');
        for (let i = 0; i < imports.length; i++) {
          if (i > 0) {
            w.add(', ');
          }
          const specifier = imports[i];
          if (typeof specifier === 'string') {
            w.add(specifier);
            continue;
          }
          const name = Array.isArray(specifier) ? specifier[0] : specifier.name;
          const alias = Array.isArray(specifier) ? specifier[1] : specifier.alias;
          w.add(alias ? `${name} as ${alias}` : name);
        }
        w.add(')');
      }
      w.add(';');
      return;
    }

    w.add('@-use ');
    path.writeSyntax(options);
    if (namespace) {
      w.add(` as ${namespace}`);
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
