import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { Selector } from '../selector.js';
import { el, selcap, sellist } from '../index.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

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

    context.activeState.get(node).fields.set('value', sellist([el('.x'), el('.y')]));

    expect(node.toTrimmedString({ context })).toBe('*[.x,\n.y]');
    expect(node.toTrimmedString()).toBe('*[.a]');
  });

  it('keeps valueOf canonical while render reads a state-patched selector value', () => {
    const context = new Context();
    const node = selcap(el('.a'));

    context.activeState.get(node).fields.set('value', sellist([el('.x'), el('.y')]));

    expect(node.valueOf()).toBe('.a');
    expect(node.toTrimmedString({ context })).toBe('*[.x,\n.y]');
    expect(node.toTrimmedString()).toBe('*[.a]');
  });

  it('evals the state-patched selector value', async () => {
    const context = new Context();
    const node = selcap(el('.a'));

    context.activeState.get(node).fields.set('value', sellist([el('.x'), el('.y')]));

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
    expect(node.get('value').toTrimmedString()).toBe('orig');
  });

  it('keeps canonical selector access direct while render-key edges can diverge', () => {
    const canonical = el('.a');
    const alternate = el('.b');
    const node = selcap(canonical);
    const key = {} as RenderKey;
    const cursor = { node, renderKey: key };

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
  });
});
