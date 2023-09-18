import type { Ampersand } from '../ampersand'
import type { Anonymous } from '../anonymous'
import type { AtRule } from '../at-rule'
import type { Call } from '../call'
import type { Declaration } from '../declaration'
import type { Dimension } from '../dimension'
import type { BasicSelector } from '../selector-basic'
import type { List } from '../list'
import type { Mixin } from '../mixin'
import type { FunctionDefinition } from '../function-definition'
import { Node } from '../node'
import type { Rule } from '../rule'
import type { SelectorSequence } from '../selector-sequence'
import type { Use } from '../use'
import type { Nil } from '../nil'
import type { SelectorList } from '../selector-list'
import type { Collection } from '../collection'

/**
 * This utility function prevents circular dependencies,
 * in case we need to. It examines the `type` property
 * to determine equality and do type narrowing in TS.
 *
 * @todo - Is there a way to use mapped types for this?
 */
export function isNode(value: any, type: 'Ampersand'): value is Ampersand
export function isNode(value: any, type: 'Anonymous'): value is Anonymous
export function isNode(value: any, type: 'AtRule'): value is AtRule
export function isNode(value: any, type: 'Call'): value is Call
export function isNode(value: any, type: 'Declaration'): value is Declaration
export function isNode(value: any, type: 'Dimension'): value is Dimension
export function isNode(value: any, type: 'BasicSelector'): value is BasicSelector
export function isNode(value: any, type: 'List'): value is List
export function isNode(value: any, type: 'Mixin'): value is Mixin
export function isNode(value: any, type: 'FunctionDefinition'): value is FunctionDefinition
export function isNode(value: any, type: ['Mixin', 'FunctionDefinition']): value is Mixin | FunctionDefinition
export function isNode(value: any, type: 'SelectorSequence'): value is SelectorSequence
export function isNode(value: any, type: 'SelectorList'): value is SelectorList
export function isNode(value: any, type: 'Rule'): value is Rule
export function isNode(value: any, type: 'AtRule'): value is AtRule
export function isNode(value: any, type: ['Rule', 'AtRule']): value is Rule | AtRule
export function isNode(value: any, type: 'Use'): value is Use
export function isNode(value: any, type: 'Nil'): value is Nil
export function isNode(value: any, type: 'Collection'): value is Collection
export function isNode(value: any, type?: string | string[]): value is Node
export function isNode(value: any, type?: string | string[]): value is Node {
  if (!(value ?? false)) {
    return false
  }
  if (!type) {
    return value instanceof Node
  } else {
    return value instanceof Node &&
      (Array.isArray(type) ? type.includes(value.type) : value.type === type)
  }
}