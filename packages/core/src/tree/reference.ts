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
    | string[]
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
    switch (type) {
      case 'index':
        w.add('[');
        emitKey(key);
        w.add(']');
        break;
      case 'variable':
        if (target) {
          w.add('.$');
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
        let out: any;
        try {
          out = isNode(key) ? key.eval(context) : key;
        } catch (err: any) {
          throw err;
        }
        if (isThenable(out)) {
          return out.then((k: any) => {
            // If key is a Selector (CompoundSelector, ComplexSelector, etc.), extract keySet as array
            if (isNode(k, 'Selector')) {
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
        if (isNode(out, 'Selector')) {
          const keyArray = Array.from(out.keySet);
          return [resolvedTarget, keyArray] as [any, string[]];
        }
        // If key is already an array, preserve it
        if (Array.isArray(out)) {
          return [resolvedTarget, out] as [any, string[]];
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
        if (isNode(resolvedTarget, 'JsFunction')) {
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
          const mixinResult = resolvedTarget.value.rules.eval(context);
          if (isThenable(mixinResult)) {
            return (mixinResult as Promise<Rules>).then((rules) => {
              rules.inherit(resolvedTarget.value.rules);
              return [rules, valueKey] as [Node, string | string[]];
            });
          } else {
            mixinResult.inherit(resolvedTarget.value.rules);
            resolvedTarget = mixinResult as Rules;
            return [resolvedTarget, valueKey] as [Node, string | string[]];
          }
        }

        return [resolvedTarget, valueKey] as [Node, string | string[]];
      },
      ([resolvedTarget, valueKey]) => {
        originalFilter ??= () => true;
        const filter = (n: Node) => originalFilter!(n) && !context.searchScope.has(n);
        // If this Reference has a target, mark hasTarget=true so 'targeted' Rules are searchable
        const hasTarget = !!target;
        const opts: FindOptions = { filter, context, hasTarget };

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
              // valueKey can be string or string[] - find() accepts both
              returnVal = resolvedTarget.find('mixin', valueKey, 'Mixin', opts);
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
              // When we have nested References (e.g., #theme.dark.navbar.colors()),
              // each Reference resolves to a Rules, and we search in that Rules.
              // We don't need accumulated path search because nested References
              // already handle the search correctly by resolving each step.
              // The accumulated path search was meant for compound selectors parsed
              // as a single Reference (like in mixinOrQualifiedRule), but mixinReference
              // always parses as nested References, so we can skip it here.
              // valueKey can be string or string[] - find() accepts both
              returnVal = resolvedTarget.find('mixin', valueKey, undefined, opts);
            }
            break;
        }
        return { returnVal, valueKey };
      },
      ({ returnVal, valueKey }) => {
        if (returnVal === undefined) {
          const valueKeyStr2 = Array.isArray(valueKey) ? valueKey.join('') : String(valueKey);
          const keyStr = isNode(key) ? key.valueOf() : String(key);
          if (!fallbackValue) {
            switch (type) {
              case 'mixin':
                throw new ReferenceError(`No matching mixins found for '${valueKeyStr2}'`);
              case 'ruleset':
                throw new ReferenceError(`No matching rulesets found for '${valueKeyStr2}'`);
              case 'mixin-ruleset':
                throw new ReferenceError(`No matching mixins found for '${valueKeyStr2}'`);
            }
            throw new ReferenceError(`'${keyStr}' is not defined`);
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
          const inCalc = context.calcFrames !== 0;
          const hasImportant = isNode(returnVal, 'Declaration') && !!returnVal.value.important;
          return pipe(
            () => {
              // Track that this value came from an important declaration
              // We push here but DON'T pop - let the consuming Declaration pop it
              if (hasImportant) {
                context.pushImportantSource();
              }
              const declValue = returnVal.value.value;
              return declValue.eval(context);
            },
            (evald) => {
              context.searchScope.delete(returnVal);
              // DON'T pop important source here - let the consuming Declaration pop it
              // after it has checked and merged the important flag
              let out = evald.copy(true, true);
              out.pre = this.pre;
              out.post = this.post;
              return out;
            }
          );
        } else if (isArray(returnVal)) {
          // Only pass Mixins and Rulesets to getFunctionFromMixins
          const allMixins = returnVal.every(item => isNode(item, ['Mixin', 'Ruleset']));
          if (allMixins) {
            const func = getFunctionFromMixins(returnVal as MixinEntry[]);
            return cast(func);
          }
        }
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