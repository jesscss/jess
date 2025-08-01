import { defineType, Node, type NodeOptions } from './node';

export type BasicDeclarationValue = {
  name: string | Node;
  value: Node;
};

export class BasicDeclaration<T extends BasicDeclarationValue, O extends NodeOptions = NodeOptions> extends Node<T, O> {
  override type = 'BasicDeclaration';
  override shortType = 'declare';
}

export const declare = defineType<BasicDeclarationValue>(BasicDeclaration, 'BasicDeclaration', 'declare');