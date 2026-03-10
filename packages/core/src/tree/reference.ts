import { defineType, Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, type LocationInfo } from './node.js';
import type { Context, TreeContext } from '../context.js';
import { cast } from './util/cast.js';
import type { FindOptions } from './util/registry-utils.js';
import { Any, type AnyRole } from './any.js';
import { Selector } from './selector.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import type { Call } from './call.js';
import type { Quoted } from './quoted.js';
import { atIndex } from './util/collections.js';
import type { Num } from './number.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import { getFunctionFromMixins } from './rules.js';
import type { MixinEntry, Rules } from './rules.js';
import type { Interpolated } from './interpolated.js';
import { freezeChildren } from './util/cloning.js';
import type { Ruleset } from './ruleset.js';
import type { Declaration } from './declaration.js';
import type { Color } from './color.js';
/**
 * The type is determined by syntax
 * and location.
 *   e.g. in Jess
 *    - `$foo` refers to a variable
 *    - `$.foo` is a prop or var
 *    - `$foo$(bar)` is a var var
 *    - `$foo.bar` is a prop or var `bar` in `foo`
 *    - in `$|.foo()`, `.foo` is a mixin
 *    - in `$foo|.mixin()`, `.mixin` is a mixin in `$foo`
 *    - Resolution:
 *      - `$` searches scope,
 *      - `$^` searches in declaration order
 *   in Less
 *   - `@foo` refers to a variable
 *   - `$foo` refers to a property
 *   - `.foo` or `#foo` refers to a mixin
 */
export type ReferenceValue = {
  target?: Reference | Call | undefined;
  key:
    string
    | string[]
    | Node
    | Any
    | number // $[0] or $.0
    | Num // $.key or $[key] or $*key
    | Quoted // $['key']
    | Selector // $*(.selector)
    | Reference // $.key
    | Interpolated; // @{variable} interpolation
};

export type ReferenceOptions = {
  /**
   * What kind of lookup are we doing?
   */
  type?: 'index' | 'declaration' | 'variable' | 'property' | 'function' | 'mixin' | 'ruleset' | 'mixin-ruleset';
  /**
   * Resolution strategy:
   * - 'scope': Search in scope (Less-style, default)
   * - 'linear': Search linearly from definition position (Sass-style for regular code)
   * - 'call-time': Search linearly from call site position (Sass-style for mixins/functions)
   */
  resolution?: 'scope' | 'linear' | 'call-time';
  /**
   * Optional references just resolve to the string
   * representation if the fallback value is set to true.
   *
   * @note - Used by Less for function references
   */
  fallbackValue?: Node | true;
  filter?: (node: Node) => boolean;
  role?: AnyRole;
};
const { isArray } = Array;

function isInsideSelectorCapture(node: Node | undefined): boolean {
  let cursor: Node | undefined = node;
  while (cursor) {
    if (cursor.type === 'SelectorCapture') {
      return true;
    }
    cursor = cursor.parent;
  }
  return false;
}

/**
 * This is a variable or property reference,
 * which can itself contain a reference (a variable variable).
 */
export class Reference extends Node<ReferenceValue, ReferenceOptions> {
  type = 'Reference';
  shortType = 'ref';

  constructor(value: ReferenceValue | string, options?: ReferenceOptions, location?: LocationInfo, treeContext?: TreeContext) {
    if (typeof value === 'string') {
      value = { key: value };
    }
    super(value, options, location, treeContext);
    // References are always non-static and may be async
    this.addFlags(F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC);
  }

  override valueOf() {
    return '';
  }

  /**
   * @note - A reference doesn't render `$` (unless it has a target);
   *         that's managed by the parent expression.
   */
  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { type = 'variable', resolution, fallbackValue, role } = this.options;
    let { target, key } = this.value;
    const emitKey = (k: any) => {
      if (typeof k === 'string' || typeof k === 'number') {
        w.add(String(k), this);
      } else if (k instanceof Node) {
        k.toString(options);
      } else if (Array.isArray(k)) {
        w.add(k.map(k => String(k)).join(''));
      } else {
        w.add(String(k));
      }
    };
    if (target) {
      target.toString(options);
    }
    if (resolution === 'linear') {
      w.add('^');
    } else if (resolution === 'call-time') {
      w.add('~');
    }
    if (role === 'ident' && (type === 'variable' || type === 'property') && !target) {
      w.add('$[');
      emitKey(key);
      w.add(']');
      return w.getSince(mark);
    }
    switch (type) {
      case 'index':
        w.add('[');
        emitKey(key);
        w.add(']');
        break;
      case 'variable':
        if (target) {
          w.add('.$');
        } else {
          w.add('$');
        }
        emitKey(key);
        break;
      case 'declaration':
        w.add('.');
        emitKey(key);
        break;
      case 'property':
        w.add('.~');
        emitKey(key);
        break;
      case 'mixin':
        // If this mixin reference has a target (e.g. `ns.foo`), render it as a scoped lookup:
        // `ns > foo`. Without target, keep the legacy mixin marker form (`|foo`).
        w.add(target ? ' > ' : '|');
        emitKey(key);
        break;
      case 'ruleset':
        w.add('*(');
        emitKey(key);
        w.add(')');
        break;
      case 'mixin-ruleset':
        w.add('*');
        emitKey(key);
        break;
    }
    if (fallbackValue === true) {
      w.add('?');
    }
    return w.getSince(mark);
  }

  /**
   * We don't need to mark evaluated, because a reference
   * should never resolve to itself
   */
  override evalNode(context: Context): MaybePromise<Node> {
    let { target, key } = this.value;
    let { type, fallbackValue, filter: originalFilter } = this.options;
    // Track reference chain for clearing remainders at outermost level
    context.pushReference();
    // Prefer the *current* evaluation rules context (mixin call-time scope) over the lexical rulesParent.
    // This is critical for mixin parameters (e.g. `@fallback`) which are registered onto the call-time
    // wrapper `Rules` and should be visible inside nested at-rule preludes.
    let resolvedTarget = target ? target.eval(context) : context.rulesContext ?? this.rulesParent;
    const result = pipe(
      () => {
        if (isThenable(resolvedTarget)) {
          return (resolvedTarget as Promise<any>).then(result => result);
        }
        return resolvedTarget;
      },
      (resolvedTarget) => {
        let out: any;
        try {
          out = isNode(key) ? key.eval(context) : key;
        } catch (err: any) {
          throw err;
        }
        if (isThenable(out)) {
          return out.then((k: any) => {
            // If key is a Selector (CompoundSelector, ComplexSelector, etc.), extract keySet as array
            if (isNode(k, N.Selector)) {
              const keyArray = Array.from(k.keySet);
              return [resolvedTarget, keyArray] as [any, string[]];
            }
            // If k is already an array, preserve it
            if (Array.isArray(k)) {
              return [resolvedTarget, k] as [any, string[]];
            }
            return [resolvedTarget, k.valueOf()] as [any, string];
          });
        }
        // If key is a Selector (CompoundSelector, ComplexSelector, etc.), extract keySet as array
        if (isNode(out, N.Selector)) {
          const keyArray = Array.from(out.keySet);
          return [resolvedTarget, keyArray] as [any, string[]];
        }
        // If key is already an array, preserve it
        if (Array.isArray(out)) {
          return [resolvedTarget, out] as [any, string[]];
        }
        const normalizedKey = isNode(out) ? out.valueOf() : out;
        return [resolvedTarget, normalizedKey] as [any, string];
      },
      ([resolvedTarget, valueKey]) => {
        /**
         * If we don't have rules yet, assume that this node
         * was an ambiguous reference to a mixin (such as a valid color
         * or an interpolated identifier). In that case, try to resolve
         * it as a reference to a mixin.
         *
         * (We have to do this for Less.)
         */
        if (resolvedTarget instanceof Node) {
          if (!isNode(resolvedTarget, N.Rules | N.JsFunction | N.Mixin)) {
            let targetKey = isNode(resolvedTarget as Node, N.Color) ? String((resolvedTarget as Color).value.node) : (resolvedTarget as Node).valueOf();
            if (typeof targetKey === 'string') {
              let ref = new Reference(targetKey, { type: 'mixin-ruleset' });
              this.adopt(ref);
              return Promise.all([
                ref.eval(context),
                valueKey
              ]);
            }
          }
        }
        return [resolvedTarget, valueKey] as [any, string | string[]];
      },
      ([resolvedTarget, valueKey]) => {
        /**
         * If we're looking something up on a function, we presume
         * it needs to be called first, and that it has no arguments.
         */
        if (isNode(resolvedTarget, N.JsFunction)) {
          const jsResult = resolvedTarget.value.call(context);
          if (isThenable(jsResult)) {
            return (jsResult as Promise<any>).then((result) => {
              return [result, valueKey] as [any, string | string[]];
            });
          } else {
            resolvedTarget = jsResult;
            return [resolvedTarget, valueKey] as [any, string | string[]];
          }
        }

        /**
         * If we're looking something up on a mixin or ruleset (namespace lookup),
         * we need to evaluate its rules to get the Rules node first.
         *
         * Before evaluating, check if this Ruleset/Mixin has matched keys from a previous partial match
         * (for chained calls like .jo.ki() where .jo finds .jo.ki with matched keys [".jo"])
         * We accumulate the new key and use registry lookup to verify the compound match
         */
        if (isNode(resolvedTarget, N.Mixin | N.Ruleset)) {
          const mixinResult = (resolvedTarget as Ruleset).value.rules.eval(context);
          if (isThenable(mixinResult)) {
            return (mixinResult as Promise<Rules>).then((rules) => {
              rules.inherit((resolvedTarget as Ruleset).value.rules);
              return [rules, valueKey] as [Node, string | string[]];
            });
          } else {
            mixinResult.inherit((resolvedTarget as Ruleset).value.rules);
            resolvedTarget = mixinResult as Rules;
            return [resolvedTarget, valueKey] as [Node, string | string[]];
          }
        }

        return [resolvedTarget, valueKey] as [Node, string | string[]];
      },
      ([resolvedTarget, valueKey]) => {
        originalFilter ??= () => true;
        const isInterpolatedVariable =
          this.options.type === 'variable'
          && this.parent?.type === 'Interpolated';
        const isWithinParamVarScope = (paramParent: Node | undefined, activeRules: Node | undefined): boolean => {
          let cursor: Node | undefined = activeRules;
          while (cursor) {
            if (cursor === paramParent) {
              return true;
            }
            cursor = cursor.parent;
          }
          return false;
        };
        const filter = (n: Node) => {
          const passesOriginal = originalFilter!(n);
          const blockedParamVar = isNode(n, N.VarDeclaration)
            && Boolean(n.options?.paramVar)
            && !isWithinParamVarScope(n.parent, context.rulesContext);
          const blockedBySearchScope = context.searchScope.has(n);
          return passesOriginal && !blockedBySearchScope && !blockedParamVar;
        };
        const hasTarget = !!target;

        const performLookup = (targetRules: Rules | Node | undefined): any => {
          if (!targetRules) {
            return undefined;
          }
          const opts: FindOptions = { filter, context, hasTarget };
          if (!target && targetRules.options?.isMixinOutput === true) {
            opts.local = true;
          }

          if (this.options.resolution === 'linear' && !isInterpolatedVariable) {
            // For linear resolution, climb up the parent chain until we find a node with a Rules parent
            // and use that node's index for linear lookup
            let startIndex = this.index;
            let currentNode: Node | undefined = this;

            // If this node doesn't have an index, climb up until we find one
            if (startIndex === undefined) {
              while (currentNode && startIndex === undefined) {
                currentNode = currentNode.parent;
                if (currentNode) {
                  startIndex = currentNode.index;
                }
              }
            }

            // Now climb up until we find a node that has a Rules parent
            while (currentNode && currentNode.parent && !isNode(currentNode.parent, N.Rules)) {
              currentNode = currentNode.parent;
              if (currentNode && currentNode.index !== undefined) {
                startIndex = currentNode.index;
              }
            }

            if (startIndex !== undefined) {
              opts.start = startIndex;
            }
          } else if (this.options.resolution === 'call-time' && !isInterpolatedVariable) {
            // For call-time resolution, use the call site's position (context.callSiteIndex)
            // instead of the definition position. This allows mixins to resolve variables
            // at the time they're called, not when they're defined.
            if (context.rulesContext !== undefined) {
              opts.start = context.rulesContext.index;
            } else {
              // Fall back to linear resolution if we can't find a call site
              let startIndex = this.index;
              let currentNode: Node | undefined = this;

              if (startIndex === undefined) {
                while (currentNode && startIndex === undefined) {
                  currentNode = currentNode.parent;
                  if (currentNode) {
                    startIndex = currentNode.index;
                  }
                }
              }

              while (currentNode && currentNode.parent && !isNode(currentNode.parent, N.Rules)) {
                currentNode = currentNode.parent;
                if (currentNode && currentNode.index !== undefined) {
                  startIndex = currentNode.index;
                }
              }

              if (startIndex !== undefined) {
                opts.start = startIndex;
              }
            }
          }
          switch (type) {
            case 'index':
              if (typeof valueKey === 'number') {
                if (isNode(targetRules, N.Rules)) {
                  return targetRules.at(valueKey);
                } else if (isNode(targetRules, N.JsArray)) {
                  return atIndex((targetRules as any).value, valueKey);
                }
              } else {
                const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                if (isNode(targetRules, N.Rules)) {
                  return targetRules.find('declaration', `${keyStr}`, undefined, opts);
                } else if (isNode(targetRules, N.JsObject)) {
                  return (targetRules as any).value[keyStr];
                }
              }
              break;
            case 'variable':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
                const found = targetRules.find('declaration', `${keyStr}`, 'VarDeclaration', opts);
                if (found !== undefined) {
                  return found;
                }
                return undefined;
              }
              break;
            case 'function':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
                const inCall = isNode(this.parent, N.Call);
                // When called (e.g. `ns.func(...)`), prefer function lookup first, then fall back to a declaration.
                // When not called, parsers should generally use `index`/`variable` references for `ns.func` so
                // declarations win; but if we are here, keep behavior predictable.
                if (inCall) {
                  return (
                    targetRules.find('function', `${keyStr}`, undefined, opts)
                    ?? targetRules.find('declaration', `${keyStr}`, undefined, opts)
                  );
                }
                // Not in call: prefer declaration first, then function.
                return (
                  targetRules.find('declaration', `${keyStr}`, undefined, opts)
                  ?? targetRules.find('function', `${keyStr}`, undefined, opts)
                );
              }
              break;
            case 'property':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                const declaration = targetRules.find('declaration', `${keyStr}`, 'Declaration', opts);
                if (declaration !== undefined) {
                  return declaration;
                }
                return undefined;
              } else if (isNode(targetRules, N.JsObject)) {
                const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                return (targetRules as any).value[keyStr];
              }
              break;
            case 'mixin':
              if (isNode(targetRules, N.Rules)) {
                // valueKey can be string or string[] - find() accepts both
                const mixin = targetRules.find('mixin', valueKey, 'Mixin', opts);
                if (mixin) {
                  return mixin;
                }
                // Some Less built-ins are invoked in mixin-like call positions.
                // If a mixin lookup misses during a Call, allow function fallback.
                if (isNode(this.parent, N.Call)) {
                  const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                  return targetRules.find('function', `${keyStr}`, undefined, opts);
                }
                return undefined;
              }
              break;
            case 'ruleset':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
                return targetRules.find('mixin', `${keyStr}`, 'Ruleset', opts);
              }
              break;
            case 'mixin-ruleset':
              if (isNode(targetRules, N.Rules)) {
                const mixinOrRuleset = targetRules.find('mixin', valueKey, undefined, opts);
                if (mixinOrRuleset) {
                  return mixinOrRuleset;
                }
                if (isNode(this.parent, N.Call)) {
                  const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                  return targetRules.find('function', `${keyStr}`, undefined, opts);
                }
                return undefined;
              }
              break;
          }
          return undefined;
        };

        // Lookup is driven by the resolved target scope.
        // In mixin/at-rule nesting cases, `this.rulesParent` can point at a narrower scope (e.g. the
        // nested @media Rules) while the variable lives on an ancestor Rules (e.g. mixin param wrapper).
        let returnVal: any;
        if (isNode(resolvedTarget, N.Rules)) {
          returnVal = performLookup(resolvedTarget);

          // If leakyRules is true, try caller scope as a secondary pass (historical behavior).
          if (returnVal === undefined && context.leakyRules) {
            returnVal = performLookup(this.rulesParent);
            if (returnVal === undefined) {
              returnVal = performLookup(this.sourceRulesParent);
            }
          }
        }
        return { returnVal, valueKey };
      },
      ({ returnVal, valueKey }) => {
        const valueKeyStr2 = Array.isArray(valueKey) ? valueKey.join('') : String(valueKey);
        if (returnVal === undefined) {
          if (!fallbackValue) {
            if (
              (type === 'mixin' || type === 'mixin-ruleset')
              && isInsideSelectorCapture(this)
            ) {
              return new Any(valueKeyStr2, { role: 'ident' });
            }
            switch (type) {
              case 'mixin':
                throw new ReferenceError(`No matching mixins found for '${valueKeyStr2}'`);
              case 'ruleset':
                throw new ReferenceError(`No matching rulesets found for '${valueKeyStr2}'`);
              case 'mixin-ruleset':
                throw new ReferenceError(`No matching mixins found for '${valueKeyStr2}'`);
            }
            throw new ReferenceError(`'${valueKeyStr2}' is not defined`);
          }
          if (fallbackValue === true) {
            const any = new Any(`${valueKey}`);
            any.options.role = this.options.role;
            return any;
          }
          // Evaluate the fallbackValue if it's a Node
          let out = fallbackValue.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Node>).then(node => node);
          }
          return out;
        }
        if (isNode(returnVal, N.Declaration | N.VarDeclaration)) {
          context.searchScope.add(returnVal as Node);
          const hasImportant = isNode(returnVal, N.Declaration) && !!(returnVal as Declaration).value.important;
          const declValue = (returnVal as Declaration).value.value;
          // Mixin references (e.g. @foo: .a) are not resolved at lookup time; they are
          // resolved only when called (@foo();) or used as target of a lookup (@foo[prop]).
          const isMixinRef = isNode(declValue, N.Reference) && declValue.options?.type === 'mixin-ruleset';
          return pipe(
            () => {
              // Track that this value came from an important declaration
              // We push here but DON'T pop - let the consuming Declaration pop it
              if (hasImportant) {
                context.pushImportantSource();
              }
              declValue.frozen = true;
              if (isMixinRef) {
                return declValue;
              }
              return declValue.eval(context);
            },
            (evald) => {
              context.searchScope.delete(returnVal as Node);
              // DON'T pop important source here - let the consuming Declaration pop it
              // after it has checked and merged the important flag
              let out = evald.copy(true, freezeChildren).inherit(evald);
              out.frozen = true;
              out.pre = this.pre;
              out.post = this.post;
              out.sourceParent = this;
              return out;
            }
          );
        } else if (isArray(returnVal)) {
          // Only pass Mixins and Rulesets to getFunctionFromMixins
          for (let item of returnVal) {
            item.sourceParent = this;
            if (!isNode(item, N.Mixin | N.Ruleset)) {
              return cast(undefined);
            }
          }
          const func = getFunctionFromMixins(returnVal as MixinEntry[]);
          return cast(func);
        }
        const result = cast(returnVal);
        // Pop reference and clear remainders if we're at the outermost level
        context.popReference();
        result.sourceParent = this;
        return result;
      }
    );
    if (isThenable(result)) {
      return (result as Promise<Node>).then(
        res => res,
        (err) => {
          throw err;
        }
      );
    }
    return result as Node;
  }
}

export const ref = defineType(Reference, 'Reference', 'ref');