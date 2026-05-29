import type { IToken } from 'chevrotain';
import { decl, spaced, color, rules, any, ref, atrule, ruleset, el, forNode, list, List, Sequence, VarDeclaration, op, num, dimension, AssignmentType, vardecl, interpolated, call, JsFunction, customdecl, Node, Any } from '../index.js';
import { Context } from '../../context.js';
import { INTERPOLATION_PLACEHOLDER } from '../interpolated.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { Nil } from '../nil.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

let context: Context;

const token = (image: string, tokenTypeName = 'WS', startOffset = 0): IToken => ({
  image,
  tokenType: { name: tokenTypeName } as IToken['tokenType'],
  startOffset,
  endOffset: startOffset + image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

describe('Declaration', () => {
  beforeEach(() => {
    context = new Context();
  });
  it('should serialize to CSS', () => {
    let rule = decl({ name: 'color', value: color('#eee') });
    expect(rule.toTrimmedString()).toBe('color: #eee');
  });

  it('does not allocate options when serializing a default declaration', () => {
    const rule = decl({ name: 'color', value: color('#eee') });

    expect(rule.toTrimmedString()).toBe('color: #eee');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('streams non-custom declaration syntax without capture scaffolding', () => {
    const writer = new CountingWriter();
    const rule = decl({
      name: any('color'),
      value: any('red'),
      important: any('!important', { role: 'flag' })
    });

    expect(rule.toTrimmedString({ writer })).toBe('color: red !important');
    expect(writer.toString()).toBe('color: red !important');
    expect(writer.captures).toBe(0);
  });

  it('renders resolved declarations through render(context)', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const rendered = decl({
      name: any('color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    }).render(context);

    expect(rendered).toBe('color: red');
  });

  it('writes resolved declaration output into segmented buffers', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;
    const buffer = createRenderBuffer('segmented');
    const node = decl({
      name: any('color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    });
    const originalResolve = node.resolve;
    let resolveCalls = 0;
    node.resolve = function countResolveCalls(
      this: typeof node,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    expect(node.render(context, buffer)).toBe('color: red');
    expect(buffer.segments).toEqual(['color: red']);
    expect(resolveCalls).toBe(0);
  });

  it('renders resolved declaration output directly without public resolve', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;
    const node = decl({
      name: any('color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    });
    node.resolve = () => {
      throw new Error('Declaration direct render should evaluate natively');
    };

    expect(node.render(context)).toBe('color: red');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders declaration output without materializing a prepared declaration surface', async () => {
    const root = rules([
      vardecl({ name: any('brand'), value: any('red') })
    ]);
    await root.prepareRegistration(context);
    context.root = root;
    context.rulesContext = root;
    const node = decl({
      name: any('color'),
      value: ref({ key: 'brand' }, { type: 'variable' })
    });
    const originalWithParts = Reflect.get(node, 'withParts');
    if (typeof originalWithParts !== 'function') {
      throw new TypeError('Expected declaration withParts method');
    }
    let materializedSurfaces = 0;
    Reflect.set(node, 'withParts', function countWithParts(this: unknown, ...args: unknown[]) {
      materializedSurfaces++;
      return Reflect.apply(originalWithParts, this, args);
    });

    await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red');
    expect(materializedSurfaces).toBe(0);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders declaration output without copying source-backed registration parts', async () => {
    const root = rules([
      vardecl({ name: any('brand'), value: any('red') })
    ]);
    await root.prepareRegistration(context);
    context.root = root;
    context.rulesContext = root;
    const sourceName = any('color');
    const sourceValue = ref({ key: 'brand' }, { type: 'variable' });
    const node = decl({
      name: sourceName,
      value: sourceValue
    });
    const originalNameCopy = sourceName.copy;
    const originalValueCopy = sourceValue.copy;
    let sourcePartCopies = 0;
    sourceName.copy = function copyNameForCounting(
      this: typeof sourceName,
      ...args: Parameters<typeof originalNameCopy>
    ): ReturnType<typeof originalNameCopy> {
      sourcePartCopies++;
      return originalNameCopy.apply(this, args);
    };
    sourceValue.copy = function copyValueForCounting(
      this: typeof sourceValue,
      ...args: Parameters<typeof originalValueCopy>
    ): ReturnType<typeof originalValueCopy> {
      sourcePartCopies++;
      return originalValueCopy.apply(this, args);
    };

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red');
      expect(sourcePartCopies).toBe(0);
      expect(sourceName.parent).toBe(node);
      expect(sourceValue.parent).toBe(node);
      expect(node.registrationPrepared).toBe(false);
    } finally {
      sourceName.copy = originalNameCopy;
      sourceValue.copy = originalValueCopy;
    }
  });

  it('renders assignment families without reparenting authored declaration values', async () => {
    const makePrior = (assign: AssignmentType | '+:') => decl({
      name: any('background-color'),
      value: any('red')
    }, {
      assign: assign === AssignmentType.CondAssign ? undefined : assign
    });
    const cases: Array<[AssignmentType | '+:', string]> = [
      ['+:', 'background-color: red, blue'],
      [AssignmentType.MergeList, 'background-color: red, blue'],
      [AssignmentType.MergeSequence, 'background-color: red blue'],
      [AssignmentType.CondAssign, 'background-color: red']
    ];

    for (const [assign, expected] of cases) {
      const originalCopy = Any.prototype.copy;
      let scalarCopies = 0;
      const prior = makePrior(assign);
      const root = rules([prior]);
      await root.prepareRegistration(context);
      context.root = root;
      context.rulesContext = root;

      const value = any('blue');
      const sourceDeclaration = decl({
        name: any('background-color'),
        value
      }, { assign });
      Any.prototype.copy = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'blue') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };

      try {
        expect(await Promise.resolve(sourceDeclaration.render(context))).toBe(expected);
        expect(scalarCopies).toBe(0);
        expect(value.parent).toBe(sourceDeclaration);
        expect(sourceDeclaration.registrationPrepared).toBe(false);
      } finally {
        Any.prototype.copy = originalCopy;
      }
    }
  });

  it('renders nil declaration eval results through native node render', () => {
    const originalRender = Nil.prototype.render;
    let renderCalls = 0;
    Nil.prototype.render = function renderForCounting(
      this: Nil,
      ...args: Parameters<typeof originalRender>
    ): ReturnType<typeof originalRender> {
      renderCalls++;
      return originalRender.apply(this, args);
    };

    try {
      const value = ref({ key: 'missing' }, { type: 'variable', fallbackValue: new Nil() });
      const node = decl({ name: any('color'), value });
      const buffer = createRenderBuffer('segmented');

      expect(node.render(context)).toBe('');
      expect(node.render(context, buffer)).toBe('');
      expect(buffer.segments).toEqual([]);
      expect(renderCalls).toBe(2);
    } finally {
      Nil.prototype.render = originalRender;
    }
  });

  it('keeps toTrimmedString canonical even when a render context is present', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = decl({
      name: any('color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    });

    expect(node.toTrimmedString({ context })).toBe('color: $tone');
    expect(node.render(context)).toBe('color: red');
  });

  it('resolves declarations without touching render state', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = decl({
      name: any('color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    });
    const sourceValue = node.value.value;

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('color: red');
    expect(sourceValue.parent).toBe(node);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('evaluates declaration values without deriving a lazy eval mutation surface', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const sourceName = any('color');
    const sourceValue = ref({ key: 'tone' }, { type: 'variable' });
    const node = decl({
      name: sourceName,
      value: sourceValue
    });
    const originalDerive = Reflect.get(node, 'derive');
    if (typeof originalDerive !== 'function') {
      throw new TypeError('Expected declaration derive method');
    }
    let deriveCalls = 0;
    Reflect.set(node, 'derive', function countDerive(this: unknown, ...args: unknown[]) {
      deriveCalls++;
      return Reflect.apply(originalDerive, this, args);
    });

    const output = await node.evalNode(context);

    expect(output.toTrimmedString()).toBe('color: red');
    expect(output).not.toBe(node);
    expect(deriveCalls).toBe(0);
    expect(sourceName.parent).toBe(node);
    expect(sourceValue.parent).toBe(node);
  });

  it('normalizes assignment registration without preparing value subtrees', async () => {
    const value = any('one');
    let valuePrepCalls = 0;
    const originalPrepareRegistration = value.prepareRegistration.bind(value);
    value.prepareRegistration = (renderContext: Context) => {
      valuePrepCalls++;
      return originalPrepareRegistration(renderContext);
    };
    const node = decl({
      name: any('src'),
      value
    }, { assign: AssignmentType.MergeSequence });

    const prepared = await Promise.resolve(node.prepareRegistration(context));

    expect(prepared.value.value.type).toBe('Sequence');
    expect(prepared.value.value.toTrimmedString()).toBe('$.src one');
    expect(valuePrepCalls).toBe(0);
    expect(value.registrationPrepared).toBe(false);
  });

  it('normalizes assignment registration without deriving a declaration surface', async () => {
    const node = decl({
      name: any('src'),
      value: any('one')
    }, { assign: AssignmentType.MergeSequence });
    const originalDerive = Reflect.get(node, 'derive');
    if (typeof originalDerive !== 'function') {
      throw new TypeError('Expected declaration derive method');
    }
    let deriveCalls = 0;
    Reflect.set(node, 'derive', function countDerive(this: unknown, ...args: unknown[]) {
      deriveCalls++;
      return Reflect.apply(originalDerive, this, args);
    });

    const prepared = await Promise.resolve(node.prepareRegistration(context));

    expect(prepared.value.value.toTrimmedString()).toBe('$.src one');
    expect(deriveCalls).toBe(0);
    expect(node.registrationPrepared).toBe(false);
  });

  it('reuses source-free scalar leaves when deriving interpolated declaration names', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const originalClone = Node.prototype.clone;
    let clonedNameLeaves = 0;
    Node.prototype.clone = function cloneForCounting(
      this: Node,
      ...cloneArgs: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      if (this.valueOf() === 'color') {
        clonedNameLeaves++;
      }
      return originalClone.apply(this, cloneArgs);
    };

    try {
      const sourceNameLeaf = any('color');
      const node = decl({
        name: interpolated({
          source: `border-${INTERPOLATION_PLACEHOLDER}`,
          replacements: [sourceNameLeaf]
        }),
        value: ref({ key: 'tone' }, { type: 'variable' })
      });
      const sourceName = node.value.name;
      const resolved = await node.resolve(context);

      expect(resolved.toTrimmedString()).toBe('border-color: red');
      expect(clonedNameLeaves).toBe(0);
      expect(sourceName.parent).toBe(node);
      expect(sourceNameLeaf.parent).toBe(sourceName);
    } finally {
      Node.prototype.clone = originalClone;
    }
  });

  it('resolves custom declarations without touching render state', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = customdecl({
      name: any('--color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    });

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('--color:red');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.inCustom).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes resolved custom declaration output into segmented buffers', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;
    const buffer = createRenderBuffer('segmented');
    const node = customdecl({
      name: any('--color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    });
    const originalResolve = node.resolve;
    let resolveCalls = 0;
    node.resolve = function countResolveCalls(
      this: typeof node,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    expect(node.render(context, buffer)).toBe('--color:red');
    expect(buffer.segments).toEqual(['--color:red']);
    expect(resolveCalls).toBe(0);
  });

  it('renders indexed references inside custom property values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('tone'),
        value: any('red')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = decl({
      name: any('--custom'),
      value: ref({ key: 'tone' }, { type: 'index' })
    });

    expect(node.toTrimmedString()).toBe('--custom:$[tone]');
    expect(node.render(context)).toBe('--custom:red');
  });

  it('renders interpolated custom property values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('tone'),
        value: any('red')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = decl({
      name: any('--custom'),
      value: interpolated({
        source: `prefix-${INTERPOLATION_PLACEHOLDER}`,
        replacements: [ref({ key: 'tone' }, { type: 'variable' })]
      })
    });

    expect(node.toTrimmedString()).toBe('--custom:prefix-$tone');
    expect(node.render(context)).toBe('--custom:prefix-red');
  });

  it('keeps custom property value spacing raw after evaluation', async () => {
    const root = rules([
      vardecl({
        name: any('commentText'),
        value: any('/* // Not commented out // */')
      }),
      decl({
        name: any('--comment'),
        value: ref({ key: 'commentText' }, { type: 'variable' })
      })
    ]);

    expect(await renderNodeToString(root, context)).toBeString(`
      --comment:/* // Not commented out // */;
    `);
  });

  it('does not insert custom property value spacing around adjacent comments', () => {
    const node = decl({
      name: any('--custom'),
      value: any('a/* kept raw */b')
    });

    expect(node.toTrimmedString()).toBe('--custom:a/* kept raw */b');
    expect(node.render(context)).toBe('--custom:a/* kept raw */b');
  });

  it('preserves authored custom property value leading space', () => {
    const node = decl({
      name: any('--custom'),
      value: any(' red')
    });

    expect(node.toTrimmedString()).toBe('--custom: red');
    expect(node.render(context)).toBe('--custom: red');
  });

  it('preserves generic calls in custom property values during render(context)', () => {
    const node = decl({
      name: any('--custom'),
      value: call({
        name: 'if',
        args: new List([
          call({ name: 'not', args: new List([any('true')]) }),
          any('5')
        ])
      })
    });

    expect(node.toTrimmedString()).toBe('--custom:if(not(true), 5)');
    expect(node.render(context)).toBe('--custom:if(not(true), 5)');
  });

  it('preserves Less-style function calls in custom property values during render(context)', () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'rgba',
      fn: () => any('rgb(0, 30, 0)')
    }));
    context.root = root;
    context.rulesContext = root;

    const node = decl({
      name: any('--custom'),
      value: call({
        name: ref('rgba', { type: 'function', fallbackValue: true }),
        args: new List([num(0), num(30), num(0), num(238)])
      }, { silentFail: true })
    });

    expect(node.toTrimmedString()).toBe('--custom:rgba(0, 30, 0, 238)');
    expect(node.render(context)).toBe('--custom:rgba(0, 30, 0, 238)');
  });

  it('streams custom declaration values without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = decl({
      name: any('--custom'),
      value: call({
        name: 'if',
        args: new List([
          call({ name: 'not', args: new List([any('true')]) }),
          any('5')
        ])
      })
    });

    expect(node.toTrimmedString({ writer })).toBe('--custom:if(not(true), 5)');
    expect(writer.toString()).toBe('--custom:if(not(true), 5)');
    expect(writer.captures).toBe(0);
  });

  it('serializes important declarations with one space before !important', async () => {
    const node = rules([
      decl({
        name: any('color'),
        value: any('red'),
        important: any('!important', { role: 'flag' })
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      color: red !important;
    `);
  });

  it('derives source-backed important flags without deep-cloning the flag leaf', async () => {
    const originalClone = Any.prototype.clone;
    let clonedImportantFlags = 0;
    Any.prototype.clone = function cloneForCounting(
      this: Any,
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      if (this.value === '!important') {
        clonedImportantFlags++;
      }
      return originalClone.apply(this, args);
    };

    try {
      const important = any('!important', { role: 'flag' });
      important._location = [12, 1, 13, 21, 1, 22];
      const node = decl({
        name: any('color'),
        value: any('red'),
        important
      });

      const evald = await node.resolve(context);

      expect(evald.toTrimmedString()).toBe('color: red !important');
      expect(clonedImportantFlags).toBe(0);
      expect(important.parent).toBe(node);
    } finally {
      Any.prototype.clone = originalClone;
    }
  });

  it('serializes comment trivia between declaration values and semicolons', () => {
    const value = any('yes');
    value._location = [7, 1, 8, 9, 1, 10];
    const node = decl({ name: any('b'), value });
    node._location = [4, 1, 5, 25, 1, 26];
    const tokens = [token(' '), token('/* comment */', 'BlockComment')];
    const trivia = createTriviaMap({
      before: new Map([[23, tokens]]),
      after: new Map([[value.location[3], tokens]])
    }) satisfies TriviaMap;

    expect(rules([node]).toString({ trivia })).toBeString(`
      b: yes /* comment */;
    `);
  });

  it('serializes comment trivia between declaration names and separators', () => {
    const name = any('color', { role: 'property' });
    name._location = [4, 1, 5, 8, 1, 9];
    const node = decl({ name, value: any('grey') });
    const tokens = [token('/* survive */', 'BlockComment'), token(' '), token('/* me too */', 'BlockComment')];
    const trivia = createTriviaMap({
      before: new Map([[35, tokens]]),
      after: new Map([[name.location[3], tokens]])
    }) satisfies TriviaMap;

    expect(node.toString({ trivia })).toBe('color/* survive */ /* me too */: grey');
  });

  it('does not keep an empty leading item when += normalization has no prior declaration', async () => {
    const node = rules([
      decl({
        name: any('background-color'),
        value: any('red')
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo')
      }, { assign: '+:' })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      background-color: red, foo;
    `);
  });

  it('normalizes merged declaration placeholders without recopying scalar leaves', async () => {
    const node = rules([
      decl({
        name: any('background-color'),
        value: any('red')
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo')
      }, { assign: '+:' })
    ]);
    const originalCopy = Node.prototype.copy;
    let scalarCopies = 0;
    Node.prototype.copy = function copyForCounting(this: Node, ...args: Parameters<typeof originalCopy>): ReturnType<typeof originalCopy> {
      if (this.type === 'Any' && /^(red|foo)$/u.test(String(this.valueOf()))) {
        scalarCopies++;
      }
      return originalCopy.apply(this, args);
    };

    try {
      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        background-color: red, foo;
      `);
      expect(scalarCopies).toBe(0);
    } finally {
      Node.prototype.copy = originalCopy;
    }
  });

  it('renders merged declaration lists without a temporary list surface', () => {
    const node = decl({
      name: any('background-color'),
      value: new List([
        new Nil(),
        any('red'),
        any('foo')
      ])
    }, { normalizedFromAssign: AssignmentType.Add });
    const originalToTrimmedString = List.prototype.toTrimmedString;
    let listPrinterCalls = 0;
    List.prototype.toTrimmedString = function toTrimmedStringForCounting(
      this: List,
      ...args: Parameters<typeof originalToTrimmedString>
    ): ReturnType<typeof originalToTrimmedString> {
      listPrinterCalls++;
      return originalToTrimmedString.apply(this, args);
    };

    try {
      expect(node.render(context)).toBe('background-color: red, foo');
      expect(listPrinterCalls).toBe(0);
    } finally {
      List.prototype.toTrimmedString = originalToTrimmedString;
    }
  });

  it('renders assignment merges without evaluating temporary sequence containers', async () => {
    const root = rules([
      decl({
        name: any('background-color'),
        value: any('red')
      }, { assign: '+_:' })
    ]);
    await root.prepareRegistration(context);
    const prior = root;
    context.root = prior;
    context.rulesContext = prior;
    const node = decl({
      name: any('background-color'),
      value: any('blue')
    }, { assign: '+_:' });
    const originalSequenceEvalNode = Sequence.prototype.evalNode;
    let sequenceEvalCalls = 0;
    Sequence.prototype.evalNode = function evalNodeForCounting(
      this: Sequence,
      ...args: Parameters<typeof originalSequenceEvalNode>
    ): ReturnType<typeof originalSequenceEvalNode> {
      if (this.value.some(item => item.valueOf() === 'blue')) {
        sequenceEvalCalls++;
      }
      return originalSequenceEvalNode.apply(this, args);
    };

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBe('background-color: red blue');
      expect(sequenceEvalCalls).toBe(0);
    } finally {
      Sequence.prototype.evalNode = originalSequenceEvalNode;
    }
  });

  it('renders assignment item state with contextual important through buffers', async () => {
    const root = rules([
      decl({
        name: any('background-color'),
        value: any('red')
      }, { assign: '+:' })
    ]);
    await root.prepareRegistration(context);
    context.root = root;
    context.rulesContext = root;
    context.pushImportantSource();
    const node = decl({
      name: any('background-color'),
      value: any('blue')
    }, { assign: '+:' });
    const buffer = createRenderBuffer('segmented');

    await expect(Promise.resolve(node.render(context, buffer))).resolves.toBe('background-color: red, blue !important');
    expect(buffer.segments).toEqual(['background-color: red, blue !important']);
    expect(context.hasImportantSource).toBe(false);
    expect(node.value.value.parent).toBe(node);
  });

  it('keeps custom property assignment render state raw through buffers', async () => {
    const root = rules([
      decl({
        name: any('--tokens'),
        value: any('red')
      }, { assign: '+:' })
    ]);
    await root.prepareRegistration(context);
    context.root = root;
    context.rulesContext = root;
    const node = decl({
      name: any('--tokens'),
      value: any('blue')
    }, { assign: '+:' });
    const buffer = createRenderBuffer('segmented');

    await expect(Promise.resolve(node.render(context, buffer))).resolves.toBe('--tokens:blue');
    expect(buffer.segments).toEqual(['--tokens:blue']);
    expect(node.value.value.parent).toBe(node);
  });

  it('renders contextual important flags without materializing a flag node', () => {
    const node = decl({
      name: any('color'),
      value: any('red')
    });
    context.pushImportantSource();

    expect(node.render(context)).toBe('color: red !important');
    expect(context.hasImportantSource).toBe(false);
    expect(node.value.important).toBeUndefined();
  });

  it('keeps root merged declaration output unchanged without recopying scalar leaves', async () => {
    const node = rules([
      decl({
        name: any('background-color'),
        value: any('red')
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo')
      }, { assign: '+:' })
    ]);

    const css = await renderNodeToString(node, context);

    expect(css).toBeString(`
      background-color: red, foo;
    `);
  });

  it('resolves merged declaration lookups without duplicating or keeping empty placeholders', async () => {
    const node = rules([
      decl({
        name: any('background-color'),
        value: any('red')
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo')
      }, { assign: '+:' }),
      decl({
        name: any('background'),
        value: ref({ key: 'background-color' }, { type: 'declaration' })
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      background-color: red, foo;
      background: red, foo;
    `);
  });

  it('resolves merged declaration lookups from a nested child ruleset in source order', async () => {
    const node = rules([
      rules([
        decl({
          name: any('background-color'),
          value: any('red')
        }, { assign: '+:' }),
        decl({
          name: any('background-color'),
          value: any('foo')
        }, { assign: '+:' }),
        rules([
          decl({
            name: any('background'),
            value: ref({ key: 'background-color' }, { type: 'declaration' })
          })
        ])
      ])
    ]);

    const parent = node.value[0]!;
    const child = parent.value[2]!;
    child.parent = parent;

    expect(await renderNodeToString(node, context)).toBeString(`
      background-color: red, foo;
      background: red, foo;
    `);
  });

  it('does not pull a prior plain declaration into Less-style property merge chains', async () => {
    const node = rules([
      decl({
        name: any('src'),
        value: any('base')
      }),
      decl({
        name: any('src'),
        value: any('one')
      }, { assign: AssignmentType.MergeList }),
      decl({
        name: any('src'),
        value: any('two')
      }, { assign: AssignmentType.MergeSequence }),
      decl({
        name: any('src'),
        value: any('three')
      }, { assign: AssignmentType.MergeList })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      src: base;
      src: one two, three;
    `);
  });

  it('coalesces merged declaration lists without recopying copied leaves', async () => {
    const node = rules([
      rules([
        decl({
          name: any('src'),
          value: any('one')
        }, { assign: AssignmentType.MergeList })
      ]),
      rules([
        decl({
          name: any('src'),
          value: any('two')
        }, { assign: AssignmentType.MergeList })
      ]),
      rules([
        decl({
          name: any('src'),
          value: any('three')
        }, { assign: AssignmentType.MergeList })
      ])
    ]);
    const originalCopy = Node.prototype.copy;
    let srcValueCopies = 0;
    Node.prototype.copy = function copyForCounting(this: Node, ...args: Parameters<typeof originalCopy>): ReturnType<typeof originalCopy> {
      if (this.type === 'Any' && /^(one|two|three)$/u.test(String(this.valueOf()))) {
        srcValueCopies++;
      }
      return originalCopy.apply(this, args);
    };

    try {
      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        src: one, two, three;
      `);
      expect(srcValueCopies).toBe(0);
    } finally {
      Node.prototype.copy = originalCopy;
    }
  });

  it('renders source-free assignment list inputs without copying the input container', async () => {
    const sourceValue = list([any('blue'), any('green')]);
    const node = rules([
      decl({
        name: any('src'),
        value: any('red')
      }),
      decl({
        name: any('src'),
        value: sourceValue
      }, { assign: AssignmentType.Add })
    ]);
    const sourceParent = sourceValue.parent;
    const originalCopy = List.prototype.copy;
    let sourceListCopies = 0;
    List.prototype.copy = function copyForCounting(
      this: List,
      ...args: Parameters<typeof originalCopy>
    ): ReturnType<typeof originalCopy> {
      if (this === sourceValue) {
        sourceListCopies++;
      }
      return originalCopy.apply(this, args);
    };

    try {
      expect(await renderNodeToString(node, context)).toBeString(`
        src: red;
        src: red, blue, green;
      `);
      expect(sourceListCopies).toBe(0);
      expect(sourceValue.parent).toBe(sourceParent);
    } finally {
      List.prototype.copy = originalCopy;
    }
  });

  it('preserves authored multiline declaration values with a minimum continuation indent', async () => {
    const node = rules([
      decl({ name: any('background'), value: any('the,\n              great,\n              wall') }),
      decl({ name: any('color'), value: any('\nwhite') }),
      decl({ name: any('background-position'), value: any('45\n-23') })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      background: the,
                    great,
                    wall;
      color:
        white;
      background-position: 45
        -23;
    `);
  });

  it('does not treat boundary trivia before a value as authored multiline value text', () => {
    const name = any('color', { role: 'property' });
    name._location = [0, 1, 1, 5, 1, 6];
    const value = any('white');
    value._location = [8, 2, 1, 12, 2, 6];
    const node = decl({ name, value });
    node._location = [0, 1, 1, 12, 2, 6];
    const trivia = createTriviaMap({
      before: new Map([[value.location[0], [token('\n', 'WS', 6)]]])
    }) satisfies TriviaMap;

    expect(node.toTrimmedString({ trivia })).toBe('color: white');
  });

  it('does not re-merge sequence assignments during post-eval coalescing in nested at-rules', async () => {
    context = new Context({ collapseNesting: true, leakyRules: true });
    const node = rules([
      ruleset({
        selector: el('nav'),
        rules: rules([
          atrule({
            name: any('@starting-style', { role: 'atkeyword' }),
            rules: rules([
              decl({ name: any('padding'), value: any('10px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: any('padding'), value: any('8px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: any('padding'), value: any('6px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: any('padding'), value: any('4px') }, { assign: AssignmentType.MergeSequence })
            ])
          })
        ])
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      nav {
        @starting-style {
          padding: 10px 8px 6px 4px;
        }
      }
    `);
  });

  it('coalesces sequence assignments emitted through nested $for output rules', async () => {
    context = new Context({ collapseNesting: true, leakyRules: true });
    const node = rules([
      ruleset({
        selector: el('aside'),
        rules: rules([
          atrule({
            name: any('@starting-style', { role: 'atkeyword' }),
            rules: rules([
              forNode({
                pattern: {
                  kind: 'single',
                  value: new VarDeclaration({
                    name: any('value', { role: 'property' }),
                    value: any('_')
                  })
                },
                iterable: {
                  kind: 'node',
                  value: new List([
                    any('10px'),
                    any('20px'),
                    any('30px'),
                    any('40px')
                  ])
                },
                rules: rules([
                  decl({ name: any('padding'), value: ref('value', { type: 'variable' }) }, { assign: AssignmentType.MergeSequence })
                ])
              })
            ])
          })
        ])
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      aside {
        @starting-style {
          padding: 10px 20px 30px 40px;
        }
      }
    `);
  });

  it('coalesces sequence assignments emitted through tuple-pattern each()-style loops', async () => {
    context = new Context({ collapseNesting: true, leakyRules: true });
    const node = rules([
      ruleset({
        selector: el('aside'),
        rules: rules([
          atrule({
            name: any('@starting-style', { role: 'atkeyword' }),
            rules: rules([
              forNode({
                pattern: {
                  kind: 'tuple',
                  values: [
                    new VarDeclaration({ name: any('value', { role: 'property' }), value: any('_') }),
                    new VarDeclaration({ name: any('key', { role: 'property' }), value: any('_') }),
                    new VarDeclaration({ name: any('index', { role: 'property' }), value: any('_') })
                  ]
                },
                iterable: {
                  kind: 'node',
                  value: new List([
                    num(1),
                    num(2),
                    num(3),
                    num(4)
                  ])
                },
                rules: rules([
                  decl({
                    name: any('padding'),
                    value: op([ref('value', { type: 'variable' }), '*', dimension([10, 'px'])])
                  }, { assign: AssignmentType.MergeSequence })
                ])
              })
            ])
          })
        ])
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      aside {
        @starting-style {
          padding: 10px 20px 30px 40px;
        }
      }
    `);
  });
  // it('should serialize to a module', () => {
  //   let rule = decl({ name: expr([any('color')]), value: spaced([any('#eee')]) })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.decl({\n  name: $J.expr([$J.any("color")]),\n  value: $J.spaced([$J.any("#eee")])\n})'
  //   )
  // })
});
