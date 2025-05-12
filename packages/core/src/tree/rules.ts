/* eslint-disable @typescript-eslint/prefer-readonly */
import { Node, defineType, type NodeData } from './node'
import {
  Declaration,
  type DeclarationOptions,
  type DeclarationValue
} from './declaration'
import {
  VarDeclaration,
  type VarDeclarationOptions
} from './var-declaration'
import { Scope } from '../scope'
import type { Context } from '../context'
import { isNode } from './util'
import { Ruleset } from './ruleset'
import { type AtRule } from './at-rule'
import { Nil } from './nil'
import { type Root } from './root'
import { Mixin } from './mixin'
import { Interpolated } from './interpolated'
import { ArrayList } from './util/collections'
// import { LinkedList } from './util/collections'

export const enum Priority {
  None = 0,
  Low = 1,
  Medium = 2,
  High = 3
}

type AnyDeclarationValue = DeclarationValue & Record<string, any>

type QueueItem = {
  node: Node
  /** Position in rules array */
  pos: number
  nameOnly?: true
} | {
  node: Declaration
  pos: number
  /** If we're just evaluating a declaration's name */
  nameOnly: true
}

type QueueMap = Map<Priority, Set<QueueItem>>

/**
 * The class representing a "declaration list".
 * CSS calls it this even though CSS Nesting
 * adds a bunch more things that aren't declarations.
 *
 * Used by Ruleset and Mixin. Additionally, imports / use statements
 * return rules.
 *
 * @example
 * color: black;
 * background-color: white;
 */

export class Rules extends Node<Node[]> {
  declare value: Node[]
  declare data: NodeData<Node[]>
  type = 'Rules'
  shortType = 'rules'
  override allowRuleRoot = true
  override allowRoot = true

  private _scope: Scope | undefined
  get scope() {
    return (this._scope ??= new Scope(this))
  }

  set scope(s: Scope) {
    this._scope = s
  }

  * [Symbol.iterator]() {
    yield * (this.data.data as ArrayList<Node>).entries()
  }

  override toTrimmedString(depth: number = 0) {
    let space = ''.padStart(depth * 2)
    let output = ''
    let { value } = this
    let outputs = value
      .map((n, i) => {
        let initial = n.toString(depth, '\n') as string
        if (n.requiredSemi && n.options.semi !== false && value.length >= i) {
          initial += ';'
        }
        return initial.replace(/^(\n?)[ \t]*/, `$1${space}`)
      })
    output += outputs
      .join('')
      /**
       * Replace multiple newlines with single newlines
       * (Remove empty lines)
       */
      .replace(/\n+/g, '\n')
    return output
  }

  visibleRules() {
    return this.value.filter(n => n.visible)
  }

  assign(map: QueueMap, key: Priority, value: Node, pos: number, nameOnly?: true | undefined) {
    let set = map.get(key)
    if (set) {
      set.add({ node: value, pos, nameOnly })
    } else {
      map.set(key, new Set([{ node: value, pos, nameOnly }]))
    }
  }

  override async evalNode(context: Context): Promise<Rules | Root> {
    let inheritedScope = context.scope
    context.scope = this.scope
    let { leakVariablesIntoScope } = this.treeContext
    let rules = this.clone()
    rules.scope = this.scope
    let assign = this.assign
    /**
     * Make a shallow copy of rules.
     * This is because we're going to replace
     * each item in the array when evaluating.
     */
    rules.value = [...this.value]
    let evalQueue: QueueMap = new Map()

    /**
     * First, create a linked list.
     * This is so folding in mixins can be done
     * without mutating arrays.
     */
    // let prev: Node | undefined
    // let nodeLength = ruleValues.length
    /** Iterate in reverse order, to assign the _next node */
    // for (let i = nodeLength - 1; i >= 0; i--) {
    //   const n = value[i]
    //   if (i === nodeLength - 1) {
    //     this._last = n
    //   }
    //   if (i === 0) {
    //     this._first = n
    //   }
    //   if (prev) {
    //     n._next = prev
    //   }
    //   prev = n
    // }

    /**
     * Assign to the evaluation queue.
     *
     * Evalution order (in Less) should go:
     *   1. static declaration names (names that do not, themselves,
     *      contain variables). This includes mixin and qualified rule names
     *   2. variable declaration names
     *   3. mixin and function calls
     *   3. everything else (declaration values, etc.)
     *
     * Everything else:
     *   1. static declaration names of mixins and functions
     *   2. variable declaration names of mixins and functions
     *   3. everything else
     */
    for (let [i, n] of rules) {
      /** Evaluate names */
      if (n instanceof Declaration || n instanceof Mixin) {
        const { name } = n.value
        
        if (name instanceof Node) {
          if (name instanceof Interpolated) {
            /** Evaluate these names after evaluating static names */
            assign(evalQueue, Priority.Medium, n, i, true)
          } else {
            /** Evaluate static names first */
            assign(evalQueue, Priority.High, n, i, true)
          }
        }
      /**
       * Hoist imports
       *
       * @note - this might need tweaking
       */
      } else if (isNode(n, 'Import')) {
        assign(evalQueue, Priority.Low, n, i)
      } else {
        assign(evalQueue, Priority.None, n, i)
      }
    }

    /** Start with high priority */
    for (let i: Priority = Priority.High; i >= 0; i--) {
      let set = evalQueue.get(i)
      if (!set) {
        continue
      }

      for (let item of set) {
        const { node, pos, nameOnly } = item
        if (nameOnly) {
          let decl = node.clone() as Declaration
          /** Everything in a ruleset root will have a name */
          let name = decl.value.name
          let ident: string
          if (name instanceof Node) {
            ident = (await name.eval(context)).value
            decl.value.name = ident
          } else {
            ident = name
          }
          if (!decl.allowRuleRoot) {
            decl.visible = false
          }
          rules.data.setAt(pos, decl)
        
          // if (isNode(decl, 'Mixin')) {
          //   this._scope.setMixin(ident, decl, decl.options)
          // } else if (isNode(decl, ['VarDeclaration', 'Func'])) {
          //   this._scope.setVar(ident, decl, decl.options as VarDeclarationOptions)
          // } else {
          //   this._scope.setProp(ident, decl as Declaration)
          // }
          /**
           * Now that we've evaluated the name, add it to the evaluation queue.
           * (Variable values are not evaluated unless they are called)
           */
          if (!(decl instanceof VarDeclaration)) {
            assign(evalQueue, Priority.None, decl, i)
          }
        } else {
          /** Variable values are only evaluated if referenced */
          if (!(node instanceof VarDeclaration)) {
            if (node instanceof Declaration) {
              /**
               * We've already cloned and partially evaluated this,
               * so we only need to evaluate the value.
               */
              context.declarationScope.push(node)
              let evaldValue = await node.data.get('value').eval(context)
              context.declarationScope.pop()

              /**
               * If the eval'd value of the declaration is Nil, effectively
               * remove the declaration from the ruleset by setting the entire
               * declaration to Nil.
               * 
               * @todo - Is this correct? I'm not sure this is correct. 
               */
              if (evaldValue instanceof Nil) {
                rules.data.setAt(pos, evaldValue)
              } else {
                /** Else set the value only of the (declaration) node */
                node.data.set('value', evaldValue)
              }
            } else {
              /**
               * Not a VarDeclaration and not a declaration.
               * What is it?
               */
              let result = await node.eval(context)
              
              if (!result.allowRuleRoot) {
                result.visible = false
              }
              if (result instanceof Rules) {
                /** @todo Push inherited prop / ruleset references into parent scope */
                // let returnRules = result.data.list
                // if (leakVariablesIntoScope) {
                //   rules.data.list.splice(pos, 1, ...returnRules)
                // } else {
                //   returnRules = returnRules.filter((current, i) => {

                //   })
                // }
                
              } else {
                // rules.data.set(ROOT_DATA, result, pos)
              }

              /** Merge any scope that we need for lookups */
              // if (result instanceof Rules) {
              //   this._scope.merge(result._scope, leakVariablesIntoScope)
              // }
            }
          }
        }
      }
    }

      // let current = map[0]
      // let prevEvald: Node | undefined

      /**
       * This will dynamically link rulesets like
       * [rule]._next = [ruleset]._first
       * [ruleset]._last = [rule]._next._next
       *
       * @todo Register declarations for languages
       *       that merge them in.
       */
      // while (current) {
      //   let evald: Node

      //   if (current.nameOnly) {
      //     const decl = current.node.clone() as Declaration<Node>
      //     decl.name = decl.name.eval(context)
      //     evald = decl
      //   } else {
      //     evald = current.node.eval(context)
      //   }
      //   const evaldIsRules = evald instanceof Rules
      //   /**
      //    * If previous iteration produced a ruleset, link its
      //    * last value to the currently-evaluated rule
      //    */
      //   if (prevEvald) {
      //     if (prevEvald instanceof Rules) {
      //       prevEvald._last._next = evald
      //     } else {
      //       prevEvald._next = evald
      //     }
      //   }

      //   /**
      //    * If we're on the first node, and it evals to a ruleset,
      //    * link this ruleset's first node to the first node of
      //    * the ruleset.
      //    */
      //   if (this._first === current.node) {
      //     if (evaldIsRules) {
      //       this._first = (evald as Rules)._first
      //     } else {
      //       this._first = evald
      //     }
      //   }

      //   if (evaldIsRules && prevEvald) {
      //     prevEvald._next = (evald as Rules)._first
      //   }

      //   /**
      //    * If we're on the last node, and it evals to a ruleset,
      //    * link this ruleset's last node to the last node of
      //    * the ruleset.
      //    */
      //   if (this._last === current.node) {
      //     if (evaldIsRules) {
      //       this._last = (evald as Rules)._last
      //     } else {
      //       this._last = evald
      //     }
      //   }

      //   current = current._next
      //   prevEvald = evald
      // }

    let newRules: Node[] = []

    /** @todo - Probably need to re-write bubbling */
    let bubbleRootRules = (rule: Node) => {
      let importedRoots =
        (isNode(rule, 'Ruleset') || isNode(rule, 'AtRule'))
          ? rule.value.rules?.rootRules
          : rule.rootRules
      if (importedRoots) {
        const newImportedRoots = new ArrayList()
        for (let r of importedRoots) {
          if (r.options.hoistToParent) {
            r.options.hoistToParent = false
            newRules.push(r)
            continue
          }
          newImportedRoots.push(r)
        }
        let { rootRules } = rules
        if (!rootRules) {
          rules.rootRules = newImportedRoots
        } else {
          rootRules.push(...newImportedRoots)
        }
      }
    }
    /**
     * Bubble rules to root as needed
     */
    let tryAddToRoot = (rule: Ruleset | AtRule) => {
      if (
        rules.type !== 'Root'
        && (
          rule.options.hoistToRoot
          || rule.options.hoistToParent
          || context.opts.collapseNesting
        )
      ) {
        /** Remove empty rules */
        if (!rules.rootRules) {
          rules.rootRules = new ArrayList([rule])
        } else {
          rules.rootRules.push(rule)
        }
      } else {
        newRules.push(rule)
      }
    }

    let walkRules = (rules: Node[]) => {
      rules.forEach(rule => {
        if (isNode(rule, ['Ruleset', 'AtRule'])) {
          tryAddToRoot(rule)
          bubbleRootRules(rule)
        } else if (rule instanceof Rules) {
          bubbleRootRules(rule)
          walkRules(rule.value)
        } else {
          newRules.push(rule)
        }
      })
    }
    walkRules(ruleValues)
    rules.value = newRules
    /** Restore scope */
    context.scope = inheritedScope
    return rules
  }

  /**
   * Return an object representation of a ruleset
   *
   * @todo - get primitive values rendered for things
   * like numbers?
   */
  toObject() {
    let output = new Map<string, string>()
    const iterateRules = (rules: Rules) => {
      let value = rules.value
      value.forEach(n => {
        if (n instanceof Declaration) {
          let { name, value, important } = n
          output.set(name.toString(), `${n.value.valueOf()}${n.important ? ` ${n.important}` : ''}`)
        } else if (n instanceof Rules) {
          iterateRules(n)
        }
      })
    }
    iterateRules(this as unknown as Rules)
    return Object.fromEntries(output)
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   const value = this.value
  //   out.add('{\n')
  //   context.indent++
  //   let pre = context.pre
  //   value.forEach(v => {
  //     out.add(pre)
  //     v.toCSS(context, out)
  //     out.add('\n')
  //   })
  //   context.indent--
  //   pre = context.pre
  //   out.add(`${pre}}`)
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const depth = context.depth
  //   context.depth = 2

  //   out.add('$J.ruleset(\n', this.location)
  //   context.indent++
  //   let pre = context.pre
  //   out.add(`${pre}(() => {\n`)
  //   context.indent++
  //   out.add(`  ${pre}const $OUT = []\n`)
  //   this.value.forEach((node, i) => {
  //     out.add(`  ${pre}`)
  //     if (node instanceof JsNode) {
  //       node.toModule(context, out)
  //       out.add('\n')
  //     } else if (node instanceof Declaration && context.opts.dynamic) {
  //       /**
  //        * Creates either runtime vars or var() depending on settings
  //        */
  //       const n = node.clone()
  //       const process = (n: Node) => {
  //         if (n instanceof JsExpr || n instanceof Call) {
  //           if (context.isRuntime) {
  //             context.rootRules.push(new Declaration({
  //               name: context.getVar(),
  //               value: n
  //             }))
  //             return n
  //           }
  //           return new Call({
  //             name: 'var',
  //             value: new List([
  //               context.getVar(),
  //               n
  //             ])
  //           })
  //         }
  //         n.processNodes(process)
  //         return n
  //       }
  //       n.processNodes(process)

  //       if (context.isRuntime) {
  //         context.rootRules.forEach(n => {
  //           out.add('$OUT.push(')
  //           n.toModule(context, out)
  //           out.add(')\n')
  //         })
  //         context.rootRules = []
  //       } else {
  //         out.add('$OUT.push(')
  //         n.toModule(context, out)
  //         out.add(')\n')
  //       }
  //     } else {
  //       out.add('$OUT.push(')
  //       node.toModule(context, out)
  //       out.add(')\n')
  //     }
  //   })
  //   out.add(`  ${pre}return $OUT\n${pre}})()`)
  //   context.indent -= 2
  //   pre = context.pre
  //   out.add(`\n${pre})`)

  //   context.depth = depth
  // }
}
export const rules = defineType(Rules, 'Rules')