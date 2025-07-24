import { Node, defineType } from './node';
import { type Reference } from './reference';
import { type Rules } from './rules';
import { type Quoted } from './quoted';
import { type Context } from '../context';

/**
 * This class is for Jess / Sass+ / Less-style imports,
 * not the CSS `@import` rule. The two will be distinguished
 * during parsing.
 *
 * @see https://sass-lang.com/documentation/at-rules/import/#plain-css-imports
 */

export type StyleImportOptions = {
  /**
   * Affects scoping and evaluation
   *
   * - `use`
   *   - ✅ parent has access to `@-use` scope
   *   - ✅ selectors are rendered in output
   *   - ❌ file imported by `@-use` does not have access to parent scope
   * - `include`
   *   - ❌ parent does NOT have access to `@-include` scope
   *   - ✅ selectors are rendered in output
   *   - ❌ file imported by `@-include` does not have access to parent scope
   * - `import`
   *   - ✅ parent has access to `@-import` scope
   *   - ✅ selectors are rendered in output
   *   - ✅ file imported by `@-import` has access to parent scope
   * - `reference`
   *   - ✅ parent has access to `@-reference` scope
   *   - ❌ selectors are NOT rendered in output
   *   - ❌ file imported by `@-reference` does not have access to parent scope
   */
  type: 'use' | 'include' | 'import' | 'reference';

  /**
   * Options passed to the Jess import plugin. Options are interpreted like
   * querystring parameters i.e.
   *   e.g. `@-import (foo, bar, baz: 1) 'foo.css';`
   *     - foo: true
   *     - bar: true
   *     - baz: '1'
   */
  pluginOptions?: Record<string, any>;

  /** e.g. `import * as foo` sets namespace to `foo` */
  namespace?: string;
  /**
   * - In array,
   *   - string is a plain import identifier
   *   - [string, string] is { [identifier1] as [identifier2] }
  */
  imports?: string | Array<string | [string, string]>;

  /**
   * Affects evaluation - will be passed to registered import handlers when parsing.
   * Normally this is done by file extension, but can be overridden.
   *
   * e.g. `@-import 'foo.css?less';`
   */
  asType?: string;
};

export type StyleImportValue = {
  path: Quoted;

  /** Values to inject */
  with?: {
    node: Reference | Rules;
    /**
     * For use / ref / include statements, will affect how this module is evaluated
     * every time. 'set' can be used once per module, 'with' can be used multiple.
     * In Sass, 'set' is called 'with' and 'with' will be parsed as 'set'.
     *   e.g.
     *     `@-use 'library' set { $foo: 1 };` -- $foo will be set to 1 every time
     *     `@-use 'library' with { $foo: 1 };` -- $foo will be set to 1 just for this scope.
     */
    type: 'with' | 'set';
  };

  /** Post-evaluation rules */
  rules?: Rules;
};

/**
 * This is a generic class for:
 *   - Less, Sass+, Jess `@use`
 *   - Less, Sass+, Jess `@include`
 *   - Less, Jess `@from`
 *   - Less and Sass `@import` that are indicated to be processed by the engine
 *
 * `@use` values will be passed to Jess plugins
 *
 * @see https://sass-lang.com/documentation/at-rules/import/
 */
export class StyleImport extends Node<StyleImportValue, StyleImportOptions> {
  type = 'StyleImport' as const;
  shortType = 'style' as const;

  /**
   * @note
   * When imports are evaluated, they should be deeply cloned. The reason is that
   * they can be used in multiple places, and can be evaluated differently
   * each time, so they are more like a function call.
   *
   * @todo
   * How do extends work then?
   */
  override async evalNode(context: Context): Promise<Node> {
    const { path } = this.value;
    const finalPath = (await path.eval(context)).valueOf();
    /** @todo - Add options */
    const result = await context.getTree(finalPath);
    const rules = result.clone(true);
    return rules;
  }
}

export const style = defineType<StyleImportValue>(StyleImport, 'StyleImport', 'style');
