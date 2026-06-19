import type { Context } from '../../context.js';
import { defineType, Node } from '../node.js';
import type { List } from '../list.js';
import type { Rules } from '../rules.js';
import {
  getCallableEntryName,
  getCallableEntryParams,
  isCallableEntry,
  type MixinEntry
} from './callable-entry.js';
import { evaluateCallableCollection } from './callable-eval.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import type { PrintOptions } from './print.js';

function callableEntryDisplayName(entry: MixinEntry): string {
  if (isCallableEntry(entry)) {
    const name = getCallableEntryName(entry);
    return String(isNode(name) ? name.valueOf() : name ?? '');
  }
  return String(entry.selector.valueOf());
}

function callableEntryParamText(entry: MixinEntry): string {
  if (!isCallableEntry(entry)) {
    return '';
  }
  const params = getCallableEntryParams(entry)?.items;
  if (!params?.length) {
    return '';
  }
  let out = '';
  for (let i = 0; i < params.length; i++) {
    if (i > 0) {
      out += ', ';
    }
    const param = params[i]!;
    if (isNode(param, N.VarDeclaration)) {
      out += String(param.name.valueOf());
    } else {
      out += String(param.valueOf());
    }
  }
  return out;
}

export class MixinCollection extends Node<MixinEntry[]> {
  static override childKeys = null;

  readonly entries: MixinEntry[];

  constructor(value: MixinEntry[]) {
    super(value);
    this.entries = value;
  }

  override adopt() {
    return this;
  }

  override resolve(_context: Context): this {
    return this;
  }

  override valueOf(): string {
    const first = this.entries[0];
    if (!first) {
      return '';
    }
    return `${callableEntryDisplayName(first)}(${callableEntryParamText(first)})`;
  }

  override toTrimmedString(options?: PrintOptions): string {
    const out = this.valueOf();
    options?.writer?.add(out, this);
    return out;
  }

  async evalCall(context: Context, args?: List<Node>): Promise<Rules> {
    return evaluateCallableCollection({
      context,
      mixinEntries: this.entries,
      args: args?.value ?? []
    });
  }
}

defineType(MixinCollection, 'MixinCollection', 'mixincoll');
