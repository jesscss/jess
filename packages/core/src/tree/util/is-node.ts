import type { Ampersand } from '../ampersand'
import type { General } from '../general'
import type { AtRule } from '../at-rule'
import type { Call } from '../call'
import type { Declaration } from '../declaration'
import type { Dimension } from '../dimension'
import type { BasicSelector } from '../selector-basic'
import type { List } from '../list'
import type { Mixin } from '../mixin'
import type { Func } from '../function'
import type { FunctionValue } from '../function-value'
import { Node } from '../node'
import type { Ruleset } from '../ruleset'
import type { Rules } from '../rules'
import type { ComplexSelector } from '../selector-complex'
import type { CompoundSelector } from '../selector-compound'
import type { Import } from '../import'
import type { Nil } from '../nil'
import type { SelectorList } from '../selector-list'
import type { Collection } from '../collection'
import type { VarDeclaration } from '../var-declaration'
import type { Rest } from '../rest'
import type { SimpleSelector } from '../selector-simple'
import type { PseudoSelector } from '../selector-pseudo'
import type { Combinator } from '../combinator'
import type { Nodes } from '../tree'

const { isArray } = Array
/**
 * This utility function prevents circular dependencies,
 * in case we need to. It examines the `type` property
 * to determine equality and do type narrowing in TS.
 *
 * @todo - Is there a way to use mapped types for this?
 */
export function isNode(value: any, type: 'Ampersand'): value is Ampersand
export function isNode(value: any, type: 'General'): value is General
export function isNode(value: any, type: 'AtRule'): value is AtRule
export function isNode(value: any, type: 'Call'): value is Call
export function isNode(value: any, type: 'Declaration'): value is Declaration
export function isNode(value: any, type: 'VarDeclaration'): value is VarDeclaration
export function isNode(value: any, type: ['Declaration', 'VarDeclaration', 'Mixin', 'Func']): value is Declaration | VarDeclaration | Mixin | Func
export function isNode(value: any, type: 'Dimension'): value is Dimension
export function isNode(value: any, type: 'BasicSelector'): value is BasicSelector
export function isNode(value: any, type: 'SimpleSelector'): value is SimpleSelector
export function isNode(value: any, type: 'PseudoSelector'): value is PseudoSelector
export function isNode(value: any, type: 'ComplexSelector'): value is ComplexSelector
export function isNode(value: any, type: 'CompoundSelector'): value is CompoundSelector
export function isNode(value: any, type: 'SelectorList'): value is SelectorList
export function isNode(value: any, type: ['ComplexSelector', 'SelectorList']): value is ComplexSelector | SelectorList
export function isNode(value: any, type: 'Combinator'): value is Combinator
export function isNode(value: any, type: 'List'): value is List
export function isNode(value: any, type: 'Mixin'): value is Mixin
export function isNode(value: any, type: 'Func'): value is Func
export function isNode(value: any, type: 'FunctionValue'): value is FunctionValue
export function isNode(value: any, type: ['Mixin', 'Func']): value is Mixin | Func
export function isNode(value: any, type: ['Mixin', 'Ruleset']): value is Mixin | Ruleset
export function isNode(value: any, type: 'Ruleset'): value is Ruleset
export function isNode(value: any, type: 'Rules'): value is Rules
export function isNode(value: any, type: 'AtRule'): value is AtRule
export function isNode(value: any, type: ['Ruleset', 'AtRule']): value is Ruleset | AtRule
export function isNode(value: any, type: 'Import'): value is Import
export function isNode(value: any, type: 'Nil'): value is Nil
export function isNode(value: any, type: 'Collection'): value is Collection
export function isNode(value: any, type: 'Rest'): value is Rest
export function isNode(value: any, type: ['VarDeclaration', 'Rest']): value is Rest | VarDeclaration
export function isNode(value: any, type?: keyof Nodes | ReadonlyArray<keyof Nodes>): value is Node
export function isNode(value: any, type?: keyof Nodes | ReadonlyArray<keyof Nodes>): value is Node {
  if (!value || !(value instanceof Node)) {
    return false
  }
  if (!type) {
    return true
  }
  if (isArray(type)) {
    return type.some(t => value.types.has(t))
  }
  return value.types?.has(type as keyof Nodes)
}
