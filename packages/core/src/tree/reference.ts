import { CANONICAL, defineType, Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, type OptionalLocation } from './node.js';
import type { Context, TreeContext } from '../context.js';
import { cast } from './util/cast.js';
import type { FindOptions } from './util/registry-utils.js';
import { Any, type AnyRole, Keyword } from './any.js';
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
import type { Mixin } from './mixin.js';
import type { Declaration } from './declaration.js';
import type { Color } from './color.js';
import type { VarDeclaration } from './declaration-var.js';
import {
  isTopLevelVarDeclaration,
  getDependency,
  getField,
  getParent,
  getSourceParent,
  setSourceParent,
  setDependency
} from './util/field-helpers.js';
import { getParentEdge } from './util/cursor.js';

/**
 * The type is determined by syntax
 * and location.
 *   e.g. in Jess
 *    - `$foo` refers to a variable
 *    - `$.foo` or `$target.foo` is a named member lookup (variable or property)
 *    - `$[foo]` or `$target[foo]` is a braced variable reference
 *    - `$['foo']` or `$target['foo']` is a braced property reference
 *    - `$[$var]` is a variable member name lookup
 *    - `$foo[0]` is an index lookup
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

/**
 * Extract mixin reference keys from a selector in document order,
 * skipping combinators. For `#theme > .mixin`, returns `["#theme", ".mixin"]`.
 *
 * Must preserve the original selector child order (not bitset order)
 * so that MixinRegistry lookup uses the correct startKey.
 */
function getSelectorReferenceKeys(selector: Selector): string[] {
  const value = (selector as any).value;
  if (isArray(value)) {
    const keys: string[] = [];
    for (const child of value) {
      if (isNode(child, N.Combinator)) {
        continue;
      }
      if (isNode(child, N.Selector)) {
        keys.push(...getSelectorReferenceKeys(child as Selector));
      } else {
        const val = String(child.valueOf());
        if (val) {
          keys.push(val);
        }
      }
    }
    return keys;
  }
  const val = String(selector.valueOf());
  return val ? [val] : [];
}

function isInsideSelectorCapture(node: Node | undefined, context?: Context): boolean {
  let cursor: Node | undefined = node;
  while (cursor) {
    if (cursor.type === 'SelectorCapture') {
      return true;
    }
    cursor = context ? getLookupParentNode(cursor, context) : cursor.parent;
  }
  return false;
}

function getLookupParentNode(node: Node, context: Context): Node | undefined {
  const renderKey = context.renderKey ?? context.rulesContext?.renderKey;
  if (renderKey !== undefined && renderKey !== CANONICAL) {
    return getParentEdge({ node, renderKey })?.node ?? node.parent;
  }
  return getParent(node, context);
}

function getStateRulesParent(node: Node, context: Context): Rules | undefined {
  let possibleRules: Node | undefined = getLookupParentNode(node, context);
  while (possibleRules && possibleRules.type !== 'Rules') {
    possibleRules = getLookupParentNode(possibleRules, context);
  }
  return possibleRules as Rules | undefined;
}

function getStateSourceRulesParent(node: Node, context: Context): Rules | undefined {
  let current: Node | undefined = node;
  let sourceParent = getSourceParent(node, context);
  while (current && !sourceParent) {
    current = getLookupParentNode(current, context);
    sourceParent = current ? getSourceParent(current, context) : undefined;
  }
  return sourceParent ? getStateRulesParent(sourceParent, context) : undefined;
}

export type ReferenceChildData = {
  target: Reference | Call | undefined;
  key: ReferenceValue['key'];
};

/**
 * This is a variable or property reference,
 * which can itself contain a reference (a variable variable).
 */
export interface Reference {
  type: 'Reference';
  shortType: 'ref';
}
export class Reference extends Node<ReferenceValue, ReferenceOptions, ReferenceChildData> {
  static override childKeys = ['target', 'key'] as const;

  target: Reference | Call | undefined;
  key!: ReferenceValue['key'];

  constructor(value: ReferenceValue | string, options?: ReferenceOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    if (typeof value === 'string') {
      value = { key: value };
    }
    super(value as any, options, location, treeContext);
    this.target = value.target;
    this.key = value.key;
    if (this.target instanceof Node) {
      this.adopt(this.target);
    }
    if (this.key instanceof Node) {
      this.adopt(this.key);
    }
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
    const context = options.context;
    const target = this.get('target', context);
    const key = this.get('key', context);
    const emitKey = (k: any) => {
      if (typeof k === 'string' || typeof k === 'number') {
        w.add(String(k), this);
      } else if (k instanceof Node) {
        k.toString(options);
      } else if (isArray(k)) {
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
    /**
     * Reference serialization forms:
     *   1. `$[key]` — braced variable reference (or `$target[key]` with a target)
     *   2. `$['key']` — braced property reference (or `$target['key']` with a target)
     *   3. `$.key` or `$target.key` — dot syntax for named member lookup (variable or property)
     *   4. `$[$var]` — variable member name lookup (key is itself a reference)
     *   5. `$[0]` — index (or `$target[0]` with a target)
     *   6. `$[-1]` — negative index
     */
    if (role === 'ident' && (type === 'variable' || type === 'property') && !target) {
      w.add('$[');
      emitKey(key);
      w.add(']');
      return w.getSince(mark);
    }
    switch (type) {
      case 'index':
        if (!target) {
          w.add('$');
        }
        w.add('[');
        emitKey(key);
        w.add(']');
        break;
      case 'variable':
        if (target) {
          // Braced variable: $target[key]
          w.add('[');
          emitKey(key);
          w.add(']');
        } else {
          w.add('$');
          emitKey(key);
        }
        break;
      case 'declaration':
        // Dot syntax for named member lookup: $.key or $target.key
        if (!target) {
          w.add('$');
        }
        w.add('.');
        emitKey(key);
        break;
      case 'property':
        // Braced property: $['key'] or $target['key']
        if (!target) {
          w.add('$');
        }
        w.add('[\'');
        emitKey(key);
        w.add('\']');
        break;
      case 'mixin':
        // If this mixin reference has a target (e.g. `ns.foo`), render it as a scoped lookup:
        // `ns > foo`. Without target, keep the legacy mixin marker form (`|foo`).
        w.add(target ? ' > ' : '|');
        emitKey(key);
        break;

      /** @todo - remove? This should be a selector capture node I think */
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
    let target = this.get('target', context);
    let key = this.get('key', context);
    let { type, fallbackValue, filter: originalFilter } = this.options;
    // Track reference chain for clearing remainders at outermost level
    context.pushReference();
    // Prefer the *current* evaluation rules context (mixin call-time scope) over the lexical rulesParent.
    // This is critical for mixin parameters (e.g. `@fallback`) which are registered onto the call-time
    // wrapper `Rules` and should be visible inside nested at-rule preludes.
    const activeRulesParent = getStateRulesParent(this, context);
    const activeSourceRulesParent = getStateSourceRulesParent(this, context);
    let resolvedTarget = target ? target.eval(context) : context.rulesContext ?? activeRulesParent;
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
              const keyArray = getSelectorReferenceKeys(k as Selector);
              return [resolvedTarget, keyArray] as [any, string[]];
            }
            // If k is already an array, preserve it
            if (isArray(k)) {
              return [resolvedTarget, k] as [any, string[]];
            }
            return [resolvedTarget, k.valueOf()] as [any, string];
          });
        }
        // If key is a Selector (CompoundSelector, ComplexSelector, etc.), extract keySet as array
        if (isNode(out, N.Selector)) {
          const keyArray = getSelectorReferenceKeys(out as Selector);
          return [resolvedTarget, keyArray] as [any, string[]];
        }
        // If key is already an array, preserve it
        if (isArray(out)) {
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
          if (!isNode(resolvedTarget, N.Rules | N.Ruleset | N.JsFunction | N.Mixin)) {
            let targetKey = isNode(resolvedTarget as Node, N.Color) ? String((resolvedTarget as Color)._nodeValue) : (resolvedTarget as Node).valueOf();
            if (typeof targetKey === 'string') {
              let ref = new Reference(targetKey, { type: 'mixin-ruleset' });
              this.adopt(ref, context);
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
          const jsResult = ((resolvedTarget as any).value as (...args: any[]) => any).call(context);
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
          const targetRules = isNode(resolvedTarget, N.Ruleset)
            ? (resolvedTarget as Ruleset).enterRules(context)
            : (resolvedTarget as Mixin)
                .get('rules', context)
                .withRenderOwner(
                  resolvedTarget as Node,
                  (resolvedTarget as Node).renderKey ?? context.renderKey,
                  context
                );
          return [targetRules, valueKey] as [Node, string | string[]];
        }

        return [resolvedTarget, valueKey] as [Node, string | string[]];
      },
      ([resolvedTarget, valueKey]) => {
        originalFilter ??= () => true;
        const isInterpolatedVariable =
          this.options.type === 'variable'
          && getLookupParentNode(this, context)?.type === 'Interpolated';
        /**
         * @removal-target — node-copy-reduction: paramVar filtering
         * With per-call EvalState isolation, mixin param vars live as
         * field patches on the call's position and are naturally scoped
         * by the position-aware parent chain. This walk-up check becomes
         * redundant once per-call positions are fully wired.
         */
        const isWithinParamVarScope = (paramParent: Node | undefined, activeRules: Node | undefined): boolean => {
          let cursor: Node | undefined = activeRules;
          while (cursor) {
            if (cursor === paramParent) {
              return true;
            }
            cursor = getLookupParentNode(cursor, context);
          }
          return false;
        };
        const filter = (n: Node) => {
          const passesOriginal = originalFilter!(n);
          /** @removal-target — see isWithinParamVarScope above */
          const blockedParamVar = isNode(n, N.VarDeclaration)
            && Boolean(n.options?.paramVar)
            && !isWithinParamVarScope(getLookupParentNode(n, context), context.rulesContext);
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
                currentNode = getLookupParentNode(currentNode, context);
                if (currentNode) {
                  startIndex = currentNode.index;
                }
              }
            }

            // Now climb up until we find a node that has a Rules parent
            while (currentNode) {
              const currentParent = getLookupParentNode(currentNode, context);
              if (!currentParent || isNode(currentParent, N.Rules)) {
                break;
              }
              currentNode = currentParent;
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
                  currentNode = getLookupParentNode(currentNode, context);
                  if (currentNode) {
                    startIndex = currentNode.index;
                  }
                }
              }

              while (currentNode) {
                const currentParent = getLookupParentNode(currentNode, context);
                if (!currentParent || isNode(currentParent, N.Rules)) {
                  break;
                }
                currentNode = currentParent;
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
                const keyStr = isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                if (isNode(targetRules, N.Rules)) {
                  // If the key was a Keyword, look up as a variable first
                  if (key instanceof Keyword) {
                    const found = targetRules.find('declaration', `${keyStr}`, 'VarDeclaration', opts);
                    if (found !== undefined) {
                      return found;
                    }
                  }
                  // If the key was a Quoted, look up as a property
                  if (isNode(key, N.Quoted)) { // property lookup
                    const found = targetRules.find('declaration', `${keyStr}`, 'Declaration', opts);
                    if (found !== undefined) {
                      return found;
                    }
                  }
                  return targetRules.find('declaration', `${keyStr}`, undefined, opts);
                } else if (isNode(targetRules, N.JsObject)) {
                  return (targetRules as any).value[keyStr];
                }
              }
              break;
            case 'variable':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = isArray(valueKey) ? valueKey[0] : valueKey;
                const found = targetRules.find('declaration', `${keyStr}`, 'VarDeclaration', opts);
                if (found !== undefined) {
                  return found;
                }
                return undefined;
              }
              break;
            case 'function':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = isArray(valueKey) ? valueKey[0] : valueKey;
                const inCall = isNode(getLookupParentNode(this, context), N.Call);
                const findFunction = () =>
                  targetRules.find('function', `${keyStr}`, undefined, opts)
                  ?? targetRules.findStatePatchedFunction(`${keyStr}`, opts);
                // When called (e.g. `ns.func(...)`), prefer function lookup first, then fall back to a declaration.
                // When not called, parsers should generally use `index`/`variable` references for `ns.func` so
                // declarations win; but if we are here, keep behavior predictable.
                if (inCall) {
                  return (
                    findFunction()
                    ?? targetRules.find('declaration', `${keyStr}`, undefined, opts)
                  );
                }
                // Not in call: prefer declaration first, then function.
                return (
                  targetRules.find('declaration', `${keyStr}`, undefined, opts)
                  ?? findFunction()
                );
              }
              break;
            case 'property':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                const declaration = targetRules.find('declaration', `${keyStr}`, 'Declaration', opts);
                if (declaration !== undefined) {
                  return declaration;
                }
                return undefined;
              } else if (isNode(targetRules, N.JsObject)) {
                const keyStr = isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
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
                if (isNode(getLookupParentNode(this, context), N.Call)) {
                  const keyStr = isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                  return targetRules.find('function', `${keyStr}`, undefined, opts);
                }
                return undefined;
              }
              break;
            case 'ruleset':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = isArray(valueKey) ? valueKey[0] : valueKey;
                return targetRules.find('mixin', `${keyStr}`, 'Ruleset', opts);
              }
              break;
            case 'mixin-ruleset':
              if (isNode(targetRules, N.Rules)) {
                const mixinOrRuleset = targetRules.find('mixin', valueKey, undefined, opts);
                if (mixinOrRuleset) {
                  return mixinOrRuleset;
                }
                if (isNode(getLookupParentNode(this, context), N.Call)) {
                  const keyStr = isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
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
        const lookupTarget = isNode(resolvedTarget, N.Ruleset)
          ? (resolvedTarget as Ruleset).enterRules(context)
          : resolvedTarget;
        let returnVal: any;
        if (isNode(lookupTarget, N.Rules)) {
          returnVal = performLookup(lookupTarget);

          if (
            returnVal === undefined
            && context.lookupScope
            && context.lookupScope !== lookupTarget
          ) {
            returnVal = performLookup(context.lookupScope);
          }

          // If leakyRules is true, try caller scope as a secondary pass (historical behavior).
          if (returnVal === undefined && context.leakyRules) {
            returnVal = performLookup(activeRulesParent);
            if (returnVal === undefined) {
              returnVal = performLookup(activeSourceRulesParent);
            }
          }
        }
        return { returnVal, valueKey };
      },
      ({ returnVal, valueKey }) => {
        const valueKeyStr2 = isArray(valueKey) ? valueKey.join('') : String(valueKey);
        if (returnVal === undefined) {
          if (!fallbackValue) {
            if (
              (type === 'mixin' || type === 'mixin-ruleset')
              && isInsideSelectorCapture(this, context)
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
            const any = new Any(`${valueKey}`, { role: this.options.role });
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
          const hasImportant = isNode(returnVal, N.Declaration) && !!(returnVal as Declaration).get('important');
          const declValue = (returnVal as Declaration).get('value', context);
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
              let out = evald;
              out.pre = this.pre;
              out.post = this.post;
              setSourceParent(out, this, context);
              const dependency = isTopLevelVarDeclaration(returnVal as Node, context)
                ? {
                    dependsOn: new Set<VarDeclaration>([returnVal as VarDeclaration]),
                    sourceExpr: this as Node
                  }
                : getDependency(evald, context);
              if (dependency?.dependsOn && dependency.dependsOn.size > 0) {
                setDependency(out, {
                  dependsOn: new Set(dependency.dependsOn),
                  sourceExpr: dependency.sourceExpr ?? this
                }, context);
              }
              return out;
            }
          );
        } else if (isArray(returnVal)) {
          // When a mixin-ruleset reference is used as the target of another
          // Reference (e.g. #theme -> .dark -> .navbar), preserve the resolved
          // scope entry instead of eagerly converting it into a callable mixin.
          if (type === 'mixin-ruleset' && !isNode(getLookupParentNode(this, context), N.Call) && context.referenceStack > 1) {
            const first = returnVal[0] as Node | undefined;
            if (first && isNode(first, N.Mixin | N.Ruleset)) {
              setSourceParent(first as Node, this, context);
              context.popReference();
              return cast(first);
            }
            context.popReference();
            return cast(undefined);
          }

          // Only pass Mixins and Rulesets to getFunctionFromMixins
          for (let item of returnVal) {
            setSourceParent(item, this, context);
            if (!isNode(item, N.Mixin | N.Ruleset)) {
              context.popReference();
              return cast(undefined);
            }
          }
          // When the parent is a Call and lookup resolved to a single mixin/ruleset
          // candidate, return the entry directly so Call.evalNode keeps the
          // candidate placement/renderKey instead of routing through the older
          // JsFunction wrapper path.
          if (
            returnVal.length === 1
            && (type === 'mixin' || type === 'mixin-ruleset')
            && isNode(getLookupParentNode(this, context), N.Call)
          ) {
            context.popReference();
            return returnVal[0] as Node;
          }
          // Multi-match, namespace, or non-Call consumer: use legacy function wrapper.
          const func = getFunctionFromMixins(returnVal as MixinEntry[]);
          context.popReference();
          return cast(func);
        }
        const result = cast(returnVal);
        // Pop reference and clear remainders if we're at the outermost level
        context.popReference();
        setSourceParent(result, this, context);
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
