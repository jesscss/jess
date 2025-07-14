import { Node, defineType } from './node';
import type { Context } from '../context';

export type GeneralNodeType =
  'Name'
  | 'Keyword'
  | 'UrlValue'
  | 'Flag'
  | 'CustomProp'
  | 'CustomIdent'
  | 'Anonymous';

/** Doesn't get assigned but can be used for inference? */
export type GeneralOptions<T extends string> = {
  type: T;
};
export interface General<
  T extends string = GeneralNodeType
> extends Node<string, GeneralOptions<T>> {
  eval(context: Context): Promise<General<T>>;
}

/**
 * Any general value is a simple token that doesn't need to do much.
 * It holds a string, but can have pre/post nodes
 */
export class General<
  T extends string = GeneralNodeType
> extends Node<string, GeneralOptions<T>> {
  type = 'General';
  shortType = 'general';
}

export class Name extends General<'Name'> {}
defineType(Name, 'Name');

export class Keyword extends General<'Keyword'> {}
defineType(Keyword, 'Keyword');

export class UrlValue extends General<'UrlValue'> {}
defineType(UrlValue, 'UrlValue');

export class Flag extends General<'Flag'> {}
defineType(Flag, 'Flag');

export class CustomProp extends General<'CustomProp'> {}
defineType(CustomProp, 'CustomProp');

export class CustomIdent extends General<'CustomIdent'> {}
defineType(CustomIdent, 'CustomIdent');

/**
 * "Anonymous" is from Less's original definition to mean
 * an unspecified token.
 */
export class Anonymous extends General<'Anonymous'> {}
export const any = defineType(Anonymous, 'Anonymous', 'any');