import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  el,
  Interpolated,
  interpolated,
  list,
  List,
  PseudoSelector,
  quoted,
  ref,
  rules,
  Rules as RulesClass,
  sellist,
  vardecl
} from '../index.js';
import { INTERPOLATION_PLACEHOLDER } from '../interpolated.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;
  marks = 0;
  reads = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

async function setEvaluatedRoot(context: Context, node: RulesClass): Promise<void> {
  const evald = await node.eval(context);
  expect(evald).toBeInstanceOf(RulesClass);
  if (!(evald instanceof RulesClass)) {
    throw new Error('Expected Rules root');
  }
  context.root = evald;
  context.rulesContext = evald;
}

describe('Interpolated', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders interpolated source syntax through toTrimmedString()', () => {
    const node = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });

    expect(node.toTrimmedString()).toBe('hello-$name');
  });

  it('streams interpolated source syntax without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [
        ref({ key: 'name' }, { type: 'variable' }),
        list([any('one'), any('two')])
      ]
    });

    expect(node.toTrimmedString({ writer })).toBe('hello-$name-one, two');
    expect(writer.toString()).toBe('hello-$name-one, two');
    expect(writer.captures).toBe(0);
  });

  it('renders resolved interpolated values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });
    const rendered = interpolatedNode.render(context);

    expect(rendered).toBe('hello-world');
    expect(interpolatedNode.evaluated).toBe(false);
    expect(interpolatedNode.registrationPrepared).toBe(false);
  });

  it('writes resolved interpolated output into flat buffers', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const buffer = createRenderBuffer('flat');
    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });
    const originalResolve = interpolatedNode.resolve;
    let resolveCalls = 0;
    interpolatedNode.resolve = function countResolveCalls(
      this: typeof interpolatedNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    expect(await interpolatedNode.render(context, buffer)).toBe('hello-world');
    expect(buffer.parts).toEqual(['hello-world']);
    expect(resolveCalls).toBe(0);
    expect(interpolatedNode.evaluated).toBe(false);
    expect(interpolatedNode.registrationPrepared).toBe(false);
  });

  it('writes resolved interpolated output into shared flat buffers with one mark', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const buffer = createRenderBuffer('flat');
    buffer.shareWriter = true;
    const writer = new CountingWriter(false, buffer.parts);
    context.printState.writer = writer;
    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });

    expect(await interpolatedNode.render(context, buffer)).toBe('hello-world');
    expect(buffer.parts).toEqual(['hello-', 'world']);
    expect(writer.marks).toBe(1);
    expect(writer.reads).toBe(1);
    expect(interpolatedNode.evaluated).toBe(false);
    expect(interpolatedNode.registrationPrepared).toBe(false);
  });

  it('renders resolved interpolated output directly without public resolve', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });
    interpolatedNode.resolve = () => {
      throw new Error('Interpolated direct render should resolve replacements natively');
    };

    expect(interpolatedNode.render(context)).toBe('hello-world');
    expect(interpolatedNode.evaluated).toBe(false);
    expect(interpolatedNode.registrationPrepared).toBe(false);
  });

  it('renders scalar replacement text without materializing a generic public result', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const descriptor = Object.getOwnPropertyDescriptor(Interpolated.prototype, 'createGeneric');
    if (!descriptor) {
      throw new Error('Expected Interpolated.createGeneric for render materialization proof');
    }
    Object.defineProperty(Interpolated.prototype, 'createGeneric', {
      ...descriptor,
      value: () => {
        throw new Error('Interpolated render should not materialize a generic public result');
      }
    });
    try {
      const interpolatedNode = interpolated({
        source: `hello-${INTERPOLATION_PLACEHOLDER}`,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      });

      expect(await interpolatedNode.render(context)).toBe('hello-world');
      expect(interpolatedNode.evaluated).toBe(false);
      expect(interpolatedNode.registrationPrepared).toBe(false);
    } finally {
      Object.defineProperty(Interpolated.prototype, 'createGeneric', descriptor);
    }
  });

  it('resolves interpolated values without touching render state', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });
    const resolved = await interpolatedNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('hello-world');
    expect(interpolatedNode.evaluated).toBe(false);
    expect(interpolatedNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source interpolated child containers canonical after resolve(context)', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [list([
        any('one'),
        ref({ key: 'name' }, { type: 'variable' })
      ])]
    });
    const resolved = await interpolatedNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('hello-one, world');
    expect(interpolatedNode.value.replacements[0]?.parent).toBe(interpolatedNode);
    expect(interpolatedNode.toTrimmedString()).toBe('hello-one, $name');
  });

  it('does not clone unchanged source replacement containers before resolving interpolated values', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    await setEvaluatedRoot(context, root);
    const originalClone = List.prototype.clone;
    let clonedLists = 0;
    List.prototype.clone = function cloneForCounting(
      this: List,
      ...args: Parameters<List['clone']>
    ): ReturnType<List['clone']> {
      clonedLists++;
      return originalClone.apply(this, args);
    };

    try {
      const replacement = list([
        any('one'),
        ref({ key: 'name' }, { type: 'variable' })
      ]);
      const interpolatedNode = interpolated({
        source: `hello-${INTERPOLATION_PLACEHOLDER}`,
        replacements: [replacement]
      });
      const resolved = await interpolatedNode.resolve(context);

      expect(resolved.toTrimmedString()).toBe('hello-one, world');
      expect(clonedLists).toBe(0);
      expect(replacement.parent).toBe(interpolatedNode);
    } finally {
      List.prototype.clone = originalClone;
    }
  });

  it('creates scalar whole-selector interpolations without public string transport', () => {
    const replacement = any('.theme');
    replacement.toTrimmedString = () => {
      throw new Error('whole-selector interpolation should read owned scalar text directly');
    };
    const interpolatedNode = interpolated({
      source: INTERPOLATION_PLACEHOLDER,
      replacements: [replacement]
    });

    const selector = interpolatedNode.createSelector('resolve');

    expect(selector.toTrimmedString()).toBe('.theme');
  });

  it('creates embedded scalar selector interpolations without public string transport', () => {
    const replacement = any('theme');
    replacement.toTrimmedString = () => {
      throw new Error('embedded selector interpolation should read owned scalar text directly');
    };
    const interpolatedNode = interpolated({
      source: `.prefix-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [replacement]
    });

    const selector = interpolatedNode.createSelector('resolve');

    expect(selector.toTrimmedString()).toBe('.prefix-theme');
  });

  it('creates compound selector interpolations without regex token arrays', () => {
    const originalMatch = String.prototype.match;
    let matchCalls = 0;
    String.prototype.match = function countMatchCalls(
      this: string,
      ...args: Parameters<typeof originalMatch>
    ): ReturnType<typeof originalMatch> {
      matchCalls++;
      return originalMatch.apply(this, args);
    };
    try {
      const interpolatedNode = interpolated({
        source: `.prefix-${INTERPOLATION_PLACEHOLDER}#id`,
        replacements: [any('theme')]
      });

      const selector = interpolatedNode.createSelector('resolve');

      expect(selector.toTrimmedString()).toBe('.prefix-theme#id');
      expect(matchCalls).toBe(0);
    } finally {
      String.prototype.match = originalMatch;
    }
  });

  it('creates generated selector-list wrappers without pseudo node materialization', () => {
    const createPseudo = vi.spyOn(PseudoSelector, 'create').mockImplementation(() => {
      throw new Error('generated selector-list wrappers should write pseudo syntax directly');
    });
    try {
      const node = interpolated({
        source: `${INTERPOLATION_PLACEHOLDER} .child`,
        replacements: [sellist([el('.one'), el('.two')])]
      });

      expect(node.createSelector('resolve').toTrimmedString()).toBe(':is(.one, .two) .child');
    } finally {
      createPseudo.mockRestore();
    }
  });

  it('creates non-scalar selector text without public replacement string transport', () => {
    const original = List.prototype.toTrimmedString;
    List.prototype.toTrimmedString = () => {
      throw new Error('non-scalar selector interpolation should write replacement syntax directly');
    };
    try {
      const wholeSelector = interpolated({
        source: INTERPOLATION_PLACEHOLDER,
        replacements: [list([any('.one'), any('.two')])]
      });
      const embeddedSelector = interpolated({
        source: `${INTERPOLATION_PLACEHOLDER} .child`,
        replacements: [list([any('.one'), any('.two')])]
      });

      expect(wholeSelector.createSelector('resolve').toTrimmedString()).toBe('.one, .two');
      expect(embeddedSelector.createSelector('resolve').toTrimmedString()).toBe('.one,.two.child');
    } finally {
      List.prototype.toTrimmedString = original;
    }
  });

  it('replaces scalar tokens without public string transport', () => {
    const replacement = any('world');
    replacement.toTrimmedString = () => {
      throw new Error('interpolated scalar replacement should read owned token text directly');
    };
    const node = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: []
    });

    expect(node.replace([replacement])).toBe('hello-world');
  });

  it('replaces non-scalar tokens without public replacement string transport', () => {
    const original = List.prototype.toTrimmedString;
    List.prototype.toTrimmedString = () => {
      throw new Error('interpolated non-scalar replacement should write syntax directly');
    };
    try {
      const replacement = list([any('one'), any('two')]);
      const node = interpolated({
        source: `hello-${INTERPOLATION_PLACEHOLDER}`,
        replacements: []
      });

      expect(node.replace([replacement])).toBe('hello-one, two');
    } finally {
      List.prototype.toTrimmedString = original;
    }
  });

  it('creates generic output without public interpolated string transport', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    await setEvaluatedRoot(context, root);
    const descriptor = Object.getOwnPropertyDescriptor(Interpolated.prototype, 'toTrimmedString');
    if (!descriptor) {
      throw new Error('Expected Interpolated.toTrimmedString for generic materialization proof');
    }
    Object.defineProperty(Interpolated.prototype, 'toTrimmedString', {
      ...descriptor,
      value: () => {
        throw new Error('Interpolated generic output should use direct replacement writing');
      }
    });
    try {
      const node = interpolated({
        source: `hello-${INTERPOLATION_PLACEHOLDER}`,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      });

      expect((await node.evalNode(context)).toTrimmedString()).toBe('hello-world');
    } finally {
      Object.defineProperty(Interpolated.prototype, 'toTrimmedString', descriptor);
    }
  });

  it('creates generic output without public replacement writer capture', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    await setEvaluatedRoot(context, root);
    const descriptor = Object.getOwnPropertyDescriptor(Interpolated.prototype, 'writeWithReplacements');
    if (!descriptor) {
      throw new Error('Expected Interpolated.writeWithReplacements for generic capture proof');
    }
    Object.defineProperty(Interpolated.prototype, 'writeWithReplacements', {
      ...descriptor,
      value: () => {
        throw new Error('Interpolated generic output should not capture replacement writer output');
      }
    });
    try {
      const node = interpolated({
        source: `hello-${INTERPOLATION_PLACEHOLDER}`,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      });

      expect((await node.evalNode(context)).toTrimmedString()).toBe('hello-world');
    } finally {
      Object.defineProperty(Interpolated.prototype, 'writeWithReplacements', descriptor);
    }
  });

  it('creates generic output from async changed replacements', async () => {
    const replacement = any('source');
    replacement.eval = async () => any('world');
    const node = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [replacement]
    });

    expect((await node.evalNode(context)).toTrimmedString()).toBe('hello-world');
  });

  it('preserves quoted replacement syntax when requested', () => {
    const node = interpolated({
      source: `progid:test(value=${INTERPOLATION_PLACEHOLDER})`,
      replacements: [quoted('#000000', { quote: '"' })]
    }, { preserveQuotedSyntax: true });

    expect(node.toTrimmedString()).toBe('progid:test(value="#000000")');
  });
});
