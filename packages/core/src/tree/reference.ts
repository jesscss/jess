import { defineType, Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, type LocationInfo } from './node';
import type { Context, TreeContext } from '../context';
import { cast } from './util/cast';
import type { FindOptions } from './util/registry-utils';
import { Any, type AnyRole } from './any';
import { Selector } from './selector';
import { isNode } from './util/is-node';
import type { Call } from './call';
import type { Quoted } from './quoted';
import { atIndex } from './util/collections';
import type { Num } from './number';
import { type PrintOptions, getPrintOptions } from './util/print';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import { getFunctionFromMixins } from './rules';
import type { MixinEntry, Rules } from './rules';
import type { Interpolated } from './interpolated';

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

type NodeType = typeof Node<ReferenceValue, ReferenceOptions>;
type ReferenceParams = ConstructorParameters<NodeType>;

const { isArray } = Array;

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
    let { type = 'variable', resolution, fallbackValue } = this.options;
    let { target, key } = this.value;
    const emitKey = (k: any) => {
      if (typeof k === 'string' || typeof k === 'number') {
        w.add(String(k), this);
      } else if (k instanceof Node) {
        k.toString(options);
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
    switch (type) {
      case 'index':
        w.add('[');
        emitKey(key);
        w.add(']');
        break;
      case 'variable':
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
        w.add('|');
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
    // Check if this Reference is being evaluated while we're in a mixin evaluation context
    // (i.e., while evaluating a mixin's rules, we encounter a Reference that would call back)
    if (context.isEvaluatingReferenceInContext(this)) {
      // Recursion detected - this call is being evaluated again in the same mixin context
      // Throw an error that can be caught to exclude this match
      throw new ReferenceError(`Recursive mixin call detected`);
    }
    // Mark this Reference as being evaluated in the current mixin context (if we're in one)
    context.startEvaluatingReferenceInContext(this);
    let { target, key } = this.value;
    let { type, fallbackValue, filter: originalFilter } = this.options;
    // Track reference chain for clearing remainders at outermost level
    context.pushReference();
    let resolvedTarget = target ? target.eval(context) : this.rulesParent ?? context.rulesContext;
    const result = pipe(
      () => {
        if (isThenable(resolvedTarget)) {
          return (resolvedTarget as Promise<any>).then(result => result);
        }
        return resolvedTarget;
      },
      (resolvedTarget) => {
        let out = isNode(key) ? key.eval(context) : key;
        if (isThenable(out)) {
          return out.then((k) => {
            // If key is a Selector (CompoundSelector, ComplexSelector, etc.), extract keySet as array
            if (isNode(k, 'Selector')) {
              const keyArray = Array.from(k.keySet);
              return [resolvedTarget, keyArray] as [any, string[]];
            }
            return [resolvedTarget, k.valueOf()] as [any, string];
          });
        }
        // If key is a Selector (CompoundSelector, ComplexSelector, etc.), extract keySet as array
        if (isNode(out, 'Selector')) {
          const keyArray = Array.from(out.keySet);
          return [resolvedTarget, keyArray] as [any, string[]];
        }
        return [resolvedTarget, out] as [any, string];
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
          let type = resolvedTarget.type;
          if (type !== 'Rules' && type !== 'JsFunction' && type !== 'Mixin') {
            let targetKey = isNode(resolvedTarget, 'Color') ? String(resolvedTarget.value.node) : resolvedTarget.valueOf();
            if (typeof targetKey === 'string') {
              let ref = new Reference(targetKey, { type: 'mixin-ruleset' });
              ref.parent = this;
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
        if (isNode(resolvedTarget, 'JsFunction')) {
          const jsResult = resolvedTarget.value.call(context);
          if (isThenable(jsResult)) {
            return (jsResult as Promise<any>).then((result) => {
              return [result, valueKey] as [any, string];
            });
          } else {
            resolvedTarget = jsResult;
            return [resolvedTarget, valueKey] as [any, string];
          }
        }
        // if (typeof resolvedTarget === 'function') {
        //   return Promise.all([
        //     resolvedTarget.call(context),
        //     valueKey
        //   ]);
        // }

        /**
         * If we're looking something up on a mixin or ruleset (namespace lookup),
         * we need to evaluate its rules to get the Rules node first.
         *
         * Before evaluating, check if this Ruleset/Mixin has matched keys from a previous partial match
         * (for chained calls like .jo.ki() where .jo finds .jo.ki with matched keys [".jo"])
         * We accumulate the new key and use registry lookup to verify the compound match
         */
        if (isNode(resolvedTarget, ['Mixin', 'Ruleset'])) {
          // Check if this Ruleset/Mixin has matched keys from a previous partial match
          const matchedKeys = context.partialMatchKeys.get(resolvedTarget);
          if (matchedKeys && matchedKeys.length > 0) {
            // Accumulate the new key (valueKey can be string or string[])
            const valueKeyArray = Array.isArray(valueKey) ? valueKey : [valueKey];
            const accumulatedKeys = [...matchedKeys, ...valueKeyArray];
            // Use the registry's utility method to directly check if the Ruleset matches the accumulated keys
            // We need to find the Rules node that contains this Ruleset to access its registry
            const parentRules = resolvedTarget.parent;
            if (isNode(parentRules, 'Rules')) {
              const mixinRegistry = parentRules.getRegistry('mixin');
              // Directly check if the Ruleset matches the accumulated keys using registry matching logic
              const matches = mixinRegistry.checkRulesetMatchesKeys(resolvedTarget as any, accumulatedKeys);
              if (matches) {
                // Update the matched keys
                context.partialMatchKeys.set(resolvedTarget, accumulatedKeys);
                // Return the Ruleset/Mixin itself for the chained call
                return [resolvedTarget, valueKey] as [Node, string];
              }
              // If it didn't match, remove from partialMatchKeys and continue with normal evaluation
              context.partialMatchKeys.delete(resolvedTarget);
            }
          }

          const mixinResult = resolvedTarget.value.rules.eval(context);
          if (isThenable(mixinResult)) {
            return (mixinResult as Promise<Rules>).then((rules) => {
              rules.inherit(resolvedTarget.value.rules);
              return [rules, valueKey] as [Node, string];
            });
          } else {
            mixinResult.inherit(resolvedTarget.value.rules);
            resolvedTarget = mixinResult as Rules;
            return [resolvedTarget, valueKey] as [Node, string];
          }
        }

        return [resolvedTarget, valueKey] as [Node, string | string[]];
      },
      ([resolvedTarget, valueKey]) => {
        originalFilter ??= () => true;
        const filter = (n: Node) => originalFilter!(n) && !context.searchScope.has(n);
        const opts: FindOptions = { filter, context };

        if (this.options.resolution === 'linear') {
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
          while (currentNode && currentNode.parent && !isNode(currentNode.parent, 'Rules')) {
            currentNode = currentNode.parent;
            if (currentNode && currentNode.index !== undefined) {
              startIndex = currentNode.index;
            }
          }

          if (startIndex !== undefined) {
            opts.start = startIndex;
          }
        } else if (this.options.resolution === 'call-time') {
          // For call-time resolution, use the call site's position (context.callSiteIndex)
          // instead of the definition position. This allows mixins to resolve variables
          // at the time they're called, not when they're defined.
          if (context.callSiteIndex !== undefined) {
            opts.start = context.callSiteIndex;
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

            while (currentNode && currentNode.parent && !isNode(currentNode.parent, 'Rules')) {
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
        let returnVal: any;

        switch (type) {
          case 'index':
            if (typeof valueKey === 'number') {
              if (isNode(resolvedTarget, 'Rules')) {
                returnVal = resolvedTarget.at(valueKey);
              } else if (isNode(resolvedTarget, 'JsArray')) {
                returnVal = atIndex(resolvedTarget.value, valueKey);
              }
            } else {
              const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
              if (isNode(resolvedTarget, 'Rules')) {
                returnVal = resolvedTarget.find('declaration', `${keyStr}`, undefined, opts);
              } else if (isNode(resolvedTarget, 'JsObject')) {
                returnVal = resolvedTarget.value[keyStr];
              }
            }
            break;
          case 'variable':
            if (isNode(resolvedTarget, 'Rules')) {
              const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
              returnVal = resolvedTarget.find('declaration', `${keyStr}`, 'VarDeclaration', opts);
            }
            break;
          case 'function':
            if (isNode(resolvedTarget, 'Rules')) {
              const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
              returnVal = resolvedTarget.find('function', `${keyStr}`, undefined, opts);
            }
            break;
          case 'property':
            if (isNode(resolvedTarget, 'Rules')) {
              const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
              returnVal = resolvedTarget.find('declaration', `${keyStr}`, 'Declaration', opts);
            } else if (isNode(resolvedTarget, 'JsObject')) {
              const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
              returnVal = resolvedTarget.value[keyStr];
            }
            break;
          case 'mixin':
            if (isNode(resolvedTarget, 'Rules')) {
              const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
              returnVal = resolvedTarget.find('mixin', `${keyStr}`, 'Mixin', opts);
            }
            break;
          case 'ruleset':
            if (isNode(resolvedTarget, 'Rules')) {
              const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
              returnVal = resolvedTarget.find('mixin', `${keyStr}`, 'Ruleset', opts);
            }
            break;
          case 'mixin-ruleset':
            if (isNode(resolvedTarget, 'Rules')) {
              // valueKey can be string or string[] - find() accepts both
              returnVal = resolvedTarget.find('mixin', valueKey, undefined, opts);
            }
            break;
        }
        return { returnVal, valueKey };
      },
      ({ returnVal, valueKey }) => {
        if (returnVal === undefined) {
          if (!fallbackValue) {
            throw new ReferenceError(`"${key}" is not defined`);
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
        if (isNode(returnVal, ['Declaration', 'VarDeclaration'])) {
          context.searchScope.add(returnVal);
          const inCalc = context.calcFrames.at(-1);
          if (inCalc) {
            context.calcFrames.pop();
          }
          return pipe(
            () => {
              return returnVal.value.value.eval(context);
            },
            (evald) => {
              if (inCalc) {
                context.calcFrames.push(true);
              }
              context.searchScope.delete(returnVal);
              return evald.copy(true, true);
            }
          );
        } else if (isArray(returnVal)) {
          // Only pass Mixins and Rulesets to getFunctionFromMixins
          const allMixins = returnVal.every(item => isNode(item, ['Mixin', 'Ruleset']));
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/1edfe575-2050-4a93-8751-72368827c42e', {
            method: 'POST',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              location: 'reference.ts:464',
              message: 'Reference.evalNode: checking returnVal array',
              data: {
                isArray: isArray(returnVal),
                arrayLength: isArray(returnVal) ? returnVal.length : 0,
                allMixins,
                itemTypes: isArray(returnVal) ? returnVal.map((item: any) => item?.type ?? typeof item) : []
              },
              timestamp: Date.now(),
              sessionId: 'debug-session',
              runId: 'run1',
              hypothesisId: 'C'
            })
          }).catch(() => {});
          // #endregion
          if (allMixins) {
            const func = getFunctionFromMixins(returnVal as MixinEntry[]);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/1edfe575-2050-4a93-8751-72368827c42e', {
              method: 'POST',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                location: 'reference.ts:467',
                message: 'Reference.evalNode: calling getFunctionFromMixins',
                data: {
                  funcType: typeof func,
                  isFunction: typeof func === 'function'
                },
                timestamp: Date.now(),
                sessionId: 'debug-session',
                runId: 'run1',
                hypothesisId: 'C'
              })
            }).catch(() => {});
            // #endregion
            return cast(func);
          }
        }
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1edfe575-2050-4a93-8751-72368827c42e', {
          method: 'POST',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: 'reference.ts:471',
            message: 'Reference.evalNode: final returnVal',
            data: {
              returnValType: returnVal?.type ?? typeof returnVal,
              isArray: isArray(returnVal),
              isRules: returnVal?.type === 'Rules',
              isMixin: returnVal?.type === 'Mixin',
              isRuleset: returnVal?.type === 'Ruleset'
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'C'
          })
        }).catch(() => {});
        // #endregion
        const result = cast(returnVal);
        // Pop reference and clear remainders if we're at the outermost level
        context.popReference();
        return result;
      }
    );
    // Handle both sync and async results to ensure cleanup
    if (isThenable(result)) {
      return result.then(
        (res) => {
          // context.stopEvaluatingReference(this);
          return res;
        },
        (err) => {
          // context.stopEvaluatingReference(this);
          throw err;
        }
      );
    } else {
      // context.stopEvaluatingReference(this);
      return result;
    }
  }
}

export const ref = defineType(Reference, 'Reference', 'ref');