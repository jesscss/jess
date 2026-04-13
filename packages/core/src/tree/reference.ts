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
import { MixinCollection } from './rules.js';
import type { MixinEntry, Rules, RuntimeVarBinding } from './rules.js';
import type { Mixin } from './mixin.js';
import type { Interpolated } from './interpolated.js';
import { freezeChildren } from './util/cloning.js';
import type { Ruleset } from './ruleset.js';
import type { Declaration } from './declaration.js';
import type { Color } from './color.js';
import { List } from './list.js';
import { Nil } from './nil.js';
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
  rawKey?:
    string
    | string[]
    | Node
    | Any
    | number
    | Num
    | Quoted
    | Selector
    | Reference
    | Interpolated;
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
  type?: 'index' | 'declaration' | 'property' | 'variable' | 'function' | 'mixin' | 'ruleset' | 'mixin-ruleset';
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

const isRuntimeVarBinding = (value: unknown): value is RuntimeVarBinding => (
  value !== null
  && typeof value === 'object'
  && 'kind' in value
  && value.kind === 'runtime-var-binding'
);

/**
 * Fast parent-chain walk for ordinary VarDeclaration lookup.
 *
 * Bypasses the full declaration-registry machinery (Set creation, indexPendingItems,
 * Set→Array conversion, sort, _searchRulesChildren) for the dominant hot case:
 * lexical variables looked up from nested scopes.
 *
 * Invariant: `varsByName === undefined` means the scope has not yet been indexed
 * by `_indexRules`. `varsByName` is initialized to an empty Map at the start of
 * `_indexRules` so that "indexed with no vars" is distinguishable from "not indexed".
 *
 * When `varsByName` is undefined the fast path bails immediately (returns undefined),
 * causing the caller to fall back to the full declaration registry which will trigger
 * indexing and warm up `varsByName` for all visited scopes. Subsequent lookups then
 * use the fast path for the entire chain.
 *
 * Rules: last entry in varsByName wins (Less "last definition wins" semantics).
 * Only valid when ignoreCurrentScopeStart + ignoreParentScopeStart are both true
 * (which is exactly what reference.ts sets for type === 'variable').
 */
function findVarDeclarationFast(
  startRules: Rules,
  name: string,
  filter: (n: Node) => boolean
): Node | undefined {
  let cursor: Node | undefined = startRules;
  let first = true;
  while (cursor) {
    if (isNode(cursor, N.Rules)) {
      const scope = cursor as Rules;
      if (!first) {
        // Stop at non-classic-import boundaries (same as DeclarationRegistry.find)
        const sn = scope.sourceNode;
        if (sn?.type === 'StyleImport' && sn.options.type !== 'import') {
          break;
        }
      }
      first = false;
      if (!scope.varsByName) {
        // Scope not yet indexed — bail so the full registry path runs and warms it up
        return undefined;
      }
      const candidates = scope.varsByName.get(name);
      if (candidates) {
        for (let i = candidates.length - 1; i >= 0; i--) {
          const candidate = candidates[i]!;
          if (filter(candidate)) {
            return candidate;
          }
        }
      }
      // No match at this scope; continue up the chain
    }
    cursor = cursor.parent ?? cursor.sourceParent;
  }
  return undefined;
}
/**
 * Fast parent-chain walk for static-named Mixin lookup.
 *
 * Mirrors findVarDeclarationFast: only covers Mixin nodes whose name was
 * indexed into mixinsByName (non-interpolated Any name). Ruleset-as-mixin
 * and interpolated-name mixins still go through the full MixinRegistry.
 *
 * Returns an array of Mixin candidates (all matching entries across scopes)
 * or undefined if any scope in the chain is not yet indexed (triggering
 * full-registry fallback which warms it up).
 */
function findMixinFast(
  startRules: Rules,
  key: string
): Mixin[] | undefined {
  const results: Mixin[] = [];
  let cursor: Node | undefined = startRules;
  let first = true;
  while (cursor) {
    if (isNode(cursor, N.Rules)) {
      const scope = cursor as Rules;
      if (!first) {
        const sn = scope.sourceNode;
        if (sn?.type === 'StyleImport' && sn.options.type !== 'import') {
          break;
        }
      }
      first = false;
      if (!scope.mixinsByName) {
        // Scope not yet indexed — bail so full registry warms it up
        return undefined;
      }
      const candidates = scope.mixinsByName.get(key);
      if (candidates) {
        for (let i = candidates.length - 1; i >= 0; i--) {
          results.push(candidates[i]!);
        }
      }
    }
    cursor = cursor.parent ?? cursor.sourceParent;
  }
  return results;
}

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

function normalizeSelectorReferenceKey(selector: Selector): string | string[] {
  if (isNode(selector, N.BasicSelector) || selector.type === 'InterpolatedSelector') {
    return selector.valueOf();
  }

  if (isNode(selector, N.CompoundSelector)) {
    return (selector.value as Node[]).map(node => String(node.valueOf()));
  }

  if (isNode(selector, N.ComplexSelector)) {
    const path: string[] = [];

    for (const node of selector.value as Node[]) {
      if (isNode(node, N.BasicSelector) || node.type === 'InterpolatedSelector') {
        path.push(String(node.valueOf()));
        continue;
      }
      if (isNode(node, N.CompoundSelector)) {
        path.push(...(node.value as Node[]).map(child => String(child.valueOf())));
        continue;
      }
      if (isNode(node, N.Combinator) && (node.value === '>' || node.value === ' ')) {
        continue;
      }
      return selector.valueOf();
    }

    if (path.length > 0) {
      return path;
    }
  }

  return selector.valueOf();
}

function getLookupStartIndex(node: Node): number | undefined {
  let startIndex = node.index;
  let currentNode: Node | undefined = node;

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

  return startIndex;
}

/**
 * This is a variable or property reference,
 * which can itself contain a reference (a variable variable).
 */
export class Reference extends Node<ReferenceValue, ReferenceOptions> {
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
   * @note - A reference renders a $ only if it has no target.
   */
  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { type = 'variable', resolution, fallbackValue } = this.options;
    let { target, key, rawKey } = this.value;
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
    const printableKey = rawKey ?? key;
    if (target) {
      target.toString(options);
    } else {
      w.add('$');
    }
    if (resolution === 'linear') {
      w.add('^');
    } else if (resolution === 'call-time') {
      w.add('~');
    }
    switch (type) {
      case 'index':
        w.add('[');
        emitKey(printableKey);
        w.add(']');
        break;
      case 'variable':
        if (target) {
          w.add('.$');
        }
        emitKey(printableKey);
        break;
      case 'declaration':
        w.add('.');
        emitKey(printableKey);
        break;
      case 'property':
        if (target) {
          w.add('[');
          emitKey(printableKey);
          w.add(']');
        } else {
          w.add('.');
          emitKey(printableKey);
        }
        break;
      case 'mixin':
        w.add(' > ');
        emitKey(printableKey);
        break;
      case 'ruleset':
        w.add(' > *[');
        emitKey(printableKey);
        w.add(']');
        break;
      case 'mixin-ruleset':
        w.add(' > *');
        emitKey(printableKey);
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
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
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
            if (isNode(k, N.Selector)) {
              return [resolvedTarget, normalizeSelectorReferenceKey(k)] as [any, string | string[]];
            }
            if (Array.isArray(k)) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              return [resolvedTarget, k] as [any, string[]];
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            return [resolvedTarget, k.valueOf()] as [any, string];
          });
        }
        if (isNode(out, N.Selector)) {
          return [resolvedTarget, normalizeSelectorReferenceKey(out)] as [any, string | string[]];
        }
        if (Array.isArray(out)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          return [resolvedTarget, out] as [any, string[]];
        }
        const normalizedKey = isNode(out) ? out.valueOf() : out;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
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
          if (!(resolvedTarget instanceof MixinCollection) && !isNode(resolvedTarget, N.Rules | N.JsFunction | N.Mixin)) {
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
        if (resolvedTarget instanceof MixinCollection) {
          return resolvedTarget.evalCall(context).then((r: any) => {
            return [r, valueKey] as [any, string | string[]];
          });
        }
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
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const mixinResult = (resolvedTarget as Ruleset).value.rules.eval(context);
          if (isThenable(mixinResult)) {
            return (mixinResult as Promise<Rules>).then((rules) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              rules.inherit((resolvedTarget as Ruleset).value.rules);
              return [rules, valueKey] as [Node, string | string[]];
            });
          } else {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            mixinResult.inherit((resolvedTarget as Ruleset).value.rules);
            resolvedTarget = mixinResult as Rules;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            return [resolvedTarget, valueKey] as [Node, string | string[]];
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return [resolvedTarget, valueKey] as [Node, string | string[]];
      },
      ([resolvedTarget, valueKey]) => {
        originalFilter ??= () => true;
        const isInterpolatedVariable =
          this.options.type === 'variable'
          && this.parent?.type === 'Interpolated';
        const isWithinParamVarScope = (paramParent: Node | undefined, activeRules: Node | undefined): boolean => {
          const sourceParamParent = paramParent?.sourceNode as Node | undefined;
          let cursor: Node | undefined = activeRules;
          while (cursor) {
            const sourceCursor = cursor.sourceNode as Node | undefined;
            if (
              cursor === paramParent
              || cursor === sourceParamParent
              || sourceCursor === paramParent
              || (sourceCursor && sourceParamParent && sourceCursor === sourceParamParent)
            ) {
              return true;
            }
            cursor = cursor.parent ?? cursor.sourceParent;
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
          const opts: FindOptions = { filter, context, hasTarget, renderKey: context.renderKey };
          if (!target && targetRules.options?.isMixinOutput === true) {
            opts.local = true;
          }

          if (
            !target
            && !isInterpolatedVariable
            && this.options.resolution === 'linear'
          ) {
            const startIndex = getLookupStartIndex(this);
            if (startIndex !== undefined) {
              opts.start = startIndex;
            }
          } else if (
            !target
            && !isInterpolatedVariable
            && (
              type === 'variable'
              || type === 'property'
              || type === 'declaration'
            )
          ) {
            const startIndex = getLookupStartIndex(this);
            if (startIndex !== undefined) {
              opts.start = startIndex;
              opts.ignoreCurrentScopeStart = true;
              opts.ignoreParentScopeStart = true;
            }
          } else if (this.options.resolution === 'call-time' && !isInterpolatedVariable) {
            // For call-time resolution, use the call site's position (context.callSiteIndex)
            // instead of the definition position. This allows mixins to resolve variables
            // at the time they're called, not when they're defined.
            if (context.rulesContext !== undefined) {
              opts.start = context.rulesContext.index;
            } else {
              // Fall back to linear resolution if we can't find a call site
              const startIndex = getLookupStartIndex(this);
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
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  return atIndex((targetRules as any).value, valueKey);
                }
              } else {
                const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                if (isNode(targetRules, N.Rules)) {
                  const indexFilterType = isNode(this.value.key, N.Quoted) ? 'Declaration' as const : 'VarDeclaration' as const;
                  return targetRules.find('declaration', `${keyStr}`, indexFilterType, opts);
                } else if (isNode(targetRules, N.JsObject)) {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  return (targetRules as any).value[keyStr];
                }
              }
              break;
            case 'property':
            case 'variable':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
                if (type === 'variable') {
                  // Slice 9: check frame live slots (mixin params) before the full
                  // runtimeVarBindings chain walk.  Only liveSlotsByName is consulted
                  // here — declarationBucketsByName uses the call-site parent chain
                  // which does NOT match Less definition-site semantics for lexical
                  // vars; those still go through findVarDeclarationFast / full registry.
                  {
                    let f = targetRules.scopeFrame;
                    while (f) {
                      const live = f.liveSlotsByName.get(`${keyStr}`);
                      if (live) {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                        const src = live.sourceNode as Node | undefined;
                        if (!src || !context.searchScope.has(src)) {
                          return {
                            kind: 'runtime-var-binding' as const,
                            value: live.value,
                            readonly: live.readonly,
                            sourceNode: src
                          } satisfies RuntimeVarBinding;
                        }
                      }
                      f = f.parent;
                    }
                  }
                  // Fallback: runtimeVarBindings chain walk (covers scopes not yet
                  // reachable via the frame chain, e.g. nested @media wrappers).
                  const runtimeBinding = targetRules.findRuntimeVarBinding(`${keyStr}`);
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  if (runtimeBinding && !context.searchScope.has(runtimeBinding.sourceNode as Node)) {
                    return runtimeBinding;
                  }
                  // Fast path: walk varsByName maps directly, skipping declaration-registry
                  // machinery. Uses the same .parent ?? .sourceParent traversal as
                  // findRuntimeVarBinding, which is proven correct under active renderKeys.
                  // Guard: only valid when position is fully ignored (ignoreParentScopeStart).
                  // Positional lookups (resolution: 'linear') must use the full registry path.
                  if (opts.ignoreParentScopeStart) {
                    const fast = findVarDeclarationFast(targetRules, `${keyStr}`, filter);
                    if (fast !== undefined) {
                      return fast;
                    }
                  }
                }
                const declarationType = type === 'property' ? 'Declaration' : 'VarDeclaration';
                const found = targetRules.find('declaration', `${keyStr}`, declarationType, opts);
                if (found !== undefined) {
                  return found;
                }
                return undefined;
              }
              break;
            case 'declaration':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
                const found = targetRules.find('declaration', `${keyStr}`, undefined, opts);
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
            /** @todo - Remove? */
            case 'ruleset':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
                return targetRules.find('mixin', `${keyStr}`, 'Ruleset', opts);
              }
              break;
            case 'mixin-ruleset':
              if (isNode(targetRules, N.Rules)) {
                // Fast path: single static string key → check mixinsByName before full registry.
                // Only covers Mixin nodes (not Ruleset-as-mixin); falls through for:
                //   - array keys (compound/namespace paths like .a > .b)
                //   - interpolated names (not in mixinsByName at all)
                //   - any scope not yet indexed (mixinsByName === undefined)
                if (typeof valueKey === 'string') {
                  const fast = findMixinFast(targetRules, valueKey);
                  if (fast !== undefined) {
                    // fast is an array; if non-empty, return it (same shape as full registry result).
                    // If empty, fall through — there may be Ruleset-as-mixin candidates in the registry.
                    if (fast.length > 0) {
                      return fast;
                    }
                    // Empty fast result + all scopes indexed: no static Mixin candidates.
                    // Still fall through to full registry in case Rulesets match.
                  }
                }
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
        if (isRuntimeVarBinding(returnVal)) {
          const bindingSource = returnVal.sourceNode;
          if (bindingSource) {
            context.searchScope.add(bindingSource);
          }
          return pipe(
            () => {
              returnVal.value.frozen = true;
              return returnVal.value.eval(context);
            },
            (evald) => {
              if (bindingSource) {
                context.searchScope.delete(bindingSource);
              }
              const out = evald.copy(true, freezeChildren).inherit(evald);
              out.frozen = true;
              out.pre = this.pre;
              out.post = this.post;
              out.sourceParent = this;
              return out;
            }
          );
        }
        if (isNode(returnVal, N.Declaration | N.VarDeclaration)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          context.searchScope.add(returnVal as Node);
          const hasImportant = isNode(returnVal, N.Declaration) && !!(returnVal as Declaration).value.important;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const declValue = (returnVal as Declaration).value.value;
          const normalizedAssign = isNode(returnVal, N.Declaration)
            ? returnVal.options?.normalizedFromAssign
            : undefined;
          const isMergedAssign = normalizedAssign === '+:' || normalizedAssign === '&,:' || normalizedAssign === '&_:';
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
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              context.searchScope.delete(returnVal as Node);
              // DON'T pop important source here - let the consuming Declaration pop it
              // after it has checked and merged the important flag
              let out = evald.copy(true, freezeChildren).inherit(evald);
              if (isMergedAssign && isNode(out, N.List)) {
                const mergedItems: Node[] = [];
                const collect = (child: Node): void => {
                  if (isNode(child, N.List)) {
                    for (const item of child.value) {
                      collect(item as Node);
                    }
                    return;
                  }
                  const isEmptyPlaceholder = (
                    isNode(child, N.Nil)
                    || String(child.valueOf?.() ?? '') === ''
                  );
                  if (!isEmptyPlaceholder) {
                    mergedItems.push(child.copy(true, freezeChildren));
                  }
                };
                collect(out);
                if (mergedItems.length === 0) {
                  out = new Nil();
                } else if (mergedItems.length === 1) {
                  out = mergedItems[0]!;
                } else {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  out = new List(mergedItems) as unknown as typeof out;
                }
              }
              out.frozen = true;
              out.pre = this.pre;
              out.post = this.post;
              out.sourceParent = this;
              return out;
            }
          );
        } else if (isArray(returnVal)) {
          for (let item of returnVal) {
            item.sourceParent = this;
            if (!isNode(item, N.Mixin | N.Ruleset)) {
              return cast(undefined);
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          return new MixinCollection(returnVal as MixinEntry[]);
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
