import { F_MAY_ASYNC, F_NON_STATIC, Node, defineType } from './node.js';
import { type Quoted } from './quoted.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

/**
 * Imports of TS/JS ESM modules.
 *
 * `@-from 'foo.js' import ( name, ... );` or `@-from 'foo.js' import * as ns;`
 */

type JsImportSpecifier = string | [string, string] | { name: string; alias?: string };

export type JsImportOptions = {
  /** e.g. `@-from 'foo.js' import * as foo` sets namespace to `foo` */
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

export interface JsImport {
  type: 'JsImport';
  shortType: 'js';
}
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
    const { path } = this.data;
    const { namespace } = this.options;
    const imports = this.data.imports ?? (Array.isArray(this.options.imports) ? this.options.imports : undefined);

    w.add('@-from ');
    path.toString(options);

    // Named imports: `import ( name, name as alias, ... )`
    const namedImports = imports?.filter((s) => {
      if (typeof s === 'string') {
        return true;
      }
      if (Array.isArray(s)) {
        return s[0] !== '*';
      }
      return s.name !== '*';
    });
    if (namedImports?.length) {
      const parts = namedImports.map((s) => {
        if (typeof s === 'string') {
          return s;
        }
        if (Array.isArray(s)) {
          return `${s[0]} as ${s[1]}`;
        }
        return s.alias ? `${s.name} as ${s.alias}` : s.name;
      });
      w.add(` import ( ${parts.join(', ')} )`);
    }

    // Namespace import: `import * as ns`
    let explicitNamespace = namespace;
    if (!explicitNamespace && imports?.length) {
      const nsSpec = imports.find((specifier) => {
        if (Array.isArray(specifier)) {
          return specifier[0] === '*';
        }
        if (typeof specifier !== 'string') {
          return specifier.name === '*';
        }
        return false;
      });
      if (nsSpec) {
        explicitNamespace = Array.isArray(nsSpec)
          ? nsSpec[1]
          : (typeof nsSpec === 'string' ? undefined : nsSpec.alias);
      }
    }
    if (explicitNamespace) {
      w.add(` import * as ${explicitNamespace}`);
    }
    w.add(';');
    return w.getSince(mark);
  }
}

export const js = defineType<JsImportValue>(JsImport, 'JsImport', 'js');
