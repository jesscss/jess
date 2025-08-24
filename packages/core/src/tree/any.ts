import { Node, defineType, type LocationInfo, type NodeOptions, F_STATIC, F_VISIBLE } from './node';
import type { Context, TreeContext } from '../context';

export type AnyRole =
  'ident'
  | 'name'
  | 'charset'
  | 'keyword'
  | 'property'
  | 'atkeyword'
  | 'urlvalue'
  | 'flag'
  | 'customprop'
  | 'semi'
  | 'any';

/** Doesn't get assigned but can be used for inference? */
export type AnyOptions<T extends string> = NodeOptions & {
  role?: T;
};

export interface Any<
  Role extends AnyRole = AnyRole
> extends Node<string, AnyOptions<Role>> {
  eval(context: Context): Any<Role>;
  valueOf(): string;
}

/**
 * Any is a simple token that has a string value and a role.
 * Sometimes that role is unspecified. Think of it as a generic,
 * and a placeholder for tokens that don't have anything special
 * to do during evaluation.
 *
 * Called "Anonymous" in Less's original tree, but "anonymous"
 * was somewhat a counter-intuitive name.
 */
export class Any<
  Role extends AnyRole = AnyRole
> extends Node<string, AnyOptions<Role>> {
  type: AnyRole = 'any';
  shortType = 'any';
  override state = F_VISIBLE | F_STATIC;
  // Any values are static and don't need evaluation
}
export const any = defineType(Any, 'Any', 'any');

/** Legacy class - remove? */
export class Anonymous<
  Role extends AnyRole = AnyRole
> extends Any<Role> {}
defineType(Anonymous, 'Anonymous');