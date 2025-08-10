import { Node, defineType, type LocationInfo } from './node';
import type { Context, TreeContext } from '../context';

export type GeneralNodeType =
  'Ident'
  | 'AtKeyword'
  | 'UrlValue'
  | 'Flag'
  | 'CustomProp'
  | 'Anonymous';

/** Doesn't get assigned but can be used for inference? */
export type GeneralOptions<T extends string> = {
  type?: T;
};
export interface General<
  T extends string = GeneralNodeType
> extends Node<string, GeneralOptions<T>> {
  eval(context: Context): Promise<General<T>>;
  valueOf(): string;
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

type GeneralConstructor<T extends string, Role = undefined> = new (
  value: string,
  options?: GeneralOptions<T> & (Role extends string ? { role?: Role } : {}),
  loc?: LocationInfo,
  context?: TreeContext
) => General<T>;

/**
 * Create a new General class with a given type.
 * We do this just to make a friendlier AST.
 */
function createGeneral<T extends string, Role = undefined>(type: T, short?: string): GeneralConstructor<T, Role> {
  type Options = GeneralOptions<T> & (Role extends string ? { role?: Role } : {});
  let GeneralClass = class extends General<T> {
    override type = type as any;
    override shortType = (short ?? type.toLowerCase()) as any;
    constructor(value: string, options?: Options, loc?: LocationInfo, context?: TreeContext) {
      super(value, { ...options, type }, loc, context);
    }
  };
  defineType(GeneralClass, type, short);
  return GeneralClass;
}

// Core id-like token used broadly (property names, identifiers, most keywords)
export type IdentRole = 'property' | 'variable' | 'selector' | 'keyword';
export const Ident = createGeneral<'Ident', IdentRole>('Ident');
export type Ident = InstanceType<typeof Ident>;
export const UrlValue = createGeneral('UrlValue');
export type UrlValue = InstanceType<typeof UrlValue>;
export const Flag = createGeneral('Flag');
export type Flag = InstanceType<typeof Flag>;
export const CustomProp = createGeneral('CustomProp');
export type CustomProp = InstanceType<typeof CustomProp>;
export const AtKeyword = createGeneral('AtKeyword');
export type AtKeyword = InstanceType<typeof AtKeyword>;

/**
 * "Anonymous" is from Less's original definition to mean
 * an unspecified token.
 */
export const Anonymous = createGeneral('Anonymous', 'any');
export type Anonymous = InstanceType<typeof Anonymous>;
export { Anonymous as any };