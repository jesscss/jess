import { defineType, Node, type LocationInfo } from './node';
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
    | Reference; // $.key
};

export type ReferenceOptions = {
  /**
   * What kind of lookup are we doing?
   */
  type?: 'index' | 'declaration' | 'variable' | 'property' | 'function' | 'mixin' | 'ruleset' | 'mixin-ruleset';
  resolution?: 'scope' | 'linear';
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
      if (typeof k === 'string' || typeof k === 'number') w.add(String(k), this);
      else if (k instanceof Node) k.toString(options);
      else w.add(String(k));
    };
    if (target) target.toString(options);
    if (resolution === 'linear') {
      w.add('^');
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
    let { target, key } = this.value;
    let { type, fallbackValue, filter: originalFilter } = this.options;
    return pipe(
      () => {
        const keyEval = isNode(key) ? key.eval(context) : key;
        return keyEval;
      },
      (keyEval) => {
        let valueKey = isNode(keyEval) ? keyEval.valueOf() : keyEval;
        let resolvedTarget = target ? target.eval(context) : context.rulesContext;
        if (isThenable(resolvedTarget)) {
          return Promise.all([resolvedTarget, valueKey]);
        }
        return [resolvedTarget, valueKey] as [Node, string];
      },
      ([resolvedTarget, valueKey]) => {
        originalFilter ??= () => true;
        const filter = (n: Node) => originalFilter!(n) && !context.searchScope.has(n);
        const opts: FindOptions = { filter };
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
              if (isNode(resolvedTarget, 'Rules')) {
                returnVal = resolvedTarget.find('declaration', `${valueKey}`, undefined, opts);
              } else if (isNode(resolvedTarget, 'JsObject')) {
                returnVal = resolvedTarget.value[valueKey];
              }
            }
            break;
          case 'variable':
            if (isNode(resolvedTarget, 'Rules')) {
              returnVal = resolvedTarget.find('declaration', `${valueKey}`, 'VarDeclaration', opts);
            }
            break;
          case 'function':
            if (isNode(resolvedTarget, 'Rules')) {
              returnVal = resolvedTarget.find('function', `${valueKey}`, undefined, opts);
            }
            break;
          case 'property':
            if (isNode(resolvedTarget, 'Rules')) {
              returnVal = resolvedTarget.find('declaration', `${valueKey}`, 'Declaration', opts);
            } else if (isNode(resolvedTarget, 'JsObject')) {
              returnVal = resolvedTarget.value[valueKey];
            }
            break;
          case 'mixin':
            if (isNode(resolvedTarget, 'Rules')) {
              returnVal = resolvedTarget.find('mixin', `${valueKey}`, 'Mixin', opts);
            }
            break;
          case 'ruleset':
            if (isNode(resolvedTarget, 'Rules')) {
              returnVal = resolvedTarget.find('mixin', `${valueKey}`, 'Ruleset', opts);
            }
            break;
          case 'mixin-ruleset':
            if (isNode(resolvedTarget, 'Rules')) {
              returnVal = resolvedTarget.find('mixin', `${valueKey}`, undefined, opts);
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
          return fallbackValue as Node;
        }
        if (isNode(returnVal, 'VarDeclaration')) {
          context.searchScope.add(returnVal);
          const inCalc = context.calcFrames.at(-1);
          if (inCalc) {
            context.calcFrames.pop();
          }
          return pipe(
            () => returnVal.value.value.eval(context),
            (evald) => {
              if (inCalc) {
                context.calcFrames.push(true);
              }
              context.searchScope.delete(returnVal);
              return evald;
            }
          );
        }
        if (isNode(returnVal, 'Declaration')) {
          context.searchScope.add(returnVal);
          const inCalc = context.calcFrames.at(-1);
          if (inCalc) {
            context.calcFrames.pop();
          }
          return pipe(
            () => returnVal.value.value.eval(context),
            (evald) => {
              if (inCalc) {
                context.calcFrames.push(true);
              }
              context.searchScope.delete(returnVal);
              return evald;
            }
          );
        }
        return cast(returnVal);
      }
    );
  }
}

export const ref = defineType(Reference, 'Reference', 'ref');