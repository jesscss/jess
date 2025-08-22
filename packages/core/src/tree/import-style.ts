import { Node, defineType } from './node';
import { type Reference } from './reference';
import { type Rules, type RulesOptions, type RulesVisibility } from './rules';
import { type Quoted } from './quoted';
import { type Context } from '../context';
import { isNode } from './util/is-node';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

/**
 * This class is for Jess / Sass+ / Less-style imports,
 * not the CSS `@import` rule. The two will be distinguished
 * during parsing.
 *
 * @see https://sass-lang.com/documentation/at-rules/import/#plain-css-imports
 */

export type ImportOptions = {
  /**
   * Affects evaluation - will be passed to registered import handlers when parsing.
   * Normally this is done by file extension, but can be overridden to select a
   * particular plugin handler.
   *
   * e.g. `@-import (type: less) 'foo.css';`
   */
  type?: string;
  /** Rules are not rendered in output. */
  reference?: boolean;
  /**
   * Less's default behavior for `@import` is to only output any resolved resource once.
   * In Jess, subsequent imports should output as reference unless the `multiple` option
   * is set to true.
   *
   * @todo - Investigate what Sass does.
   */
  multiple?: boolean;
  /** Rulesets can't be extended, the extend "search" will stop at this import. */
  protected?: boolean;
  /** Variables can't be reassigned (default is true for `@-compose` and false for `@-import`). */
  readonly?: boolean;
  [key: string]: any;
};

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
   *   - ❌ selectors are NOT rendered in output (but can be replaced / made visible with extend)
   *   - ❌ file imported by `@-reference` does not have access to parent scope
   */
  type: 'import' | 'compose';

  /**
   * Options passed to the Jess import plugin. Options are interpreted like
   * querystring parameters i.e.
   *   e.g. `@-import (foo, bar, baz: 1) 'foo.css';`
   *     - foo: true
   *     - bar: true
   *     - baz: '1'
   */
  importOptions?: ImportOptions;

  /** e.g. `import * as foo` sets namespace to `foo` */
  namespace?: string;

  /** Set on the import node instead of on rules */
  local?: boolean;
  rulesVisibility?: RulesOptions['rulesVisibility'];
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
 *   - Sass+ `@use` (for stylesheets)
 *   - Jess `@-compose` and Less `@compose`
 *   - Less, Sass+, and Jess `@import` / `@-import` that are indicated
 *     to be processed by the engine
 *
 * @see https://sass-lang.com/documentation/at-rules/import/
 */
export class StyleImport extends Node<StyleImportValue, StyleImportOptions> {
  type = 'StyleImport' as const;
  shortType = 'style' as const;
  override visible = false;
  override mayAsync = true;

  /**
   * @note
   * When imports are evaluated, they should be deeply cloned. The reason is that
   * they can be used in multiple places, and can be evaluated differently
   * each time, so they are more like a function call.
   *
   * @todo
   * How do extends work then?
   */
  override evalNode(context: Context): MaybePromise<this> {
    let node = this.maybeClone(context);
    const { path, with: withValues } = node.value;
    const { options } = node;
    options.importOptions ??= {};
    const { type, importOptions } = options;
    const maybePath = path.eval(context);
    if (isThenable(maybePath)) {
      return (maybePath as Promise<Quoted>).then(async (p) => {
        const finalPath = p.valueOf();
        let { node: rules, resolvedPath } = await context.getTree(finalPath, importOptions);
        let evaldRules = context.evaldTrees.get(resolvedPath);
        if (withValues) {
          if (withValues.type === 'set' && evaldRules) {
            throw new Error('Cannot configure a stylesheet more than once.');
          }
          let withRules = withValues.node.clone(true) as Rules;
          withRules.value.unshift(rules);
          rules = withRules;
        }
        if (!evaldRules || type === 'import') {
          let preserveOriginalNodes = context.preserveOriginalNodes;
          context.preserveOriginalNodes = true;
          rules = await rules.eval(context);
          context.preserveOriginalNodes = preserveOriginalNodes;
          if (withValues?.type === 'set') {
            context.evaldTrees.set(resolvedPath, rules);
          }
        } else {
          rules = evaldRules;
        }
        let Ruleset: RulesVisibility = 'public';
        let Declaration: RulesVisibility = 'public';
        let Mixin: RulesVisibility = 'public';
        if (importOptions.protected) {
          Ruleset = 'private';
        } else if (importOptions.reference) {
          Ruleset = 'optional';
        }
        if (type === 'compose') {
          importOptions.readonly ??= true;
        } else {
          importOptions.readonly ??= false;
        }
        node.options = {
          ...options,
          rulesVisibility: { Ruleset, Declaration, Mixin },
          local: type === 'compose'
        };
        node.value.rules = rules;
        return node;
      });
    }
    const finalPath = (maybePath as Quoted).valueOf();
    /**
     * @todo - Add options
     *
     * Note that the Less plugin should trigger a unique default behavior
     * for `@import` which is that it is de-duplicated by default. Meaning
     * that it won't render rulesets twice per compilation. I think that
     * means that it's just kind of ignored without an explicit `multiple`
     * option. Since all vars are global per compilation, it should just
     * work.
     */
    // sync path eval still requires async getTree, so return a promise from here
    return (async () => {
      let { node: rules, resolvedPath } = await context.getTree(finalPath, importOptions);
      let evaldRules = context.evaldTrees.get(resolvedPath);
      if (withValues) {
        if (withValues.type === 'set' && evaldRules) {
          throw new Error('Cannot configure a stylesheet more than once.');
        }

        /** @todo - Throw errors for undefined vars */
        let withRules = withValues.node.clone(true) as Rules;
        withRules.value.unshift(rules);

        rules = withRules;
      }

      /**
       * `@-import` stylesheets can read their parent scope,
       * so we always need to re-evaluate them.
       */
      if (!evaldRules || type === 'import') {
        /**
         * We need to preserve original nodes because we might
         * import multiple times with a `with` value.
         */
        let preserveOriginalNodes = context.preserveOriginalNodes;
        context.preserveOriginalNodes = true;
        rules = await rules.eval(context);
        context.preserveOriginalNodes = preserveOriginalNodes;

        if (withValues?.type === 'set') {
          context.evaldTrees.set(resolvedPath, rules);
        }
      } else {
        /** Attach the already-evaluated rules to the import node */
        rules = evaldRules;
      }

      /** Set visibility according to import type */
      let Ruleset: RulesVisibility = 'public';
      let Declaration: RulesVisibility = 'public';
      let Mixin: RulesVisibility = 'public';

      if (importOptions.protected) {
        Ruleset = 'private';
      } else if (importOptions.reference) {
        Ruleset = 'optional';
      }

      if (type === 'compose') {
        importOptions.readonly ??= true;
      } else {
        importOptions.readonly ??= false;
      }

      node.options = {
        ...options,
        rulesVisibility: {
          Ruleset,
          Declaration,
          Mixin
        },
        local: type === 'compose'
      };

      node.value.rules = rules;
      return node;
    })();
  }
}

export const style = defineType<StyleImportValue>(StyleImport, 'StyleImport', 'style');
