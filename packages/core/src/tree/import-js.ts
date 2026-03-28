import { F_MAY_ASYNC, F_NON_STATIC, Node, defineType } from './node.js';
import type { Context } from '../context.js';
import { type Quoted } from './quoted.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { setField } from './util/field-helpers.js';

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

export type JsImportChildData = { path: Quoted; imports: JsImportSpecifier[] | undefined };

export interface JsImport {
  type: 'JsImport';
  shortType: 'js';
}
export class JsImport extends Node<JsImportValue, JsImportOptions, JsImportChildData> {
  static override childKeys = ['path', 'imports'] as const;

  private path!: Quoted;
  private imports: JsImportSpecifier[] | undefined;

  constructor(value: JsImportValue, options?: JsImportOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.path = value.path;
    this.imports = value.imports;
    if (this.path instanceof Node) {
      this.adopt(this.path);
    }
    this.addFlags(F_MAY_ASYNC, F_NON_STATIC);
  }

  override evalNode(context: Context): MaybePromise<JsImport> {
    const path = this.get('path', context);
    const finish = (nextPath: Quoted): JsImport => {
      const out = this.maybeClone(context) as JsImport;
      if (nextPath !== path) {
        if (out === this) {
          setField(this, 'path', nextPath, context);
        } else {
          out.setData('path', nextPath);
        }
      }
      return out;
    };
    const maybeEvald = path.eval(context);
    if (isThenable(maybeEvald)) {
      return (maybeEvald as Promise<Quoted>).then(finish);
    }
    return finish(maybeEvald as Quoted);
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    const path = this.get('path', context);
    const { namespace } = this.options;
    const imports = this.get('imports', context) ?? (Array.isArray(this.options.imports) ? this.options.imports : undefined);

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
