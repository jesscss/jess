import {
  Node
} from './node'
import { type Interpolated } from './interpolated'
import type { Anonymous } from './anonymous'

export type Name = Interpolated | Anonymous | string

export type BaseDeclarationValue<N extends Name = Name> = {
  name?: N
}

export const enum AssignmentType {
  Default = ':',
  Add = '+:',           // similar to += in JS, but merges lists / sequences / collections
  Subtract = '-:',      // math subtraction, like -= in JS
  Multiply = '*:',      // math multiplication, like *= in JS
  Divide = '/:',        // math division, like /= in JS
  CondAssign = '?:',    // similar to ??= in JS or !default in Sass
  CondAdd = '?+:',      // add if defined, otherwise assign
  CondSubtract = '?-:', // subtract if defined, otherwise assign
  CondMultiply = '?*:', // multiply if defined, otherwise assign
  CondDivide = '?/:',   // divide if defined, otherwise assign
  /** Legacy Less flags */
  MergeList = '+,:',    // merge into a list if another prop exists with this flag
  MergeSequence = '+_:' // merge into a sequence if another prop exists with this flag
}

export type BaseDeclarationOptions = {
  assign?: AssignmentType
  /**
   * Instead of implicitly declaring or overriding,
   * requires a variable to previously be explicitly
   * declared within scope.
   *
   * Used by SCSS (!global) and Jess's (@set)
   */
  setDefined?: boolean

  /** Defined in a mixin definition */
  paramVar?: boolean

  /** Used by SCSS (!default) and Jess (?:) */
  // setIfUndefined?: boolean
  /**
   * Throw if already defined in the immediate scope
   * Will not throw if defined in a parent scope.
   *
   * Used by Jess (@let) and SCSS in the case of mixins
   */
  throwIfDefined?: boolean
}

/**
 * A base class with a name / value pair
 */
export abstract class BaseDeclaration<
  N extends Name = Name,
  T extends BaseDeclarationValue = BaseDeclarationValue<N>,
  O extends BaseDeclarationOptions = BaseDeclarationOptions,
> extends Node<T, O> {
  get name(): Name | undefined {
    return this.data.get('name')
  }

  set name(v: Name | undefined) {
    this.data.set('name', v)
  }
}