import { Node, F_MAY_ASYNC, F_NON_STATIC, defineType } from './node';
import { type Reference } from './reference';
import { rules, Rules, type RulesOptions, type RulesVisibility } from './rules';
import { type Quoted } from './quoted';
import { Url } from './url';
import { type Context } from '../context';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node';
import { normalizeFilenameToNamespace } from './util/format';

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
      /**
       * Not sure if this is true.
       * They won't be output, but that's not the same as being optional,
       * UNLESS we're extending the word 'optional' to mean "not output".
       *
       * I think what we mean here by "optional" it "not ouptut unless extended".
       * Our test for reference therefore should mimic Less behavior.
       */
      Ruleset = 'optional';
    }

    /**
     * Create a rules wrapper so we can set visibility.
     * The inner rules may be static, but the import may
     * have different import settings.
     *
     * For compose type:
     * - Variables and mixins are visible to the direct parent (the file that imports them)
     * - If 'export' flag is set, variables and mixins are also forwarded to downstream stylesheets
     * - The 'local' flag means: visible to direct parent, but not re-exported to parent's parent
     */
    let out = evaluatedRules.clone();
    // Import type: variables are visible and re-exported (not local)
    // Compose type: variables are visible to parent, but not re-exported unless export is set
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
        // Clone the imported rules BEFORE evaluation so registries are populated on the clone
        let modifiedRules = rules.clone(true) as Rules;
        // withValues.node might be a Reference, so evaluate it first to get Rules
        let withRulesNode = withValues.node;
        if (isNode(withRulesNode, 'Reference')) {
          // Evaluate the reference to get the actual Rules
          const evaluated = await withRulesNode.eval(context);
          if (!isNode(evaluated, 'Rules')) {
            throw new Error('with/set node must evaluate to Rules');
          }
          withRulesNode = evaluated;
        }
        // withRules don't need to be cloned because they are used once
        let withRules = withRulesNode as Rules;

        // Build the declaration registry for efficient lookups
        // This avoids O(n*m) complexity when we have many injected variables
        // First, register all nodes in modifiedRules so they're in the registry
        for (const node of modifiedRules.value) {
          modifiedRules.registerNode(node);
        }
        const declarationRegistry = modifiedRules.getRegistry('declaration');
        declarationRegistry.indexPendingItems();

        // Separate injected variables into two groups:
        // 1. Variables that replace existing ones (found in imported rules)
        // 2. Variables that are new (not found in imported rules)
        const newVariables: Node[] = [];

        // For each injected variable, find and replace the first matching declaration
        // in the imported rules, OR if not found, add it to newVariables to inject at the top.
        // This ensures the injected value "overrides" the original.
        // Works correctly for both scope lookup ($var) and linear lookup ($^var):
        // - For linear lookup: injected vars come first, so they're found first
        // - For scope lookup: original is replaced, so injected value wins
        for (const injectedNode of withRules.value) {
          if (isNode(injectedNode, 'VarDeclaration')) {
            const varName = injectedNode.value.name?.toString();
            if (varName) {
              // Use the registry for efficient lookup instead of linear search
              const declarations = declarationRegistry.index.get(varName);
              if (declarations) {
                // Find the first VarDeclaration in the set (sorted by index)
                const existingDecl = Array.from(declarations).find(decl => isNode(decl, 'VarDeclaration'));

                if (existingDecl) {
                  // Remove the old declaration from the registry
                  declarations.delete(existingDecl);
                  // Find its index in the array and replace it
                  const index = modifiedRules.value.indexOf(existingDecl);
                  if (index !== -1) {
                    // Adopt the new node and replace in array
                    modifiedRules.adopt(injectedNode);
                    modifiedRules.value[index] = injectedNode;
                    // Add the new declaration to the registry
                    declarations.add(injectedNode);
                    // Register the new node so it's properly indexed
                    modifiedRules.registerNode(injectedNode);
                  }
                } else {
                  // Not found, add to newVariables to inject at the top
                  newVariables.push(injectedNode);
                }
              } else {
                // Not found in registry, add to newVariables to inject at the top
                newVariables.push(injectedNode);
              }
            } else {
              // Non-variable nodes (if any) are kept as-is
              newVariables.push(injectedNode);
            }
          } else {
            // Non-VarDeclaration nodes are kept as-is
            newVariables.push(injectedNode);
          }
        }

        // Create the final rules structure:
        // [new injected variables (not found in imported), ...all nodes from modified imported rules (with replacements)]
        // Injected variables that aren't found should be at the TOP so they're found first
        // for linear lookup ($^var)
        // We flatten the structure so all variables are in the same Rules scope
        const finalRules = new Rules([]);
        // First, add new injected variables that weren't found in imported rules (at the top)
        for (const newNode of newVariables) {
          finalRules.adopt(newNode);
          finalRules.value.push(newNode);
        }
        // Then, add all nodes from the modified imported rules (flattened, with replacements)
        for (const node of modifiedRules.value) {
          finalRules.adopt(node);
          finalRules.value.push(node);
        }
        rules = finalRules;
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
        // Clone the unevaluated rules BEFORE evaluation so registries are populated on the clone
        // This ensures registration happens post-clone, not on the cached evaldRules
        rules = rules.clone(true) as Rules;
        let preserveOriginalNodes = context.preserveOriginalNodes;
        context.preserveOriginalNodes = true;
        // Note: For compose type, we don't set rules.parent = node
        // (only import type needs this for older import behavior)
        rules = await rules.eval(context);
        context.preserveOriginalNodes = preserveOriginalNodes;
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
