import { defineType, type Node } from './node'

export type VariableOptions = {

}

/**
 * @example
 *   Jess: `@let var: 1`
 *   Less: `@var: 1`
 *   SCSS: `$var: 1`
 *
 * @example `setDefined`
 *   Jess: `@set var: 1`
 *   SCSS: `$var: 1 !global`
 */
export class VariableDeclaration<
  T extends Interpolated | string = Interpolated | string,
  U extends Node = Node
> extends Declaration <T, U, VariableDeclarationOptions> {
  // register(context: Context, name: string, node: Declaration<string>): void {
  //   context.scope.setVar(name, node, this.options)
  // }
}

export const vardef = defineType(VariableDeclaration, 'VariableDeclaration', 'vardef')