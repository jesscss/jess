import { type NodeOptions, type NodeValueObject, defineType } from './node';
import { Selector } from './selector';

type SimpleSelectorValue = string | NodeValueObject;

export abstract class SimpleSelector<
  T extends SimpleSelectorValue = SimpleSelectorValue,
  O extends NodeOptions = NodeOptions
> extends Selector<T, O> {
  get keySet(): Set<string> {
    if (this._keySet === undefined) {
      this._computeKeySetAndFastReject();
    }
    return this._keySet!;
  }

  protected override _computeKeySetAndFastReject(): void {
    // Simple selectors are always safe for fast rejection
    this._keySet = new Set([this.valueOf()]);
    this._canFastReject = true;
  }
}

defineType(SimpleSelector, 'SimpleSelector');