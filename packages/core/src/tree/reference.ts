import { defineType, Node, type LocationInfo } from './node';
import type { Context, TreeContext } from '../context';
import { cast } from './util/cast';
import type { FindOptions } from './util/registry-utils';
import { General } from './general';
import { Selector } from './selector';
import { isNode } from './util/is-node';
import type { Call } from './call';
import type { Quoted } from './quoted';
import { atIndex } from './util/collections';
import type { Num } from './number';

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
    | General
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
  type?: 'index' | 'declaration' | 'variable' | 'property' | 'mixin' | 'ruleset' | 'mixin-ruleset';
  resolution?: 'scope' | 'linear';
  /**
   * Optional references just resolve to the string
   * representation if the fallback value is set to true.
   *
   * @note - Used by Less for function references
   */
  fallbackValue?: Node | true;
  filter?: (node: Node) => boolean;
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
  override toTrimmedString(): string {
    let { type = 'variable', resolution, fallbackValue } = this.options;
    let { target, key } = this.value;
    if (resolution === 'linear') {
      key = `^${key}`;
    }
    if (fallbackValue === true) {
      key = `${key}?`;
    }
    switch (type) {
      case 'index':
        key = `[${key}]`;
        break;
      case 'variable':
        key = `${key}`;
        break;
      case 'declaration':
        key = `.${key}`;
        break;
      case 'property':
        key = `.~${key}`;
        break;
      case 'mixin':
        key = `|${key}`;
        break;
      case 'ruleset':
        key = `*(${key})`;
        break;
      case 'mixin-ruleset':
        key = `*${key}`;
        break;
    }
    return `${target ? target.toTrimmedString() : ''}${key}`;
  }

  /**
   * We don't need to mark evaluated, because a reference
   * should never resolve to itself
   */
  override async evalNode(context: Context): Promise<Node> {
    let { target, key } = this.value;
    let { type, fallbackValue, filter: originalFilter } = this.options;
    let valueKey: string | number;
    if (isNode(key)) {
      let evald = await key.eval(context);
      valueKey = evald.valueOf();
    } else {
      valueKey = key;
    }
    let resolvedTarget = target ? await target.eval(context) : context.rulesContext;
    originalFilter ??= () => true;
    let filter = (n: Node) =>
      originalFilter(n) && !context.searchScope.has(n);
    let opts: FindOptions = { filter };

    let returnVal: any;
    switch (type) {
      case 'index':
        if (typeof valueKey === 'number') {
          /** Look for array-like nodes */
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

    if (returnVal === undefined) {
      if (!fallbackValue) {
        throw new ReferenceError(`"${key}" is not defined`);
      }
      if (fallbackValue === true) {
        return new General(`${valueKey}`, { type: 'Name' });
      }
      return fallbackValue;
    }
    if (isNode(returnVal, 'Declaration')) {
      context.searchScope.add(returnVal);
      const evald = await returnVal.value.value.eval(context);
      context.searchScope.delete(returnVal);
      return evald;
    } else {
      return cast(returnVal);
    }
  }
}

export const ref = defineType(Reference, 'Reference', 'ref');