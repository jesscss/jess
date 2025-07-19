import {
  defineType
} from './node';
import { type Context } from '../context';
import { Selector } from './selector';
import { getEntries } from './util/collections';

/** Constructs */
export class SelectorList extends Selector<Selector[]> {
  type = 'SelectorList';
  shortType = 'sellist';

  find(needle: Selector): Selector[] | undefined {
    throw new Error('Method not implemented.');
  }

  get keySet(): Set<string> {
    if (this._keySet === undefined) {
      this._computeKeySetAndFastReject();
    }
    return this._keySet!;
  }

  protected override _computeKeySetAndFastReject(): void {
    let combinedKeySet = new Set<string>();

    for (const selector of this.value) {
      combinedKeySet = combinedKeySet.union(selector.keySet);
    }

    this._keySet = combinedKeySet;
    // SelectorLists represent alternatives - can't use fast rejection
    this._canFastReject = false;
  }

  /** @todo - put in whitespace and line breaks */
  override toTrimmedString(depth: number = 0) {
    let space = ''.padStart(depth * 2);
    return this.value.map(v => v.toString(depth)).join(`,\n${space}`);
  }

  override valueOf() {
    return this.value.map(v => v.valueOf()).join(',');
  }

  override async evalNode(context: Context): Promise<SelectorList | Selector> {
    const list = this.maybeClone(context);
    const { value } = list;
    for (let [item, i] of getEntries(value)) {
      value[i] = await item.eval(context) as Selector;
    }
    if (value.length === 1) {
      return value[0]!;
    }
    return list;
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist');