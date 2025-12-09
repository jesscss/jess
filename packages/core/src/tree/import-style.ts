import { Node, F_MAY_ASYNC, F_NON_STATIC, defineType } from './node';
import { type Reference } from './reference';
import { rules, Rules, type RulesOptions, type RulesVisibility } from './rules';
import { type Quoted } from './quoted';
import { Url } from './url';
import { type Context } from '../context';
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
  /** Variables and mixins are forwarded to a downstream stylesheet. */
  export?: boolean;
  /** Shorthand for `reference`, `export`, and `protected` all set to true. */
  forward?: boolean;
  /** Variables can't be reassigned (default is true for `@-compose` and false for `@-import`). */
  readonly?: boolean;
  [key: string]: any;
};

export type StyleImportOptions = {
  /**
   * Old-style `@import` type or new `@-compose` type.
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
  path: Quoted | Url;

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
};

export interface StyleImport extends Node<StyleImportValue, StyleImportOptions> {
  eval(context: Context): MaybePromise<Rules>;
}
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

  constructor(value: StyleImportValue, options?: StyleImportOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    // Style imports are always non-static and may be async
    this.addFlags(F_MAY_ASYNC, F_NON_STATIC);
  }

  getFinalRules(evaluatedRules: Rules) {
    let { importOptions, type } = this.options;
    // Handle 'forward' as shorthand for reference, export, and protected
    const forward = importOptions!.forward;
    const reference = importOptions!.reference || forward;
    const isExport = importOptions!.export || forward;
    const isProtected = importOptions!.protected || forward;

    let Ruleset: RulesVisibility = 'public';
    let Declaration: RulesVisibility = 'public';
    let Mixin: RulesVisibility = 'public';
    let VarDeclaration: RulesVisibility = 'public';

    if (isProtected) {
      Ruleset = 'private';
    } else if (reference) {
      // Reference option makes rulesets and mixins optional
      Ruleset = 'optional';
      Mixin = 'optional';
    }

    /**
     * Create a rules wrapper so we can set visibility.
     * The inner rules may be static, but the import may
     * have different import settings.
     *
     * For compose type:
     * - By default, variables and mixins are local (not visible to parent)
     * - If 'export' flag is set, variables and mixins are forwarded (visible to parent)
     */
    let out = evaluatedRules.clone();
    // If export is set, don't set local (variables/mixins should be visible to parent)
    const isLocal = type === 'compose' && !isExport;
    out.options = {
      rulesVisibility: { Ruleset, Declaration, Mixin, VarDeclaration },
      local: isLocal,
      readonly: importOptions!.readonly ?? (type === 'compose' ? true : false)
    };
    // Set sourceNode so variable lookups know they can cross import boundaries
    out.sourceNode = this;
    this.adopt(out);
    return out;
  }

  /**
   * @note
   * When imports are evaluated, they should be deeply cloned. The reason is that
   * they can be used in multiple places, and can be evaluated differently
   * each time, so they are more like a function call.
   *
   * @todo
   * How do extends work then?
   */
  override evalNode(context: Context): MaybePromise<Rules> {
    let node = this;
    const { path, with: withValues } = node.value;
    const { options } = node;
    options.importOptions ??= {};
    const { type, importOptions } = options;
    const maybePath = path.eval(context);

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

    const finalize = async (finalPath: string) => {
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
      /** Freshly evaluate the rules in these circumstances
       * - `with` (or `set`) values are present
       * - the rules have not been evaluated yet
       * - the import type is `import`
      */
      if (withValues || !evaldRules || type === 'import') {
        let preserveOriginalNodes = context.preserveOriginalNodes;
        context.preserveOriginalNodes = true;
        if (type === 'import') {
          /** Needed at evaluation time for older import type */
          rules.parent = node;
        }
        rules = await rules.eval(context);
        context.preserveOriginalNodes = preserveOriginalNodes;
        if (withValues?.type === 'set') {
          context.evaldTrees.set(resolvedPath, rules);
        }
      } else {
        rules = evaldRules.clone();
      }

      return node.getFinalRules(rules);
    };
    if (isThenable(maybePath)) {
      return (maybePath as Promise<Quoted | Url>).then(async (p) => {
        const finalPath = p.valueOf();
        return finalize(finalPath);
      });
    }
    const finalPath = maybePath.valueOf();
    return finalize(finalPath as string);
  }
}

defineType<StyleImportValue>(StyleImport, 'StyleImport', 'style');

export const style = (...args: ConstructorParameters<typeof StyleImport>) => {
  return new StyleImport(...args);
};
