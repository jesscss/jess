import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  attr,
  BasicSelector,
  compound,
  el,
  Interpolated,
  InterpolatedSelector,
  interpolated,
  interpolatedSelector,
  INTERPOLATION_PLACEHOLDER,
  ref,
  rules,
  type Rules as RulesClass,
  vardecl
} from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

describe('InterpolatedSelector', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders interpolated selector source syntax through toTrimmedString()', () => {
    const node = interpolatedSelector(interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'index' })]
    }));

    expect(node.toTrimmedString()).toBe('.$[name]');
  });

  it('stores the interpolated selector child on a constructor-owned direct field', () => {
    const value = interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'index' })]
    });
    const node = interpolatedSelector(value);

    expect(node.value).toBe(value);
    expect(InterpolatedSelector.childKeys).toEqual(['value']);
  });

  it('renders resolved interpolated selectors through render(context)', async () => {
    const root = rules([
      vardecl({
        name: 'name',
        value: any('foo')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const selectorNode = interpolatedSelector(interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'index' })]
    }));
    const rendered = selectorNode.render(context);

    expect(rendered).toBe('.foo');
    expect(selectorNode.registrationPrepared).toBe(false);
  });

  it('writes resolved interpolated selector output into flat buffers', async () => {
    const root = rules([
      vardecl({
        name: 'name',
        value: any('foo')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const buffer = createRenderBuffer('flat');
    const selectorNode = interpolatedSelector(interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'index' })]
    }));
    const originalResolve = selectorNode.resolve;
    let resolveCalls = 0;
    selectorNode.resolve = function countResolveCalls(
      this: typeof selectorNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    expect(await selectorNode.render(context, buffer)).toBe('.foo');
    expect(buffer.parts).toEqual(['.foo']);
    expect(resolveCalls).toBe(0);
    expect(selectorNode.registrationPrepared).toBe(false);
  });

  it('renders resolved interpolated selector output directly without public resolve', async () => {
    const root = rules([
      vardecl({
        name: 'name',
        value: any('foo')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const selectorNode = interpolatedSelector(interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'index' })]
    }));
    selectorNode.resolve = () => {
      throw new Error('InterpolatedSelector direct render should resolve natively');
    };

    expect(selectorNode.render(context)).toBe('.foo');
    expect(selectorNode.registrationPrepared).toBe(false);
  });

  it('resolves interpolated selectors without touching render state', async () => {
    const root = rules([
      vardecl({
        name: 'name',
        value: any('foo')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const selectorNode = interpolatedSelector(interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'index' })]
    }));
    const resolved = await selectorNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('.foo');
    expect(selectorNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source interpolated selector child containers canonical after resolve(context)', async () => {
    const root = rules([
      vardecl({
        name: 'capture-attr',
        value: any('foo')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const replacement = compound([
      el('a'),
      attr({
        name: 'data',
        op: '=',
        value: ref({ key: 'capture-attr' }, { type: 'variable' })
      })
    ]);
    const selectorNode = interpolatedSelector(interpolated({
      source: INTERPOLATION_PLACEHOLDER,
      replacements: [replacement]
    }));
    const resolved = await selectorNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('a[data=foo]');
    expect(replacement.parent).toBe(selectorNode.value);
    expect(replacement.toTrimmedString()).toBe('a[data=$capture-attr]');
    expect(selectorNode.toTrimmedString()).toBe('a[data=$capture-attr]');
  });

  it('does not clone the source interpolated value before resolving interpolated selectors', async () => {
    const root = rules([
      vardecl({
        name: 'name',
        value: any('foo')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;
    const originalClone = Interpolated.prototype.clone;
    let clonedInterpolatedValues = 0;
    Interpolated.prototype.clone = function cloneForCounting(
      this: Interpolated,
      ...args: Parameters<Interpolated['clone']>
    ): ReturnType<Interpolated['clone']> {
      clonedInterpolatedValues++;
      return originalClone.apply(this, args);
    };

    try {
      const value = interpolated({
        source: `.${INTERPOLATION_PLACEHOLDER}`,
        replacements: [ref({ key: 'name' }, { type: 'index' })]
      });
      const selectorNode = interpolatedSelector(value);
      const resolved = await selectorNode.resolve(context);

      expect(resolved.toTrimmedString()).toBe('.foo');
      expect(clonedInterpolatedValues).toBe(0);
      expect(value.parent).toBe(selectorNode);
    } finally {
      Interpolated.prototype.clone = originalClone;
    }
  });

  it('reuses source-free selector leaves when whole interpolation becomes selector output', async () => {
    const left = el('.a');
    const right = el('.b');
    const replacement = compound([left, right]);
    const selectorNode = interpolatedSelector(interpolated({
      source: INTERPOLATION_PLACEHOLDER,
      replacements: [replacement]
    }));
    const originalClone = BasicSelector.prototype.clone;
    let basicSelectorCloneCalls = 0;
    BasicSelector.prototype.clone = function cloneForCounting(
      this: BasicSelector,
      ...args: Parameters<BasicSelector['clone']>
    ): ReturnType<BasicSelector['clone']> {
      basicSelectorCloneCalls++;
      return originalClone.apply(this, args);
    };

    try {
      const resolved = await selectorNode.resolve(context);

      expect(resolved.toTrimmedString()).toBe('.a.b');
      expect(basicSelectorCloneCalls).toBe(0);
      expect(replacement.parent).toBe(selectorNode.value);
      expect(left.parent).toBe(replacement);
      expect(right.parent).toBe(replacement);
    } finally {
      BasicSelector.prototype.clone = originalClone;
    }
  });
});
