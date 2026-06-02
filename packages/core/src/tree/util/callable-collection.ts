import type { Context } from '../../context.js';
import { defineType, Node } from '../node.js';
import type { List } from '../list.js';
import type { Rules } from '../rules.js';
import type { MixinEntry } from './callable-entry.js';
import { evaluateCallableCollection } from './callable-eval.js';

export class MixinCollection extends Node<MixinEntry[]> {
  override adopt() {
    return this;
  }

  override resolve(_context: Context): this {
    return this;
  }

  async evalCall(context: Context, args?: List<Node>): Promise<Rules> {
    return evaluateCallableCollection({
      context,
      mixinEntries: this.value,
      args: args?.value ?? []
    });
  }
}

defineType(MixinCollection, 'MixinCollection', 'mixincoll');
