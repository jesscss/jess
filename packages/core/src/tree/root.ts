import { defineType, type NoOverride } from './node';
import { Rules } from './rules';
import type { Context } from '../context';
import type { Selector } from './selector';
import { tryExtendSelector } from './util/extend';
import { JessError } from '../jess-error';

/**
 * The root node. Contains a collection of nodes.
 * The tree will have a root, but each file will have its own root.
 *
 * @todo - I think we can remove and just have Rules
 */
export class Root extends Rules {
  /**
   * @todo - Rewrite to handle "root rules" better.
   * There shouldn't be root rules so much as parent / root rules.
   */
  // override async evalNode(context: Context): Promise<this> {
  //   context.opts.mathMode = this.treeContext.mathMode;
  //   context.opts.unitMode = this.treeContext.unitMode;
  //   context.depth++;
  //   let currentCurrentRoot = context.currentRoot;
  //   context.currentRoot = this;
  //   context.root ??= this;
  //   let currentTreeContext = context.treeContext;
  //   context.treeContext = this.treeContext;
  //   let node = (await super.evalNode(context)) as this;
  //   context.depth--;
  //   /** We've evaluated all roots! We can extend now! */
  //   if (this === context.root) {
  //     for (const [find, extendWith, partial] of node.pendingExtends) {
  //       const candidates = this.selectorRegistry.findCandidateRulesets(find);
  //       for (const candidate of candidates) {
  //         /** @todo - Fix Ruleset typing */
  //         const result = tryExtendSelector(candidate.selector as Selector, find, extendWith, partial);
  //         if (result.error && result.error.type === 'NOT_FOUND') {
  //           throw new JessError({
  //             type: 'ExtendError',
  //             message: result.error.message
  //             /** @todo */
  //             // filePath: this.filePath,
  //             // line: this.line,
  //             // column: this.column,
  //             // source: this.source
  //           });
  //         }
  //       }
  //     }
  //   }
  //   context.treeContext = currentTreeContext;
  //   context.currentRoot = currentCurrentRoot;
  //   return node;
  // }

  override toString(depth?: number | undefined) {
    /** Remove leading newlines */
    return super.toString(depth).replace(/^\n+/, '') as NoOverride<string>;
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.value.forEach(v => {
  //     v.toCSS(context, out)
  //     /** Another root will add its own line breaks */
  //     if (!(v instanceof Root)) {
  //       out.add('\n')
  //     }
  //   })
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add(
  //     'import * as $J from \'jess\'\n' +
  //     `const $CONTEXT = new $J.Context(${JSON.stringify(context.originalOpts)})\n` +
  //     `$CONTEXT.id = '${context.id}'\n`,
  //     this.location
  //   )
  //   const jsNodes = this.value.filter(n => n instanceof JsNode)
  //   jsNodes.forEach(node => {
  //     node.toModule(context, out)
  //     out.add('\n')
  //   })

  //   out.add(
  //     'function $DEFAULT ($VARS = {}, $RETURN_NODE) {\n'
  //   )
  //   context.indent++
  //   context.depth++

  //   let pre = context.pre
  //   jsNodes.forEach(node => {
  //     out.add(pre)
  //     node.toModule(context, out)
  //     out.add('\n')
  //   })

  //   if (!context.opts.dynamic && context.isRuntime) {
  //     out.add(`${pre}return {\n`)
  //     let i = 0
  //     context.exports.forEach(key => {
  //       if (i !== 0) {
  //         out.add(',\n')
  //       }
  //       i++
  //       out.add(`${pre}  ${key}`)
  //     })
  //     out.add(`\n${pre}}\n`)
  //   } else {
  //     out.add(`${pre}const $TREE = $J.root((() => {\n`)
  //     out.add(`  ${pre}const $OUT = []\n`)
  //     context.indent++
  //     pre = context.pre

  //     this.value.forEach(node => {
  //       if (!(node instanceof JsNode)) {
  //         out.add(pre)
  //         out.add('$OUT.push(')
  //         node.toModule(context, out)
  //         out.add(')\n')
  //       }
  //     })
  //     context.indent--
  //     pre = context.pre
  //     out.add(`  ${pre}return $OUT\n${pre}})(),${JSON.stringify(this.location)})\n`)
  //     out.add(`${pre}if ($RETURN_NODE) {\n`)
  //     out.add(`${pre}  return $TREE\n`)
  //     out.add(`${pre}}\n`)
  //     out.add(`${pre}return {\n`)
  //     out.add(`${pre}  ...$J.renderCss($TREE, $CONTEXT)`)
  //     context.exports.forEach(key => {
  //       out.add(`,\n${pre}  ${key}`)
  //     })
  //     out.add(`\n${pre}}\n`)
  //   }
  //   out.add('}\n')
  //   // out.add(`$DEFAULT.$IS_NODE = true\n`)
  //   out.add('const $DEFAULT_PROXY = $J.proxy($DEFAULT, $CONTEXT)\n')
  //   out.add('$DEFAULT_PROXY(undefined, true)\n')
  //   out.add('export default $DEFAULT_PROXY')
  //   context.indent = 0
  //   context.depth = 0
  // }
}

export const root = defineType(Root, 'Root');