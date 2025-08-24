import { F_MAY_ASYNC, F_NON_STATIC, Node, defineType } from './node';
import { type Quoted } from './quoted';

/**
 * Imports of TS/JS ESM modules.
 *
 * `@-from 'foo.js' import (bar, baz);`
 */

export type JsImportOptions = {
  /** e.g. `import * as foo` sets namespace to `foo` */
  namespace?: string;
  /**
   * - In array,
   *   - string is a plain import identifier
   *   - [string, string] is { [identifier1] as [identifier2] }
  */
  imports?: string | Array<string | [string, string]>;
};

export type JsImportValue = {
  path: Quoted;
};

export class JsImport extends Node<JsImportValue, JsImportOptions> {
  type = 'JsImport' as const;
  shortType = 'js' as const;

  constructor(value: JsImportValue, options?: JsImportOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    // JS imports are always non-static and may be async
    this.state |= F_MAY_ASYNC | F_NON_STATIC;
  }
}

export const js = defineType<JsImportValue>(JsImport, 'JsImport', 'js');
