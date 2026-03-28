import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { Selector } from '../selector.js';
import { el, selcap, sellist } from '../index.js';
import { setField } from '../util/field-helpers.js';

class PreEvalReplacingSelector extends Selector<string> {
  static override childKeys = [] as const;

  value!: string;

  constructor(value: string) {
    super(value as any);
    this.value = value;
  }

  override valueOf(): string {
    return this.value;
  }

  override toTrimmedString(): string {
    return this.value;
  }

  override toString(options?: { writer?: { add: (value: string) => void } }): string {
    options?.writer?.add(this.value);
    return this.value;
  }

  override preEval(): this {
    if (this.value === 'orig') {
      return new PreEvalReplacingSelector('next').inherit(this) as this;
    }
    return this;
  }
}

describe('SelectorCapture', () => {
  it('renders state-patched selector values without mutating the canonical node', () => {
    const context = new Context();
    const node = selcap(el('.a'));

    setField(node, 'value', sellist([el('.x'), el('.y')]), context);

    expect(node.toTrimmedString({ context })).toBe('*[.x,\n.y]');
    expect(node.toTrimmedString()).toBe('*[.a]');
  });

  it('keeps valueOf canonical while render reads a state-patched selector value', () => {
    const context = new Context();
    const node = selcap(el('.a'));

    setField(node, 'value', sellist([el('.x'), el('.y')]), context);

    expect(node.valueOf()).toBe('.a');
    expect(node.toTrimmedString({ context })).toBe('*[.x,\n.y]');
    expect(node.toTrimmedString()).toBe('*[.a]');
  });

  it('evals the state-patched selector value', async () => {
    const context = new Context();
    const node = selcap(el('.a'));

    setField(node, 'value', sellist([el('.x'), el('.y')]), context);

    const result = await node.eval(context);
    expect(result.toTrimmedString({ context })).toBe('.x,\n.y');
    expect(node.toTrimmedString()).toBe('*[.a]');
  });

  it('preEvals without overwriting the canonical selector', async () => {
    const context = new Context();
    const node = selcap(new PreEvalReplacingSelector('orig'));

    const result = await node.preEval(context);

    expect(result).toBe(node);
    expect(node.toTrimmedString({ context })).toBe('*[next]');
    expect(node.toTrimmedString()).toBe('*[orig]');
    expect(node.value.toTrimmedString()).toBe('orig');
  });
});
