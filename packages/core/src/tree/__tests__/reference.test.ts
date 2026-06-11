import { ref, rules, decl, vardecl, spaced, any, quoted, expr, ruleset, mixin, call, compound, el, list, atrule, sel, co, interpolated, interpolatedSelector, INTERPOLATION_PLACEHOLDER, Rules as RulesClass, Mixin as MixinClass, Any, List, Sequence, Dimension, dimension, JsArray, JsObject, JsFunction, F_MAY_ASYNC, F_NON_STATIC, defaultguard, type Node } from '../index.js';
import { Context } from '../../context.js';
import { JsExpression } from '../js-expr.js';
import { isNode } from '../util/is-node.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { buildScopeFrame, lookupScopeFrameVariable } from '../scope-frame.js';
let context: Context;
let expectedAsyncRulesContext: RulesClass | undefined;

function setRulesContext(root: Node): RulesClass {
  expect(root).toBeInstanceOf(RulesClass);
  if (!(root instanceof RulesClass)) {
    throw new Error('Expected Rules root');
  }
  context.root = root;
  context.rulesContext = root;
  return root;
}

class AsyncRulesContextAny extends Any<string> {
  constructor(value: string) {
    super(value);
    this.addFlags(F_MAY_ASYNC, F_NON_STATIC);
  }

  override async eval(evalContext: Context) {
    await Promise.resolve();
    expect(evalContext.rulesContext).toBe(expectedAsyncRulesContext);
    return any(this.value);
  }
}

class NativeRenderAny extends Any<string> {
  override render(renderContext: Context) {
    expect(renderContext).toBe(context);
    return `rendered-${this.value}`;
  }
}

class AsyncNativeRenderAny extends Any<string> {
  constructor(value: string) {
    super(value);
    this.addFlags(F_MAY_ASYNC, F_NON_STATIC);
  }

  override async eval() {
    await Promise.resolve();
    return new NativeRenderAny(this.value);
  }
}

describe('reference', () => {
  beforeEach(() => {
    context = new Context();
    expectedAsyncRulesContext = undefined;
  });
  describe('serialization', () => {
    it('renders a variable reference through toTrimmedString()', () => {
      let node = ref({ key: 'foo' }, { type: 'variable' });
      expect(node.toTrimmedString()).toBe('$foo');
    });

    it('should serialize a variable reference', () => {
      let node = ref({ key: 'foo' }, { type: 'variable' });
      expect(node.toTrimmedString()).toBe('$foo');
    });

    it('serializes a snapshot variable reference', () => {
      let node = ref({ key: 'foo' }, { type: 'variable', readMode: 'snapshot' });
      expect(node.toTrimmedString()).toBe('$!foo');
    });

    it('should serialize a declaration reference', () => {
      let node = ref({ key: 'foo' }, { type: 'declaration' });
      expect(node.toTrimmedString()).toBe('$.foo');
    });

    it('should serialize an optional reference', () => {
      let node = ref({ key: 'foo' }, { type: 'variable', fallbackValue: true });
      expect(node.toTrimmedString()).toBe('$foo?');
    });

    it('should serialize a mixin reference', () => {
      let node = ref({ key: 'foo' }, { type: 'mixin' });
      expect(node.toTrimmedString()).toBe('$ > foo');
    });

    it('should serialize a mixin-ruleset reference', () => {
      let node = ref({ key: 'foo' }, { type: 'mixin-ruleset' });
      expect(node.toTrimmedString()).toBe('$ > *foo');
    });

    it('should serialize a number index', () => {
      let node = ref({ key: 0 }, { type: 'index' });
      expect(node.toTrimmedString()).toBe('$[0]');
    });

    it('should serialize a string (variable) index', () => {
      let node = ref({ key: 'foo' }, { type: 'index' });
      expect(node.toTrimmedString()).toBe('$[foo]');
    });

    it('should serialize a quoted (property) index', () => {
      let node = ref({ key: quoted('foo') }, { type: 'index' });
      expect(node.toTrimmedString()).toBe('$["foo"]');
    });
  });

  describe('get from scope', () => {
    it('renders a resolved variable value through render(context)', async () => {
      const node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        })
      ]);
      const evald = setRulesContext(await node.eval(context));

      const refNode = ref({ key: 'foo' }, { type: 'variable' });
      const rendered = refNode.render(context);

      expect(rendered).toBe('red');
      expect(refNode.evaluated).toBe(false);
      expect(refNode.registrationPrepared).toBe(false);
    });

    it('writes resolved reference output into segmented buffers', async () => {
      const node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        })
      ]);
      const evald = setRulesContext(await node.eval(context));
      const buffer = createRenderBuffer('segmented');
      const refNode = ref({ key: 'foo' }, { type: 'variable' });
      const originalResolve = refNode.resolve;
      let resolveCalls = 0;
      refNode.resolve = function countResolveCalls(
        this: typeof refNode,
        ...args: Parameters<typeof originalResolve>
      ): ReturnType<typeof originalResolve> {
        resolveCalls++;
        return originalResolve.apply(this, args);
      };

      expect(refNode.render(context, buffer)).toBe('red');
      expect(buffer.segments).toEqual(['red']);
      expect(resolveCalls).toBe(0);
      expect(refNode.evaluated).toBe(false);
      expect(refNode.registrationPrepared).toBe(false);
    });

    it('renders resolved reference output directly without public resolve', async () => {
      const node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        })
      ]);
      const evald = setRulesContext(await node.eval(context));
      const refNode = ref({ key: 'foo' }, { type: 'variable' });
      refNode.resolve = () => {
        throw new Error('Reference direct render should use evalNode');
      };

      expect(refNode.render(context)).toBe('red');
      expect(refNode.evaluated).toBe(false);
      expect(refNode.registrationPrepared).toBe(false);
    });

    it('renders references through the resolved node native render path', async () => {
      const sourceValue = new NativeRenderAny('value');
      const node = rules([
        vardecl({
          name: any('foo'),
          value: sourceValue
        })
      ]);
      setRulesContext(await node.eval(context));
      const buffer = createRenderBuffer('flat');
      const refNode = ref({ key: 'foo' }, { type: 'variable' });

      expect(refNode.render(context)).toBe('rendered-value');
      expect(refNode.render(context, buffer)).toBe('rendered-value');
      expect(buffer.parts).toEqual(['rendered-value']);
      expect(sourceValue.toTrimmedString()).toBe('value');
    });

    it('renders async referenced values through the resolved node native render path', async () => {
      const sourceValue = new AsyncNativeRenderAny('value');
      const node = rules([
        vardecl({
          name: any('foo'),
          value: sourceValue
        })
      ]);
      setRulesContext(await node.eval(context));
      const buffer = createRenderBuffer('flat');
      const refNode = ref({ key: 'foo' }, { type: 'variable' });
      refNode.resolve = () => {
        throw new Error('Reference async render should use evalNode');
      };

      await expect(Promise.resolve(refNode.render(context))).resolves.toBe('rendered-value');
      await expect(refNode.render(context, buffer)).resolves.toBe('rendered-value');
      expect(buffer.parts).toEqual(['rendered-value']);
      expect(sourceValue.toTrimmedString()).toBe('value');
    });

    it('keeps definition rules context until async live-slot value eval settles', async () => {
      const definitionRules = rules([]);
      const paramDecl = vardecl({ name: any('tone'), value: any('blue') }, { paramVar: true });
      definitionRules.push(paramDecl);
      expectedAsyncRulesContext = definitionRules;
      const asyncValue = new AsyncRulesContextAny('red');
      const runtimeScope = rules([]);
      runtimeScope.scopeFrame = buildScopeFrame(
        undefined,
        runtimeScope,
        undefined,
        new Map([
          ['tone', {
            value: list([asyncValue]),
            sourceNode: paramDecl
          }]
        ])
      );
      context.rulesContext = runtimeScope;

      const resolved = await ref({ key: 'tone' }, { type: 'variable' }).eval(context);

      expect(resolved.toTrimmedString()).toBe('red');
      expect(context.rulesContext).toBe(runtimeScope);
    });

    it('renders runtime-binding scalar references without applying public result metadata', async () => {
      const sourceValue = any('red');
      const paramDecl = vardecl({ name: any('tone'), value: sourceValue }, { paramVar: true });
      const runtimeScope = rules([]);
      runtimeScope.scopeFrame = buildScopeFrame(
        undefined,
        runtimeScope,
        undefined,
        new Map([
          ['tone', {
            value: sourceValue,
            sourceNode: paramDecl
          }]
        ])
      );
      context.rulesContext = runtimeScope;
      const sourceParent = sourceValue.parent;
      const buffer = createRenderBuffer('segmented');
      const originalCopy = Any.prototype.copy;
      const originalInherit = sourceValue.inherit;
      let scalarCopies = 0;
      let sourceValueInherits = 0;
      Any.prototype.copy = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'red') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };
      sourceValue.inherit = function inheritForCounting(
        this: typeof sourceValue,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        sourceValueInherits++;
        return originalInherit.apply(this, args);
      };

      try {
        const refNode = ref({ key: 'tone' }, { type: 'variable' });

        expect(await Promise.resolve(refNode.render(context))).toBe('red');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red');
        expect(buffer.segments).toEqual(['red']);
        expect(scalarCopies).toBe(0);
        expect(sourceValueInherits).toBe(0);
        expect(sourceValue.parent).toBe(sourceParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        Any.prototype.copy = originalCopy;
        sourceValue.inherit = originalInherit;
      }
    });

    it('resolves runtime-binding scalar references without frozen result metadata', async () => {
      const sourceValue = any('red');
      const paramDecl = vardecl({ name: any('tone'), value: sourceValue }, { paramVar: true });
      const runtimeScope = rules([]);
      runtimeScope.scopeFrame = buildScopeFrame(
        undefined,
        runtimeScope,
        undefined,
        new Map([
          ['tone', {
            value: sourceValue,
            sourceNode: paramDecl
          }]
        ])
      );
      context.rulesContext = runtimeScope;
      const originalCopy = Any.prototype.copy;
      let scalarCopies = 0;
      Any.prototype.copy = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'red') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };

      try {
        const refNode = ref({ key: 'tone' }, { type: 'variable' });
        const resolved = await refNode.eval(context);

        expect(resolved).toBe(sourceValue);
        expect(resolved.toTrimmedString()).toBe('red');
        expect(scalarCopies).toBe(0);
        expect(sourceValue.frozen).toBe(false);
        expect(context.referenceStack).toBe(0);
      } finally {
        Any.prototype.copy = originalCopy;
      }
    });

    it('resolves fallback-frame declarations without Rules.find fallback', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'tone') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const fallbackScope = rules([
          vardecl({ name: any('tone'), value: any('blue') })
        ]);
        await fallbackScope.eval(context);
        const runtimeScope = rules([]);
        await runtimeScope.eval(context);
        runtimeScope.getScopeFrame().fallbackFrame = fallbackScope.getScopeFrame();
        context.rulesContext = runtimeScope;

        const resolved = await ref({ key: 'tone' }, { type: 'variable' }).eval(context);

        expect(resolved.toTrimmedString()).toBe('blue');
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('keeps runtime-binding containers on the owned output path for default guards', async () => {
      const sourceDefault = defaultguard();
      const sourceValue = list([sourceDefault]);
      const paramDecl = vardecl({ name: any('tone'), value: sourceValue }, { paramVar: true });
      const runtimeScope = rules([]);
      runtimeScope.scopeFrame = buildScopeFrame(
        undefined,
        runtimeScope,
        undefined,
        new Map([
          ['tone', {
            value: sourceValue,
            sourceNode: paramDecl
          }]
        ])
      );
      context.rulesContext = runtimeScope;
      context.isDefault = true;
      const sourceParent = sourceValue.parent;
      const defaultParent = sourceDefault.parent;
      const buffer = createRenderBuffer('segmented');

      const refNode = ref({ key: 'tone' }, { type: 'variable' });

      expect(await Promise.resolve(refNode.render(context))).toBe('true');
      expect(await Promise.resolve(refNode.render(context, buffer))).toBe('true');
      expect(buffer.segments).toEqual(['true']);
      expect(sourceValue.parent).toBe(sourceParent);
      expect(sourceDefault.parent).toBe(defaultParent);
      expect(context.referenceStack).toBe(0);
    });

    it('renders source-free runtime-binding containers as text without public result metadata', async () => {
      const sourceValue = list([any('red'), any('blue')]);
      const paramDecl = vardecl({ name: any('tone'), value: sourceValue }, { paramVar: true });
      const runtimeScope = rules([]);
      runtimeScope.scopeFrame = buildScopeFrame(
        undefined,
        runtimeScope,
        undefined,
        new Map([
          ['tone', {
            value: sourceValue,
            sourceNode: paramDecl
          }]
        ])
      );
      context.rulesContext = runtimeScope;
      const sourceParent = sourceValue.parent;
      const buffer = createRenderBuffer('segmented');
      const originalCopy = List.prototype.copy;
      const originalInherit = List.prototype.inherit;
      let sourceValueCopies = 0;
      let sourceValueInherits = 0;
      List.prototype.copy = function copyForCounting(
        this: List,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === sourceValue) {
          sourceValueCopies++;
        }
        return originalCopy.apply(this, args);
      };
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === sourceValue) {
          sourceValueInherits++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        const refNode = ref({ key: 'tone' }, { type: 'variable' });

        expect(await Promise.resolve(refNode.render(context))).toBe('red, blue');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red, blue');
        expect(buffer.segments).toEqual(['red, blue']);
        expect(sourceValueCopies).toBe(0);
        expect(sourceValueInherits).toBe(0);
        expect(sourceValue.parent).toBe(sourceParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
      }
    });

    it('renders source-free runtime-binding sequences as text without container copies', async () => {
      const sourceValue = spaced([any('red'), any('blue')]);
      const paramDecl = vardecl({ name: any('tone'), value: sourceValue }, { paramVar: true });
      const runtimeScope = rules([]);
      runtimeScope.scopeFrame = buildScopeFrame(
        undefined,
        runtimeScope,
        undefined,
        new Map([
          ['tone', {
            value: sourceValue,
            sourceNode: paramDecl
          }]
        ])
      );
      context.rulesContext = runtimeScope;
      const sourceParent = sourceValue.parent;
      const buffer = createRenderBuffer('segmented');
      const originalCopy = Sequence.prototype.copy;
      const originalInherit = Sequence.prototype.inherit;
      let sourceValueCopies = 0;
      let sourceValueInherits = 0;
      Sequence.prototype.copy = function copyForCounting(
        this: Sequence,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === sourceValue) {
          sourceValueCopies++;
        }
        return originalCopy.apply(this, args);
      };
      Sequence.prototype.inherit = function inheritForCounting(
        this: Sequence,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === sourceValue) {
          sourceValueInherits++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        const refNode = ref({ key: 'tone' }, { type: 'variable' });

        expect(await Promise.resolve(refNode.render(context))).toBe('red blue');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red blue');
        expect(buffer.segments).toEqual(['red blue']);
        expect(sourceValueCopies).toBe(0);
        expect(sourceValueInherits).toBe(0);
        expect(sourceValue.parent).toBe(sourceParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        Sequence.prototype.copy = originalCopy;
        Sequence.prototype.inherit = originalInherit;
      }
    });

    it('renders source-backed runtime-binding containers as text without container copies', async () => {
      const sourceValue = list([any('red'), any('blue')]);
      sourceValue._location = [10, 1, 11, 20, 1, 21];
      const paramDecl = vardecl({ name: any('tone'), value: sourceValue }, { paramVar: true });
      const runtimeScope = rules([]);
      runtimeScope.scopeFrame = buildScopeFrame(
        undefined,
        runtimeScope,
        undefined,
        new Map([
          ['tone', {
            value: sourceValue,
            sourceNode: paramDecl
          }]
        ])
      );
      context.rulesContext = runtimeScope;
      const sourceParent = sourceValue.parent;
      const buffer = createRenderBuffer('segmented');
      const originalCopy = List.prototype.copy;
      const originalInherit = List.prototype.inherit;
      let sourceValueCopies = 0;
      let sourceValueInherits = 0;
      List.prototype.copy = function copyForCounting(
        this: List,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === sourceValue) {
          sourceValueCopies++;
        }
        return originalCopy.apply(this, args);
      };
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === sourceValue) {
          sourceValueInherits++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        const refNode = ref({ key: 'tone' }, { type: 'variable' });

        expect(await Promise.resolve(refNode.render(context))).toBe('red, blue');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red, blue');
        expect(buffer.segments).toEqual(['red, blue']);
        expect(sourceValueCopies).toBe(0);
        expect(sourceValueInherits).toBe(0);
        expect(sourceValue.parent).toBe(sourceParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
      }
    });

    it('renders source-backed variable sequences with source-backed children without copies or frozen state', async () => {
      const first = dimension([1, 'px']);
      const second = dimension([2, 'px']);
      first._location = [10, 1, 11, 13, 1, 14];
      second._location = [14, 1, 15, 16, 1, 17];
      const sourceValue = spaced([first, second]);
      sourceValue._location = [10, 1, 11, 16, 1, 17];
      const node = rules([
        vardecl({
          name: any('space'),
          value: sourceValue
        })
      ]);
      const sourceParent = sourceValue.parent;
      const firstParent = first.parent;
      const secondParent = second.parent;
      setRulesContext(await node.eval(context));
      const refNode = ref({ key: 'space' }, { type: 'variable' });
      const buffer = createRenderBuffer('segmented');
      const originalSequenceInherit = Sequence.prototype.inherit;
      const originalDimensionInherit = Dimension.prototype.inherit;
      let sequenceInherits = 0;
      let dimensionInherits = 0;
      Sequence.prototype.inherit = function inheritForCounting(
        this: Sequence,
        ...args: Parameters<typeof originalSequenceInherit>
      ): ReturnType<typeof originalSequenceInherit> {
        if (args[0] === sourceValue) {
          sequenceInherits++;
        }
        return originalSequenceInherit.apply(this, args);
      };
      Dimension.prototype.inherit = function inheritForCounting(
        this: Dimension,
        ...args: Parameters<typeof originalDimensionInherit>
      ): ReturnType<typeof originalDimensionInherit> {
        if (args[0] === first || args[0] === second) {
          dimensionInherits++;
        }
        return originalDimensionInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(refNode.render(context))).toBe('1px 2px');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('1px 2px');
        expect(buffer.segments).toEqual(['1px 2px']);
        expect(sequenceInherits).toBe(0);
        expect(dimensionInherits).toBe(0);
        expect(sourceValue.frozen).toBe(false);
        expect(first.frozen).toBe(false);
        expect(second.frozen).toBe(false);
        expect(sourceValue.parent).toBe(sourceParent);
        expect(first.parent).toBe(firstParent);
        expect(second.parent).toBe(secondParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        Sequence.prototype.inherit = originalSequenceInherit;
        Dimension.prototype.inherit = originalDimensionInherit;
      }
    });

    it('renders simple variable references through raw lookup without public eval materialization', async () => {
      const first = dimension([1, 'px']);
      const second = dimension([2, 'px']);
      const sourceValue = spaced([first, second]);
      const node = rules([
        vardecl({
          name: any('space'),
          value: sourceValue
        })
      ]);
      const sourceParent = sourceValue.parent;
      setRulesContext(await node.eval(context));
      const refNode = ref({ key: 'space' }, { type: 'variable' });
      const buffer = createRenderBuffer('segmented');
      const originalEvalNode = refNode.evalNode;
      let evalNodeCalls = 0;
      refNode.evalNode = function evalNodeForCounting(
        this: typeof refNode,
        ...args: Parameters<typeof originalEvalNode>
      ): ReturnType<typeof originalEvalNode> {
        evalNodeCalls++;
        return originalEvalNode.apply(this, args);
      };

      expect(await Promise.resolve(refNode.render(context))).toBe('1px 2px');
      expect(await Promise.resolve(refNode.render(context, buffer))).toBe('1px 2px');
      expect(buffer.segments).toEqual(['1px 2px']);
      expect(evalNodeCalls).toBe(0);
      expect(sourceValue.frozen).toBe(false);
      expect(sourceValue.parent).toBe(sourceParent);
      expect(refNode.evaluated).toBe(false);
      expect(refNode.registrationPrepared).toBe(false);
      expect(context.referenceStack).toBe(0);
    });

    it('keeps runtime-binding container sources canonical during public resolve', async () => {
      const sourceValue = list([any('red'), any('blue')]);
      const paramDecl = vardecl({ name: any('tone'), value: sourceValue }, { paramVar: true });
      const runtimeScope = rules([]);
      runtimeScope.scopeFrame = buildScopeFrame(
        undefined,
        runtimeScope,
        undefined,
        new Map([
          ['tone', {
            value: sourceValue,
            sourceNode: paramDecl
          }]
        ])
      );
      context.rulesContext = runtimeScope;

      const resolved = await ref({ key: 'tone' }, { type: 'variable' }).resolve(context);

      expect(resolved).toBeInstanceOf(List);
      expect(resolved.toTrimmedString()).toBe('red, blue');
      expect(sourceValue.toTrimmedString()).toBe('red, blue');
      expect(sourceValue.parent).toBe(paramDecl);
      expect(context.referenceStack).toBe(0);
    });

    it('resolves dynamic runtime-binding containers without post-eval reference ownership copies', async () => {
      const sourceValue = list([new AsyncNativeRenderAny('red')]);
      const paramDecl = vardecl({ name: any('palette'), value: sourceValue }, { paramVar: true });
      const runtimeScope = rules([]);
      runtimeScope.scopeFrame = buildScopeFrame(
        undefined,
        runtimeScope,
        undefined,
        new Map([
          ['palette', {
            value: sourceValue,
            sourceNode: paramDecl
          }]
        ])
      );
      context.rulesContext = runtimeScope;
      const refNode = ref({ key: 'palette' }, { type: 'variable' });
      const originalInherit = List.prototype.inherit;
      let inheritedFromReference = 0;
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === refNode) {
          inheritedFromReference++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        const resolved = await refNode.resolve(context);

        expect(resolved).toBeInstanceOf(List);
        expect(resolved.toTrimmedString()).toBe('red');
        expect(inheritedFromReference).toBe(0);
        expect(sourceValue.parent).toBe(paramDecl);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.inherit = originalInherit;
      }
    });

    it('resolves a variable value without touching render state', async () => {
      const node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        })
      ]);
      const evald = setRulesContext(await node.eval(context));

      const refNode = ref({ key: 'foo' }, { type: 'variable' });
      const resolved = await refNode.resolve(context);

      expect(resolved.toTrimmedString()).toBe('red');
      expect(refNode.evaluated).toBe(false);
      expect(refNode.registrationPrepared).toBe(false);
      expect(context.printState.writer).toBeUndefined();
    });

    it('renders source-free scalar variable references without copying the scalar leaf', async () => {
      const sourceValue = any('red');
      const node = rules([
        vardecl({
          name: any('foo'),
          value: sourceValue
        })
      ]);
      const sourceParent = sourceValue.parent;
      setRulesContext(await node.eval(context));
      const refNode = ref({ key: 'foo' }, { type: 'variable' });
      const buffer = createRenderBuffer('segmented');
      const originalCopy = Any.prototype.copy;
      const originalInherit = sourceValue.inherit;
      let scalarCopies = 0;
      let sourceValueInherits = 0;
      Any.prototype.copy = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'red') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };
      sourceValue.inherit = function inheritForCounting(
        this: typeof sourceValue,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        sourceValueInherits++;
        return originalInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(refNode.render(context))).toBe('red');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red');
        expect(buffer.segments).toEqual(['red']);
        expect(scalarCopies).toBe(0);
        expect(sourceValueInherits).toBe(0);
        expect(sourceValue.parent).toBe(sourceParent);
      } finally {
        Any.prototype.copy = originalCopy;
        sourceValue.inherit = originalInherit;
      }
    });

    it('renders source-free scalar declaration references without copying the scalar leaf', async () => {
      const sourceValue = any('red');
      const node = rules([
        decl({
          name: any('src'),
          value: sourceValue
        })
      ]);
      const sourceParent = sourceValue.parent;
      setRulesContext(await node.eval(context));
      const refNode = ref({ key: 'src' }, { type: 'declaration' });
      const buffer = createRenderBuffer('segmented');
      const originalCopy = Any.prototype.copy;
      const originalInherit = sourceValue.inherit;
      let scalarCopies = 0;
      let sourceValueInherits = 0;
      Any.prototype.copy = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'red') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };
      sourceValue.inherit = function inheritForCounting(
        this: typeof sourceValue,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        sourceValueInherits++;
        return originalInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(refNode.render(context))).toBe('red');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red');
        expect(buffer.segments).toEqual(['red']);
        expect(scalarCopies).toBe(0);
        expect(sourceValueInherits).toBe(0);
        expect(sourceValue.parent).toBe(sourceParent);
      } finally {
        Any.prototype.copy = originalCopy;
        sourceValue.inherit = originalInherit;
      }
    });

    it('renders source-free declaration reference containers as text without public result metadata', async () => {
      const sourceValue = list([any('red'), any('blue')]);
      const node = rules([
        decl({
          name: any('src'),
          value: sourceValue
        })
      ]);
      const sourceParent = sourceValue.parent;
      setRulesContext(await node.eval(context));
      const refNode = ref({ key: 'src' }, { type: 'declaration' });
      const buffer = createRenderBuffer('segmented');
      const originalCopy = List.prototype.copy;
      const originalInherit = List.prototype.inherit;
      let sourceValueCopies = 0;
      let sourceValueInherits = 0;
      List.prototype.copy = function copyForCounting(
        this: List,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === sourceValue) {
          sourceValueCopies++;
        }
        return originalCopy.apply(this, args);
      };
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === sourceValue) {
          sourceValueInherits++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(refNode.render(context))).toBe('red, blue');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red, blue');
        expect(buffer.segments).toEqual(['red, blue']);
        expect(sourceValueCopies).toBe(0);
        expect(sourceValueInherits).toBe(0);
        expect(sourceValue.parent).toBe(sourceParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
      }
    });

    it('renders source-free declaration reference sequences as text without container copies', async () => {
      const sourceValue = spaced([any('red'), any('blue')]);
      const node = rules([
        decl({
          name: any('src'),
          value: sourceValue
        })
      ]);
      const sourceParent = sourceValue.parent;
      setRulesContext(await node.eval(context));
      const refNode = ref({ key: 'src' }, { type: 'declaration' });
      const buffer = createRenderBuffer('segmented');
      const originalCopy = Sequence.prototype.copy;
      const originalInherit = Sequence.prototype.inherit;
      let sourceValueCopies = 0;
      let sourceValueInherits = 0;
      Sequence.prototype.copy = function copyForCounting(
        this: Sequence,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === sourceValue) {
          sourceValueCopies++;
        }
        return originalCopy.apply(this, args);
      };
      Sequence.prototype.inherit = function inheritForCounting(
        this: Sequence,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === sourceValue) {
          sourceValueInherits++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(refNode.render(context))).toBe('red blue');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red blue');
        expect(buffer.segments).toEqual(['red blue']);
        expect(sourceValueCopies).toBe(0);
        expect(sourceValueInherits).toBe(0);
        expect(sourceValue.parent).toBe(sourceParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        Sequence.prototype.copy = originalCopy;
        Sequence.prototype.inherit = originalInherit;
      }
    });

    it('renders dynamic runtime-binding containers without post-eval reference ownership copies', async () => {
      const sourceValue = list([new AsyncNativeRenderAny('red')]);
      const paramDecl = vardecl({ name: any('palette'), value: sourceValue }, { paramVar: true });
      const runtimeScope = rules([]);
      runtimeScope.scopeFrame = buildScopeFrame(
        undefined,
        runtimeScope,
        undefined,
        new Map([
          ['palette', {
            value: sourceValue,
            sourceNode: paramDecl
          }]
        ])
      );
      context.rulesContext = runtimeScope;
      const refNode = ref({ key: 'palette' }, { type: 'variable' });
      const buffer = createRenderBuffer('segmented');
      const originalInherit = List.prototype.inherit;
      let inheritedFromReference = 0;
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === refNode) {
          inheritedFromReference++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(refNode.render(context))).toBe('red');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red');
        expect(buffer.segments).toEqual(['red']);
        expect(inheritedFromReference).toBe(0);
        expect(sourceValue.parent).toBe(paramDecl);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.inherit = originalInherit;
      }
    });

    it('renders source-backed static declaration reference containers as text without container copies', async () => {
      const sourceValue = list([any('red'), any('blue')]);
      sourceValue._location = [10, 1, 11, 20, 1, 21];
      const node = rules([
        decl({
          name: any('src'),
          value: sourceValue
        })
      ]);
      const sourceParent = sourceValue.parent;
      setRulesContext(await node.eval(context));
      const refNode = ref({ key: 'src' }, { type: 'declaration' });
      const buffer = createRenderBuffer('segmented');
      const originalCopy = List.prototype.copy;
      const originalInherit = List.prototype.inherit;
      let sourceValueCopies = 0;
      let sourceValueInherits = 0;
      List.prototype.copy = function copyForCounting(
        this: List,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === sourceValue) {
          sourceValueCopies++;
        }
        return originalCopy.apply(this, args);
      };
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === sourceValue) {
          sourceValueInherits++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(refNode.render(context))).toBe('red, blue');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red, blue');
        expect(buffer.segments).toEqual(['red, blue']);
        expect(sourceValueCopies).toBe(0);
        expect(sourceValueInherits).toBe(0);
        expect(sourceValue.parent).toBe(sourceParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
      }
    });

    it('renders dynamic declaration reference containers without post-eval reference ownership copies', async () => {
      const sourceValue = list([ref({ key: 'tone' }, { type: 'variable' })]);
      const node = rules([
        vardecl({ name: any('tone'), value: any('red') }),
        decl({
          name: any('src'),
          value: sourceValue
        })
      ]);
      setRulesContext(await node.eval(context));
      const refNode = ref({ key: 'src' }, { type: 'declaration' });
      const buffer = createRenderBuffer('segmented');
      const originalInherit = List.prototype.inherit;
      let inheritedFromReference = 0;
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === refNode) {
          inheritedFromReference++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(refNode.render(context))).toBe('red');
        expect(await Promise.resolve(refNode.render(context, buffer))).toBe('red');
        expect(buffer.segments).toEqual(['red']);
        expect(inheritedFromReference).toBe(0);
        expect(sourceValue.parent?.type).toBe('Declaration');
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.inherit = originalInherit;
      }
    });

    it('resolves dynamic declaration reference containers without post-eval reference ownership copies', async () => {
      const sourceValue = list([ref({ key: 'tone' }, { type: 'variable' })]);
      const node = rules([
        vardecl({ name: any('tone'), value: any('red') }),
        decl({
          name: any('src'),
          value: sourceValue
        })
      ]);
      setRulesContext(await node.eval(context));
      const refNode = ref({ key: 'src' }, { type: 'declaration' });
      const originalInherit = List.prototype.inherit;
      let inheritedFromReference = 0;
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === refNode) {
          inheritedFromReference++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        const resolved = await refNode.resolve(context);

        expect(resolved).toBeInstanceOf(List);
        expect(resolved.toTrimmedString()).toBe('red');
        expect(inheritedFromReference).toBe(0);
        expect(sourceValue.parent?.type).toBe('Declaration');
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.inherit = originalInherit;
      }
    });

    it('does not redirect direct index sequence targets as mixin keys', async () => {
      const targetValue = spaced([any('red'), any('blue')]);
      const node = rules([
        vardecl({
          name: 'tone',
          value: targetValue
        })
      ]);
      setRulesContext(await node.eval(context));
      const refNode = ref({
        target: ref({ key: 'tone' }, { type: 'variable' }),
        key: quoted('missing')
      }, {
        type: 'index',
        fallbackValue: any('fallback')
      });

      await expect(Promise.resolve(refNode.render(context))).resolves.toBe('fallback');
      expect(context.referenceStack).toBe(0);
    });

    it('keeps direct index target semantics per container kind', async () => {
      const targetList = list([any('red'), any('blue')]);
      const targetArray = new JsArray([any('one'), any('two')]);
      const targetObject = new JsObject({ tone: any('green') });
      const targetRules = rules([
        decl({ name: 'tone', value: any('orange') }),
        vardecl({ name: 'toneVar', value: any('purple') })
      ]);
      const node = rules([
        vardecl({ name: 'targetList', value: targetList }),
        vardecl({ name: 'targetArray', value: targetArray }),
        vardecl({ name: 'targetObject', value: targetObject }),
        vardecl({ name: 'targetRules', value: targetRules })
      ]);
      setRulesContext(await node.eval(context));

      await expect(Promise.resolve(ref({
        target: ref({ key: 'targetList' }, { type: 'variable' }),
        key: quoted('missing')
      }, {
        type: 'index',
        fallbackValue: any('fallback')
      }).render(context))).resolves.toBe('fallback');

      await expect(Promise.resolve(ref({
        target: ref({ key: 'targetArray' }, { type: 'variable' }),
        key: 1
      }, { type: 'index' }).render(context))).resolves.toBe('two');

      await expect(Promise.resolve(ref({
        target: ref({ key: 'targetObject' }, { type: 'variable' }),
        key: quoted('tone')
      }, { type: 'index' }).render(context))).resolves.toBe('green');

      await expect(Promise.resolve(ref({
        target: ref({ key: 'targetRules' }, { type: 'variable' }),
        key: quoted('tone')
      }, { type: 'index' }).render(context))).resolves.toBe('orange');

      await expect(Promise.resolve(ref({
        target: ref({ key: 'targetRules' }, { type: 'variable' }),
        key: 'toneVar'
      }, { type: 'index' }).render(context))).resolves.toBe('purple');

      expect(context.referenceStack).toBe(0);
    });

    it('renders source-free direct index scalar hits without applying reference metadata', async () => {
      const targetArray = new JsArray([any('one'), any('two')]);
      const targetObject = new JsObject({ tone: any('green') });
      const node = rules([
        vardecl({ name: 'targetArray', value: targetArray }),
        vardecl({ name: 'targetObject', value: targetObject })
      ]);
      setRulesContext(await node.eval(context));
      const arrayRefNode = ref({
        target: ref({ key: 'targetArray' }, { type: 'variable' }),
        key: 1
      }, { type: 'index' });
      const objectRefNode = ref({
        target: ref({ key: 'targetObject' }, { type: 'variable' }),
        key: quoted('tone')
      }, { type: 'index' });
      const sourceTone = targetObject.value.tone;
      if (!(sourceTone instanceof Any)) {
        throw new Error('Expected object scalar');
      }
      const originalInherit = Any.prototype.inherit;
      let inheritedFromReference = 0;
      Any.prototype.inherit = function inheritForCounting(
        this: Any,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === arrayRefNode || args[0] === objectRefNode) {
          inheritedFromReference++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(arrayRefNode.render(context))).toBe('two');
        expect(await Promise.resolve(objectRefNode.render(context))).toBe('green');
        expect(inheritedFromReference).toBe(0);
        expect(targetArray.value[1]?.parent).toBe(targetArray);
        expect(sourceTone.parent).toBe(targetObject);
        expect(context.referenceStack).toBe(0);
      } finally {
        Any.prototype.inherit = originalInherit;
      }
    });

    it('renders source-free direct index container hits without applying reference metadata', async () => {
      const arrayList = list([any('alpha'), any('beta')]);
      const objectSequence = spaced([any('one'), any('two')]);
      const targetArray = new JsArray([arrayList]);
      const targetObject = new JsObject({
        tones: objectSequence
      });
      const node = rules([
        vardecl({ name: 'targetArray', value: targetArray }),
        vardecl({ name: 'targetObject', value: targetObject })
      ]);
      setRulesContext(await node.eval(context));
      const arrayRefNode = ref({
        target: ref({ key: 'targetArray' }, { type: 'variable' }),
        key: 0
      }, { type: 'index' });
      const objectRefNode = ref({
        target: ref({ key: 'targetObject' }, { type: 'variable' }),
        key: quoted('tones')
      }, { type: 'index' });
      const sourceList = targetArray.value[0];
      if (!(sourceList instanceof List) || !(objectSequence instanceof Sequence)) {
        throw new Error('Expected source containers');
      }
      const originalListInherit = List.prototype.inherit;
      const originalSequenceInherit = Sequence.prototype.inherit;
      let listInheritedFromReference = 0;
      let sequenceInheritedFromReference = 0;
      List.prototype.inherit = function inheritForCounting(
        this: List<Node>,
        ...args: Parameters<typeof originalListInherit>
      ): ReturnType<typeof originalListInherit> {
        if (args[0] === arrayRefNode || args[0] === objectRefNode) {
          listInheritedFromReference++;
        }
        return originalListInherit.apply(this, args);
      };
      Sequence.prototype.inherit = function inheritForCounting(
        this: Sequence,
        ...args: Parameters<typeof originalSequenceInherit>
      ): ReturnType<typeof originalSequenceInherit> {
        if (args[0] === arrayRefNode || args[0] === objectRefNode) {
          sequenceInheritedFromReference++;
        }
        return originalSequenceInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(arrayRefNode.render(context))).toBe('alpha, beta');
        expect(await Promise.resolve(objectRefNode.render(context))).toBe('one two');
        expect(listInheritedFromReference).toBe(0);
        expect(sequenceInheritedFromReference).toBe(0);
        expect(sourceList.parent).toBe(targetArray);
        expect(objectSequence.parent).toBe(targetObject);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.inherit = originalListInherit;
        Sequence.prototype.inherit = originalSequenceInherit;
      }
    });

    it('renders source-backed direct index container hits without container copies', async () => {
      const sourceList = list([any('alpha'), any('beta')]);
      sourceList._location = [10, 1, 11, 20, 1, 21];
      const targetArray = new JsArray([sourceList]);
      const node = rules([
        vardecl({ name: 'targetArray', value: targetArray })
      ]);
      setRulesContext(await node.eval(context));
      const refNode = ref({
        target: ref({ key: 'targetArray' }, { type: 'variable' }),
        key: 0
      }, { type: 'index' });
      const originalCopy = List.prototype.copy;
      const originalInherit = List.prototype.inherit;
      let sourceListCopies = 0;
      let sourceListInherits = 0;
      List.prototype.copy = function copyForCounting(
        this: List,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === sourceList) {
          sourceListCopies++;
        }
        return originalCopy.apply(this, args);
      };
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === sourceList || args[0] === refNode) {
          sourceListInherits++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(refNode.render(context))).toBe('alpha, beta');
        expect(sourceListCopies).toBe(0);
        expect(sourceListInherits).toBe(0);
        expect(sourceList.parent).toBe(targetArray);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
      }
    });

    it('renders source-backed direct index object container hits without container copies', async () => {
      const sourceList = list([any('alpha'), any('beta')]);
      sourceList._location = [10, 1, 11, 20, 1, 21];
      const targetObject = new JsObject({ tones: sourceList });
      const node = rules([
        vardecl({ name: 'targetObject', value: targetObject })
      ]);
      setRulesContext(await node.eval(context));
      const refNode = ref({
        target: ref({ key: 'targetObject' }, { type: 'variable' }),
        key: quoted('tones')
      }, { type: 'index' });
      const originalCopy = List.prototype.copy;
      const originalInherit = List.prototype.inherit;
      let sourceListCopies = 0;
      let sourceListInherits = 0;
      List.prototype.copy = function copyForCounting(
        this: List,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === sourceList) {
          sourceListCopies++;
        }
        return originalCopy.apply(this, args);
      };
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === sourceList || args[0] === refNode) {
          sourceListInherits++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        expect(await Promise.resolve(refNode.render(context))).toBe('alpha, beta');
        expect(sourceListCopies).toBe(0);
        expect(sourceListInherits).toBe(0);
        expect(sourceList.parent).toBe(targetObject);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
      }
    });

    it('keeps public direct index container resolve from corrupting source parents', async () => {
      const targetObject = new JsObject({
        tones: list([any('one'), any('two')])
      });
      const node = rules([
        vardecl({ name: 'targetObject', value: targetObject })
      ]);
      setRulesContext(await node.eval(context));
      const refNode = ref({
        target: ref({ key: 'targetObject' }, { type: 'variable' }),
        key: quoted('tones')
      }, { type: 'index' });
      const sourceList = targetObject.value.tones;
      if (!(sourceList instanceof List)) {
        throw new Error('Expected source list');
      }

      const resolved = await refNode.resolve(context);

      expect(resolved.toTrimmedString()).toBe('one, two');
      expect(sourceList.toTrimmedString()).toBe('one, two');
      expect(sourceList.parent).not.toBe(refNode);
      expect(resolved.parent).not.toBe(refNode);
      expect(refNode.parent).toBeUndefined();
      expect(context.referenceStack).toBe(0);
    });

    it('keeps source-free public direct index container sources canonical', async () => {
      const sourceList = list([any('a'), any('b')]);
      sourceList.frozen = true;
      const targetArray = new JsArray([sourceList]);
      const root = rules([
        vardecl({ name: 'items', value: targetArray })
      ]);
      setRulesContext(await root.eval(context));
      const refNode = ref({
        target: ref({ key: 'items' }, { type: 'variable' }),
        key: 0
      }, { type: 'index' });

      const result = await refNode.resolve(context);

      expect(result).toBeInstanceOf(List);
      expect(result).toBe(sourceList);
      expect(result.toTrimmedString()).toBe('a, b');
      expect(sourceList.toTrimmedString()).toBe('a, b');
      if (result instanceof List) {
        expect(result.parent).not.toBe(refNode);
        expect(result.value).toHaveLength(sourceList.value.length);
        expect(sourceList.value).toHaveLength(2);
        expect(sourceList.frozen).toBe(true);
      }
    });

    it('keeps referenced source value containers canonical after resolve(context)', async () => {
      const value = list([
        any('one'),
        ref({ key: 'item' }, { type: 'variable' })
      ]);
      const node = rules([
        vardecl({
          name: any('item'),
          value: any('foo')
        }),
        vardecl({
          name: any('source'),
          value
        })
      ]);
      const evald = setRulesContext(await node.eval(context));

      expect(value.toTrimmedString()).toBe('one, $item');

      const refNode = ref({ key: 'source' }, { type: 'variable' });
      const resolved = await refNode.resolve(context);

      expect(resolved.render(context)).toBe('one, foo');
      expect(value.toTrimmedString()).toBe('one, $item');
      expect(refNode.toTrimmedString()).toBe('$source');
    });

    it('preserves rules-like variable references as shallow owned surfaces', async () => {
      const originalClone = RulesClass.prototype.clone;
      const originalInherit = RulesClass.prototype.inherit;
      let clonedRules = 0;
      let inheritedRules = 0;
      RulesClass.prototype.clone = function cloneForCounting(
        this: RulesClass,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        clonedRules++;
        return originalClone.apply(this, args);
      };
      const sourceDecl = decl({ name: 'color', value: any('blue') });
      const sourceValue = rules([sourceDecl]);
      RulesClass.prototype.inherit = function inheritForCounting(
        this: RulesClass,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === sourceValue) {
          inheritedRules++;
        }
        return originalInherit.apply(this, args);
      };
      const sourceBinding = vardecl({
        name: any('block'),
        value: sourceValue
      });
      const node = rules([
        sourceBinding
      ]);
      const evald = setRulesContext(await node.eval(context));

      try {
        const refNode = ref({ key: 'block' }, { type: 'variable', preserveRulesLike: true });
        const resolved = await refNode.eval(context);

        expect(resolved).toBeInstanceOf(RulesClass);
        if (!(resolved instanceof RulesClass)) {
          throw new Error('Expected Rules result');
        }
        expect(resolved).not.toBe(resolved.sourceNode);
        const resolvedSource = resolved.sourceNode;
        expect(resolvedSource).toBeInstanceOf(RulesClass);
        if (!(resolvedSource instanceof RulesClass)) {
          throw new Error('Expected Rules source');
        }
        expect(clonedRules).toBe(0);
        expect(inheritedRules).toBe(0);
        expect(resolved.value[0]).toBe(resolvedSource.value[0]);
        expect(context.referenceStack).toBe(0);
      } finally {
        RulesClass.prototype.clone = originalClone;
        RulesClass.prototype.inherit = originalInherit;
      }
    });

    it('renders rules-like variable references through shallow owned surfaces', async () => {
      const originalClone = RulesClass.prototype.clone;
      let clonedRules = 0;
      RulesClass.prototype.clone = function cloneForCounting(
        this: RulesClass,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        clonedRules++;
        return originalClone.apply(this, args);
      };
      const sourceDecl = decl({ name: 'color', value: any('blue') });
      const sourceValue = rules([sourceDecl]);
      const sourceBinding = vardecl({
        name: any('block'),
        value: sourceValue
      });
      const node = rules([
        sourceBinding
      ]);
      setRulesContext(await node.eval(context));

      try {
        const refNode = ref({ key: 'block' }, { type: 'variable', preserveRulesLike: true });
        const rendered = await Promise.resolve(refNode.render(context));

        expect(rendered).toContain('color: blue');
        expect(clonedRules).toBe(0);
        expect(sourceValue.value[0]).toBe(sourceDecl);
        expect(sourceValue.parent).toBe(sourceBinding);
        expect(context.referenceStack).toBe(0);
      } finally {
        RulesClass.prototype.clone = originalClone;
      }
    });

    it('keeps canonical rules-like sources unfrozen alongside preserved surfaces', async () => {
      const sourceValue = rules([
        decl({ name: 'color', value: any('blue') })
      ]);
      const node = rules([
        vardecl({
          name: any('block'),
          value: sourceValue
        })
      ]);
      setRulesContext(await node.eval(context));

      const resolved = await ref({ key: 'block' }, { type: 'variable', preserveRulesLike: true }).eval(context);
      expect(resolved).toBeInstanceOf(RulesClass);
      expect(resolved.sourceNode).toBeInstanceOf(RulesClass);
      expect(resolved.sourceNode?.frozen).toBe(false);
      expect(context.referenceStack).toBe(0);
    });

    it('keeps fallback value containers canonical after resolve(context)', async () => {
      const root = rules([
        vardecl({
          name: any('item'),
          value: any('foo')
        })
      ]);
      const evald = setRulesContext(await root.eval(context));

      const fallback = list([
        any('one'),
        ref({ key: 'item' }, { type: 'variable' })
      ]);
      const refNode = ref(
        { key: 'missing' },
        {
          type: 'variable',
          fallbackValue: fallback
        }
      );
      const resolved = await refNode.resolve(context);

      expect(resolved.render(context)).toBe('one, foo');
      expect(fallback.toTrimmedString()).toBe('one, $item');
      expect(refNode.toTrimmedString()).toBe('$missing');
    });

    it('does not copy childless scalar fallback values before resolve(context)', async () => {
      const originalCopy = Any.prototype.copy;
      const originalInherit = Any.prototype.inherit;
      let scalarCopies = 0;
      let scalarInherits = 0;
      Any.prototype.copy = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'red') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };

      try {
        const fallback = any('red');
        const fallbackParent = fallback.parent;
        Any.prototype.inherit = function inheritForCounting(
          this: Any,
          ...args: Parameters<typeof originalInherit>
        ): ReturnType<typeof originalInherit> {
          if (this === fallback) {
            scalarInherits++;
          }
          return originalInherit.apply(this, args);
        };
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );
        const resolved = await refNode.resolve(context);

        expect(resolved.toTrimmedString()).toBe('red');
        expect(scalarCopies).toBe(0);
        expect(scalarInherits).toBe(0);
        expect(fallback.frozen).toBe(false);
        expect(fallback.parent).toBe(fallbackParent);
        expect(refNode.toTrimmedString()).toBe('$missing');
      } finally {
        Any.prototype.copy = originalCopy;
        Any.prototype.inherit = originalInherit;
      }
    });

    it('renders scalar fallback values as text without applying public result metadata', async () => {
      const fallback = any('red');
      const fallbackParent = fallback.parent;
      const originalInherit = fallback.inherit;
      let inheritCalls = 0;
      fallback.inherit = function inheritForCounting(
        this: typeof fallback,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        inheritCalls++;
        return originalInherit.apply(this, args);
      };

      try {
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );

        expect(await Promise.resolve(refNode.render(context))).toBe('red');
        expect(inheritCalls).toBe(0);
        expect(fallback.parent).toBe(fallbackParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        fallback.inherit = originalInherit;
      }
    });

    it('renders source-free fallback containers as text without applying public result metadata', async () => {
      const fallback = list([any('red'), any('blue')]);
      const fallbackParent = fallback.parent;
      const originalInherit = fallback.inherit;
      let inheritCalls = 0;
      fallback.inherit = function inheritForCounting(
        this: typeof fallback,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        inheritCalls++;
        return originalInherit.apply(this, args);
      };

      try {
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );

        expect(await Promise.resolve(refNode.render(context))).toBe('red, blue');
        expect(inheritCalls).toBe(0);
        expect(fallback.parent).toBe(fallbackParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        fallback.inherit = originalInherit;
      }
    });

    it('renders dynamic JsExpression fallback scalars as text without copying the fallback node', async () => {
      const fallback = new JsExpression('"dynamic-red"');
      const fallbackParent = fallback.parent;
      const originalCopy = fallback.copy;
      let copyCalls = 0;
      fallback.copy = function copyForCounting(
        this: typeof fallback,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        copyCalls++;
        return originalCopy.apply(this, args);
      };

      try {
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );

        expect(await Promise.resolve(refNode.render(context))).toBe('dynamic-red');
        expect(copyCalls).toBe(0);
        expect(fallback.parent).toBe(fallbackParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        fallback.copy = originalCopy;
      }
    });

    it('resolves dynamic JsExpression fallback scalars without copying the fallback node', async () => {
      const fallback = new JsExpression('"dynamic-red"');
      const fallbackParent = fallback.parent;
      const originalCopy = fallback.copy;
      let copyCalls = 0;
      fallback.copy = function copyForCounting(
        this: typeof fallback,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        copyCalls++;
        return originalCopy.apply(this, args);
      };

      try {
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );

        const resolved = await refNode.resolve(context);

        expect(resolved.toTrimmedString()).toBe('dynamic-red');
        expect(copyCalls).toBe(0);
        expect(fallback.parent).toBe(fallbackParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        fallback.copy = originalCopy;
      }
    });

    it('renders source-backed static fallback containers as text without container copies', async () => {
      const fallback = list([any('red'), any('blue')]);
      fallback._location = [10, 1, 11, 20, 1, 21];
      const fallbackParent = fallback.parent;
      const originalCopy = List.prototype.copy;
      const originalInherit = List.prototype.inherit;
      let fallbackCopies = 0;
      let fallbackInherits = 0;
      List.prototype.copy = function copyForCounting(
        this: List,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === fallback) {
          fallbackCopies++;
        }
        return originalCopy.apply(this, args);
      };
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === fallback) {
          fallbackInherits++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );

        expect(await Promise.resolve(refNode.render(context))).toBe('red, blue');
        expect(fallbackCopies).toBe(0);
        expect(fallbackInherits).toBe(0);
        expect(fallback.parent).toBe(fallbackParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
      }
    });

    it('renders dynamic fallback containers as text without pre-copying the source container', async () => {
      const fallback = list([ref('tone', { type: 'variable' })]);
      fallback._location = [10, 1, 11, 20, 1, 21];
      const fallbackParent = fallback.parent;
      const originalCopy = List.prototype.copy;
      const originalInherit = List.prototype.inherit;
      let fallbackCopies = 0;
      let fallbackCopyInherits = 0;
      List.prototype.copy = function copyForCounting(
        this: List,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === fallback) {
          fallbackCopies++;
        }
        return originalCopy.apply(this, args);
      };
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === fallback) {
          fallbackCopyInherits++;
        }
        return originalInherit.apply(this, args);
      };
      const root = rules([
        vardecl({ name: 'tone', value: any('red') })
      ]);
      context.root = root;
      context.rulesContext = root;

      try {
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );

        expect(await Promise.resolve(refNode.render(context))).toBe('red');
        expect(fallbackCopies).toBe(0);
        expect(fallbackCopyInherits).toBe(0);
        expect(fallback.parent).toBe(fallbackParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
      }
    });

    it('resolves dynamic fallback containers without pre-copying the source container', async () => {
      const fallback = list([ref('tone', { type: 'variable' })]);
      fallback._location = [10, 1, 11, 20, 1, 21];
      const fallbackParent = fallback.parent;
      const originalCopy = List.prototype.copy;
      let fallbackCopies = 0;
      List.prototype.copy = function copyForCounting(
        this: List,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === fallback) {
          fallbackCopies++;
        }
        return originalCopy.apply(this, args);
      };
      const root = rules([
        vardecl({ name: 'tone', value: any('red') })
      ]);
      context.root = root;
      context.rulesContext = root;

      try {
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );

        const resolved = await refNode.resolve(context);

        expect(resolved.toTrimmedString()).toBe('red');
        expect(fallbackCopies).toBe(0);
        expect(fallback.parent).toBe(fallbackParent);
        expect(context.referenceStack).toBe(0);
      } finally {
        List.prototype.copy = originalCopy;
      }
    });

    it('restores reference stack after async fallback render', async () => {
      const fallback = new AsyncNativeRenderAny('red');
      const refNode = ref(
        { key: 'missing' },
        {
          type: 'variable',
          fallbackValue: fallback
        }
      );

      await expect(Promise.resolve(refNode.render(context))).resolves.toBe('rendered-red');
      expect(context.referenceStack).toBe(0);
    });

    it('does not clone childless source-free scalar leaves inside copied fallback containers', async () => {
      const originalClone = Any.prototype.clone;
      let scalarClones = 0;
      Any.prototype.clone = function cloneForCounting(
        this: Any,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.valueOf() === 'red') {
          scalarClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const fallback = list([any('red')]);
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );
        const resolved = await refNode.resolve(context);

        expect(resolved.toTrimmedString()).toBe('red');
        expect(scalarClones).toBe(0);
        expect(fallback.toTrimmedString()).toBe('red');
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('does not clone source-free fallback containers before resolving them', async () => {
      const originalClone = List.prototype.clone;
      let listClones = 0;
      List.prototype.clone = function cloneForCounting(
        this: List,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        listClones++;
        return originalClone.apply(this, args);
      };

      try {
        const fallback = list([any('red')]);
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );
        const resolved = await refNode.resolve(context);

        expect(resolved.toTrimmedString()).toBe('red');
        expect(listClones).toBe(0);
        expect(fallback.toTrimmedString()).toBe('red');
      } finally {
        List.prototype.clone = originalClone;
      }
    });

    it('reuses source-free static fallback lists as inert output containers', async () => {
      const fallback = list([any('red')]);
      const fallbackParent = fallback.parent;
      const originalInherit = List.prototype.inherit;
      let listInherits = 0;
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (this === fallback) {
          listInherits++;
        }
        return originalInherit.apply(this, args);
      };
      const refNode = ref(
        { key: 'missing' },
        {
          type: 'variable',
          fallbackValue: fallback
        }
      );

      try {
        const resolved = await refNode.resolve(context);

        expect(resolved).toBe(fallback);
        expect(resolved.toTrimmedString()).toBe('red');
        expect(listInherits).toBe(0);
        expect(fallback.frozen).toBe(false);
        expect(fallback.parent).toBe(fallbackParent);
        expect(refNode.toTrimmedString()).toBe('$missing');
      } finally {
        List.prototype.inherit = originalInherit;
      }
    });

    it('reuses source-free static fallback sequences as inert output containers', async () => {
      const fallback = spaced([any('red'), any('blue')]);
      const originalClone = Sequence.prototype.clone;
      let sequenceClones = 0;
      Sequence.prototype.clone = function cloneForCounting(
        this: Sequence,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        sequenceClones++;
        return originalClone.apply(this, args);
      };

      try {
        const refNode = ref(
          { key: 'missing' },
          {
            type: 'variable',
            fallbackValue: fallback
          }
        );

        const resolved = await refNode.resolve(context);

        expect(resolved).toBe(fallback);
        expect(resolved.toTrimmedString()).toBe('red blue');
        expect(sequenceClones).toBe(0);
        expect(refNode.toTrimmedString()).toBe('$missing');
      } finally {
        Sequence.prototype.clone = originalClone;
      }
    });

    it('preserves direct mixin-ruleset hits instead of returning the live canonical mixin', async () => {
      const mixinDef = mixin({
        name: any('.fast-mixin'),
        rules: rules([decl({ name: 'color', value: any('green') })])
      });
      const originalInherit = MixinClass.prototype.inherit;
      let inheritedMixins = 0;
      MixinClass.prototype.inherit = function inheritForCounting(
        this: MixinClass,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === mixinDef) {
          inheritedMixins++;
        }
        return originalInherit.apply(this, args);
      };
      const root = rules([mixinDef]);
      const evald = setRulesContext(await root.eval(context));

      try {
        const resolved = await ref({ key: '.fast-mixin' }, { type: 'mixin-ruleset' }).resolve(context);

        expect(resolved.type).toBe('MixinCollection');
        expect(resolved.value).toHaveLength(1);
        expect(resolved.value[0]).not.toBe(mixinDef);
        expect(resolved.value[0]!.type).toBe('Mixin');
        expect(resolved.value[0]!.sourceNode).toBe(mixinDef);
        expect(inheritedMixins).toBe(0);

        const resolvedAgain = resolved.resolve(context);

        expect(resolvedAgain).toBe(resolved);
        expect(resolved.evaluated).toBe(false);
        expect(resolved.registrationPrepared).toBe(false);
        expect(context.referenceStack).toBe(0);
      } finally {
        MixinClass.prototype.inherit = originalInherit;
      }
    });

    it('should get a variable from scope', async () => {
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        })
      ]);
      let evald = await node.eval(context);
      /** The var declaration will be removed when going to CSS */
      expect(await renderNodeToString(evald, context)).toBeString(`
        bar: red;
      `);
    });

    it('should get a property from scope via quoted index', async () => {
      let node = rules([
        decl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: quoted('foo') }, { type: 'index' })
        })
      ]);
      let evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        foo: red;
        bar: red;
      `);
    });

    it('does not clone childless source-free scalar leaves inside declaration reference containers', async () => {
      const node = rules([
        decl({
          name: any('src'),
          value: list([any('red')])
        })
      ]);
      const evaldRoot = setRulesContext(await node.eval(context));

      const originalClone = Any.prototype.clone;
      let scalarClones = 0;
      Any.prototype.clone = function cloneForCounting(
        this: Any,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.valueOf() === 'red') {
          scalarClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const resolved = await ref({ key: 'src' }, { type: 'declaration' }).resolve(context);

        expect(resolved.toTrimmedString()).toBe('red');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('reuses source-free static declaration reference containers during public resolve', async () => {
      const sourceValue = list([any('red')]);
      const node = rules([
        decl({
          name: any('src'),
          value: sourceValue
        })
      ]);
      const evaldRoot = setRulesContext(await node.eval(context));

      const originalCopy = List.prototype.copy;
      const originalInherit = List.prototype.inherit;
      let listCopies = 0;
      let listInherits = 0;
      List.prototype.copy = function copyForCounting(
        this: List,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this === sourceValue) {
          listCopies++;
        }
        return originalCopy.apply(this, args);
      };
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === sourceValue || args[0]?.type === 'Reference') {
          listInherits++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        const resolved = await ref({ key: 'src' }, { type: 'declaration' }).resolve(context);

        expect(resolved).toBe(sourceValue);
        expect(resolved.toTrimmedString()).toBe('red');
        expect(listCopies).toBe(0);
        expect(listInherits).toBe(0);
        expect(sourceValue.toTrimmedString()).toBe('red');
      } finally {
        List.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
      }
    });

    it('should get a var from scope below reference', async () => {
      let node = rules([
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        }),
        vardecl({
          name: any('foo'),
          value: any('red')
        })
      ]);
      let evald = await node.eval(context);
      /** The var declaration will be removed when going to CSS */
      expect(await renderNodeToString(evald, context)).toBeString(`
        bar: red;
      `);
    });

    it('should get a prop from scope below reference via quoted index', async () => {
      let node = rules([
        decl({
          name: any('bar'),
          value: ref({ key: quoted('foo') }, { type: 'index' })
        }),
        decl({
          name: any('foo'),
          value: any('red')
        })
      ]);
      let evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        bar: red;
        foo: red;
      `);
    });

    it('should resolve merged property lookups via quoted index inside a nested child scope', async () => {
      let node = rules([
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
            value: ref({ key: quoted('background-color') }, { type: 'index' })
          })
        ])
      ]);
      const child = node.value[2]!;
      child.parent = node;
      let evald = await node.eval(context);
      expect(evald.toTrimmedString()).toBeString(`
        background-color: red, foo;
        background: red, foo;
      `);
    });

    it('flattens merged declaration references without recopying copied leaves', async () => {
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
      const evald = setRulesContext(await node.eval(context));

      const originalCopy = Any.prototype.copy;
      let valueCopyCount = 0;
      Any.prototype.copy = function(this: Any, deep?: boolean, cloneFn?: (n: Node) => Node) {
        if (this.value === 'red' || this.value === 'foo') {
          valueCopyCount++;
        }
        return originalCopy.call(this, deep, cloneFn);
      };
      try {
        const resolved = await ref({ key: 'background-color' }, { type: 'declaration' }).resolve(context);

        expect(resolved.toTrimmedString()).toBe('red, foo');
        expect(valueCopyCount).toBe(0);
      } finally {
        Any.prototype.copy = originalCopy;
      }
    });

    it('should treat keyword index as variable lookup', async () => {
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'index' })
        })
      ]);
      let evald = await node.eval(context);
      /** The var declaration will be removed when going to CSS */
      expect(await renderNodeToString(evald, context)).toBeString(`
        bar: red;
      `);
    });

    it('should find a VarDeclaration via declaration type when both types exist', async () => {
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('foo'),
          value: any('blue')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'declaration' })
        })
      ]);
      let evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        foo: blue;
        bar: blue;
      `);
    });

    it('should find a Declaration via declaration type when both types exist', async () => {
      let node = rules([
        decl({
          name: any('foo'),
          value: any('blue')
        }),
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'declaration' })
        })
      ]);
      let evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        foo: blue;
        bar: red;
      `);
    });

    it('should find a variable via keyword index (not a property)', async () => {
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('foo'),
          value: any('blue')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'index' })
        })
      ]);
      let evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        foo: blue;
        bar: red;
      `);
    });

    it('should find a property via quoted index (not a variable)', async () => {
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('foo'),
          value: any('blue')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: quoted('foo') }, { type: 'index' })
        })
      ]);
      let evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        foo: blue;
        bar: blue;
      `);
    });

    it('should allow recursive referencing', async () => {
      /**
       * $foo: red;
       * $foo: $foo red;
       * bar: $foo;
       */
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        vardecl({
          name: any('foo'),
          value: spaced([expr(ref({ key: 'foo' }, { type: 'variable' })), any('red')])
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        })
      ]);
      let evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        bar: red red;
      `);
    });
  });

  describe('errors', () => {
    it('should throw if the variable is not defined', async () => {
      let node = rules([
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        })
      ]);
      await expect(async () => await node.eval(context)).rejects.toThrow();
    });

    it('plain lexical misses do not fall back to DeclarationRegistry.find when no child scopes are searchable', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'missing') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          decl({
            name: any('bar'),
            value: ref({ key: 'missing' }, { type: 'variable' })
          })
        ]);
        await expect(async () => await node.eval(context)).rejects.toThrow();
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('snapshot reads avoid DeclarationRegistry.find for covered same-frame source-order lookup', async () => {
      const originalFind = RulesClass.prototype.find;
      let declarationHits = 0;
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'color') {
          declarationHits++;
        }
        return originalFind.apply(this, args);
      };

      const node = rules([
        vardecl({ name: 'color', value: any('red') }),
        decl({
          name: any('seen'),
          value: ref({ key: 'color' }, { type: 'variable', readMode: 'snapshot' })
        }),
        vardecl({ name: 'color', value: any('blue') })
      ]);

      const css = await renderNodeToString(node, context);

      RulesClass.prototype.find = originalFind;
      expect(css).toBeString(`
        seen: red;
      `);
      expect(declarationHits).toBe(0);
    });

    it('static variable hits avoid Rules.find for covered binding-frame lookup', async () => {
      const originalFind = RulesClass.prototype.find;
      let declarationHits = 0;
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'color') {
          declarationHits++;
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({ name: 'color', value: any('red') }),
          decl({
            name: any('seen'),
            value: ref({ key: 'color' }, { type: 'variable' })
          })
        ]);

        const css = await renderNodeToString(node, context);

        expect(css).toBeString(`
          seen: red;
        `);
        expect(declarationHits).toBe(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('findVariable uses direct VarDeclaration lookup without opening DeclarationRegistry', async () => {
      const originalGetRegistry = RulesClass.prototype.getRegistry;
      const registryHits: string[] = [];
      RulesClass.prototype.getRegistry = function(...args: Parameters<typeof originalGetRegistry>) {
        const [type] = args;
        if (type === 'declaration') {
          registryHits.push(type);
        }
        return originalGetRegistry.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({ name: 'color', value: any('red') })
        ]);

        await node.eval(context);
        const found = node.findVariable('color');

        expect(found?.value.value.valueOf()).toBe('red');
        expect(registryHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.getRegistry = originalGetRegistry;
      }
    });

    it('findProperty uses direct Declaration lookup without opening DeclarationRegistry for unfiltered exact hits', async () => {
      const originalGetRegistry = RulesClass.prototype.getRegistry;
      const registryHits: string[] = [];
      RulesClass.prototype.getRegistry = function(...args: Parameters<typeof originalGetRegistry>) {
        const [type] = args;
        if (type === 'declaration') {
          registryHits.push(type);
        }
        return originalGetRegistry.apply(this, args);
      };

      try {
        const node = rules([
          decl({ name: any('color'), value: any('red') })
        ]);

        await node.eval(context);
        const found = node.findProperty('color');

        expect(found?.value.value.valueOf()).toBe('red');
        expect(registryHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.getRegistry = originalGetRegistry;
      }
    });

    it('findProperty uses direct Declaration lookup without opening DeclarationRegistry for covered unfiltered misses', async () => {
      const originalGetRegistry = RulesClass.prototype.getRegistry;
      const registryHits: string[] = [];
      RulesClass.prototype.getRegistry = function(...args: Parameters<typeof originalGetRegistry>) {
        const [type] = args;
        if (type === 'declaration') {
          registryHits.push(type);
        }
        return originalGetRegistry.apply(this, args);
      };

      try {
        const node = rules([
          decl({ name: any('color'), value: any('red') })
        ]);

        await node.eval(context);

        expect(node.findProperty('missing')).toBeUndefined();
        expect(registryHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.getRegistry = originalGetRegistry;
      }
    });

    it('unfiltered property references use direct Declaration lookup without opening DeclarationRegistry', async () => {
      const originalGetRegistry = RulesClass.prototype.getRegistry;
      const registryHits: string[] = [];
      RulesClass.prototype.getRegistry = function(...args: Parameters<typeof originalGetRegistry>) {
        const [type] = args;
        if (type === 'declaration') {
          registryHits.push(type);
        }
        return originalGetRegistry.apply(this, args);
      };

      try {
        const node = rules([
          decl({ name: any('color'), value: any('red') }),
          decl({
            name: any('seen'),
            value: ref({ key: 'color' }, { type: 'property' })
          })
        ]);

        const css = await renderNodeToString(node, context);

        expect(css).toBeString(`
          color: red;
          seen: red;
        `);
        expect(registryHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.getRegistry = originalGetRegistry;
      }
    });

    it('nested static variable hits build parent scope frames without Rules.find fallback', async () => {
      const originalFind = RulesClass.prototype.find;
      let declarationHits = 0;
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'color') {
          declarationHits++;
        }
        return originalFind.apply(this, args);
      };

      try {
        const childRules = rules([
          decl({
            name: any('seen'),
            value: ref({ key: 'color' }, { type: 'variable' })
          })
        ]);
        const root = rules([
          vardecl({ name: 'color', value: any('red') }),
          ruleset({
            selector: el('.scope'),
            rules: childRules
          })
        ]);
        context.root = root;
        context.rulesContext = childRules;

        const evald = await childRules.eval(context);
        const css = await renderNodeToString(evald, context);

        expect(css).toBeString(`
          seen: red;
        `);
        expect(declarationHits).toBe(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('plain lexical misses do not fall back when only later child rules could match', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'missing') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          decl({
            name: any('bar'),
            value: ref({ key: 'missing' }, { type: 'variable' })
          }),
          rules([
            vardecl({
              name: any('missing'),
              value: any('red')
            })
          ], {
            rulesVisibility: {
              VarDeclaration: 'public'
            }
          })
        ]);
        await expect(async () => await node.eval(new Context({ leakyRules: true }))).rejects.toThrow();
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('plain lexical misses ignore unresolved dynamic declaration names without declaration-registry fallback', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'missing') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'missing' }, { type: 'variable' })
          })
        ]);
        await expect(async () => await node.eval(context)).rejects.toThrow();
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('same-scope unresolved dynamic names before a static winner do not force declaration-registry fallback', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          vardecl({
            name: any('x'),
            value: any('blue')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);
        const evald = await node.eval(context);
        expect(await renderNodeToString(evald, context)).toBeString(`
          bar: blue;
        `);
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('same-scope unresolved dynamic names after a static winner do not force declaration-registry fallback', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: any('x'),
            value: any('blue')
          }),
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);
        const evald = await node.eval(context);
        expect(await renderNodeToString(evald, context)).toBeString(`
          bar: blue;
        `);
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('prunes stale pendingDeclarationNames entries when a dynamic name resolves after ScopeFrame creation', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        let node = rules([
          vardecl({
            name: any('suffix'),
            value: any('x')
          }),
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);

        // Force a pre-resolution frame snapshot so pendingDeclarationNames is populated first.
        node.getScopeFrame();

        node = await node.eval(context);
        expect(await renderNodeToString(node, context)).toBeString(`
          bar: red;
        `);
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('resolves dynamic declaration names that depend on earlier dynamic names', async () => {
      const node = rules([
        vardecl({
          name: any('first'),
          value: any('second')
        }),
        vardecl({
          name: interpolated({
            source: INTERPOLATION_PLACEHOLDER,
            replacements: [ref({ key: 'first' }, { type: 'variable' })]
          }),
          value: any('final')
        }),
        vardecl({
          name: interpolated({
            source: INTERPOLATION_PLACEHOLDER,
            replacements: [ref({ key: 'second' }, { type: 'variable' })]
          }),
          value: any('red')
        }),
        decl({
          name: any('color'),
          value: ref({ key: 'final' }, { type: 'variable' })
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        color: red;
      `);
    });

    it('retries declaration-name prep when a later declaration unlocks a lookup identity', async () => {
      const retryCounts = new Map<string, number>();
      const recordRegistrationPrep = (node: Node, label: string): void => {
        const original = node.prepareRegistration.bind(node);
        node.prepareRegistration = (ctx: Context) => {
          retryCounts.set(label, (retryCounts.get(label) ?? 0) + 1);
          return original(ctx);
        };
      };

      const dependent = vardecl({
        name: interpolated({
          source: INTERPOLATION_PLACEHOLDER,
          replacements: [ref({ key: 'second' }, { type: 'variable' })]
        }),
        value: any('red')
      });
      const provider = vardecl({
        name: interpolated({
          source: INTERPOLATION_PLACEHOLDER,
          replacements: [ref({ key: 'first' }, { type: 'variable' })]
        }),
        value: any('final')
      });
      recordRegistrationPrep(dependent, 'dependent');
      recordRegistrationPrep(provider, 'provider');

      const node = rules([
        vardecl({
          name: any('first'),
          value: any('second')
        }),
        dependent,
        provider,
        decl({
          name: any('color'),
          value: ref({ key: 'final' }, { type: 'variable' })
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        color: red;
      `);
      expect(retryCounts.get('dependent')).toBe(2);
      expect(retryCounts.get('provider')).toBe(1);
    });

    it('routes direct Rules.evalNode through registration prep', async () => {
      const node = rules([
        vardecl({
          name: any('first'),
          value: any('second')
        }),
        vardecl({
          name: interpolated({
            source: INTERPOLATION_PLACEHOLDER,
            replacements: [ref({ key: 'first' }, { type: 'variable' })]
          }),
          value: any('final')
        }),
        decl({
          name: any('color'),
          value: ref({ key: 'second' }, { type: 'variable' })
        })
      ]);

      const evald = await node.evalNode(context);

      expect(await renderNodeToString(evald, context)).toBeString(`
        color: final;
      `);
      expect(node.registrationPrepared).toBe(true);
    });

    it('promotes pending dynamic declarations that have already become static before lookup', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);

        const frame = node.getScopeFrame();
        const dynamicDecl = node.at(0)!;
        dynamicDecl.set('name', any('x'));

        const resolved = await node.at(1)!.eval(context);
        expect(resolved.toTrimmedString()).toBe('bar: red');
        expect(declarationHits).toHaveLength(0);
        expect(frame.pendingDeclarationNames).toHaveLength(0);
        expect(frame.declarationBucketsByName.get('x')?.at(-1)?.sourceNode).toBe(dynamicDecl);
        const promotedHit = lookupScopeFrameVariable(frame, 'x', {
          bailOnPendingDeclarations: true
        });
        expect(promotedHit.kind).toBe('declaration');
        expect(promotedHit.kind === 'declaration' && promotedHit.entry.sourceNode).toBe(dynamicDecl);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('ignores still-dynamic pending names even when they would be synchronously computable', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: any('suffix'),
            value: any('x')
          }),
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);

        const frame = node.getScopeFrame();
        context.rulesContext = node;
        await expect(async () => await node.at(2)!.eval(context)).rejects.toThrow();
        expect(declarationHits).toHaveLength(0);
        expect(frame.pendingDeclarationNames).toHaveLength(1);
      } finally {
        context.rulesContext = undefined;
        RulesClass.prototype.find = originalFind;
      }
    });

    it('rejects when pending dynamic names are still asynchronously unresolved', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [call({ name: ref({ key: 'async-name' }, { type: 'function' }) })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);
        node.register('function', new JsFunction({
          name: 'async-name',
          fn: async () => any('x')
        }));

        const frame = node.getScopeFrame();
        context.rulesContext = node;
        await expect(async () => await node.at(1)!.eval(context)).rejects.toThrow();
        expect(declarationHits).toHaveLength(0);
        expect(frame.pendingDeclarationNames).toHaveLength(1);
      } finally {
        context.rulesContext = undefined;
        RulesClass.prototype.find = originalFind;
      }
    });
  });

  describe('nested references for mixin-ruleset lookups', () => {
    it('should resolve quoted index property access on mixin-returned rules', async () => {
      const node = rules([
        mixin({
          name: any('.mk-map'),
          rules: rules([
            decl({ name: 'text', value: any('white') }),
            decl({ name: 'background', value: any('black') })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'p',
              value: call({
                name: ref({ key: '.mk-map' }, { type: 'mixin-ruleset' }),
                args: list([])
              })
            }),
            decl({
              name: 'color',
              value: ref({
                target: ref({ key: 'p' }, { type: 'variable' }),
                key: quoted('text')
              }, { type: 'index' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          color: white;
        }
      `);
    });

    it('should register and resolve escaped class selector via string key', async () => {
      const node = rules([
        ruleset({
          selector: el('.\\123'),
          rules: rules([
            decl({ name: 'a', value: any('ok') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: '.\\123' }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .\\123 {
          a: ok;
        }
        .out {
          a: ok;
        }
      `);
    });

    it('should register and resolve escaped id selector via selector key reference', async () => {
      const node = rules([
        ruleset({
          selector: el('#\\31a'),
          rules: rules([
            decl({ name: 'a', value: any('ok') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: el('#\\31a') }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        #\\31a {
          a: ok;
        }
        .out {
          a: ok;
        }
      `);
    });

    it('should register and resolve escaped compound path via array key reference', async () => {
      const node = rules([
        ruleset({
          selector: compound([el('.a'), el('.\\32b')]),
          rules: rules([
            decl({ name: 'a', value: any('ok') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({
                key: ['.a', '.\\32b']
              }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .a.\\32b {
          a: ok;
        }
        .out {
          a: ok;
        }
      `);
    });

    it('should resolve nested References: #theme → .dark → .navbar → .colors', async () => {
      // #theme {
      //   .dark {
      //     .navbar {
      //       .colors() {
      //         primary: red;
      //       }
      //     }
      //   }
      // }
      // .output {
      //   @colors: #theme.dark.navbar.colors();
      //   background: @colors[primary];
      // }
      const node = rules([
        ruleset({
          selector: el('#theme'),
          rules: rules([
            ruleset({
              selector: el('.dark'),
              rules: rules([
                ruleset({
                  selector: el('.navbar'),
                  rules: rules([
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('red') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  target: ref({
                    target: ref({
                      target: ref({ key: '#theme' }, { type: 'mixin-ruleset' }),
                      key: '.dark'
                    }, { type: 'mixin-ruleset' }),
                    key: '.navbar'
                  }, { type: 'mixin-ruleset' }),
                  key: '.colors'
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          background: red;
        }
      `);
    });

    it('should resolve compound selector as single Reference: #theme.dark.navbar.colors', async () => {
      // #theme.dark.navbar {
      //   .colors() {
      //     primary: red;
      //   }
      // }
      // .output {
      //   @colors: #theme.dark.navbar.colors();
      //   background: @colors[primary];
      // }
      const node = rules([
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            mixin({
              name: any('.colors'),
              rules: rules([
                decl({ name: 'primary', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  key: compound([el('#theme'), el('.dark'), el('.navbar'), el('.colors')])
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          background: red;
        }
      `);
    });

    it('should resolve string array as key: [\'#theme\', \'.dark\', \'.navbar\', \'.colors\']', async () => {
      // #theme.dark.navbar {
      //   .colors() {
      //     primary: red;
      //   }
      // }
      // .output {
      //   @colors: #theme.dark.navbar.colors();
      //   background: @colors[primary];
      // }
      const node = rules([
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            mixin({
              name: any('.colors'),
              rules: rules([
                decl({ name: 'primary', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  key: ['#theme', '.dark', '.navbar', '.colors']
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          background: red;
        }
      `);
    });

    it('should prefer a compound-prefix ruleset when a longer string array can continue inside it', async () => {
      const node = rules([
        mixin({
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('cyan') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            mixin({
              name: any('.colors'),
              rules: rules([
                decl({ name: 'primary', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  key: ['#theme', '.dark', '.navbar', '.colors']
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          background: red;
        }
      `);
    });

    it('fast-paths compound-prefix callable ruleset precedence', async () => {
      const node = rules([
        mixin({
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('cyan') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            mixin({
              name: any('.colors'),
              rules: rules([
                decl({ name: 'primary', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  key: ['#theme', '.dark', '.navbar', '.colors']
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          background: red;
        }
      `);
    });

    it('should resolve a mixin-ruleset call keyed by BasicSelector', async () => {
      const node = rules([
        mixin({
          name: any('.mixin-with-directives'),
          params: list([any('keyframeName', { role: 'property' })]),
          rules: rules([
            atrule({
              name: any('@keyframes'),
              prelude: ref({ key: 'keyframeName' }, { type: 'variable' }),
              rules: rules([
                decl({ name: 'property', value: any('value') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: el('.mixin-with-directives') }, { type: 'mixin-ruleset' }),
              args: list([any('some-name')])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toContain('@keyframes some-name');
    });

    it('should resolve a mixin-ruleset call keyed by a compound selector path array', async () => {
      const node = rules([
        ruleset({
          selector: compound([
            el('.b'),
            el('.bb'),
            el('.foo-xxx'),
            el('.yyy-foo'),
            el('#foo'),
            el('.foo'),
            el('.bbb')
          ]),
          rules: rules([
            decl({ name: 'b', value: any('1') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({
                key: ['.b', '.bb', '.foo-xxx', '.yyy-foo', '#foo', '.foo', '.bbb']
              }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .b.bb.foo-xxx.yyy-foo#foo.foo.bbb {
          b: 1;
        }
        .out {
          b: 1;
        }
      `);
    });

    it('fast-paths exact callable ruleset array paths when no namespace start exists', async () => {
      const node = rules([
        ruleset({
          selector: compound([
            el('.b'),
            el('.bb'),
            el('.foo-xxx'),
            el('.yyy-foo'),
            el('#foo'),
            el('.foo'),
            el('.bbb')
          ]),
          rules: rules([
            decl({ name: 'b', value: any('1') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({
                key: ['.b', '.bb', '.foo-xxx', '.yyy-foo', '#foo', '.foo', '.bbb']
              }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .b.bb.foo-xxx.yyy-foo#foo.foo.bbb {
          b: 1;
        }
        .out {
          b: 1;
        }
      `);
    });

    it('keeps static compound reference path arrays as binding identity', async () => {
      const originalFindMixin = RulesClass.prototype.findMixin;
      const path = ['.a', '.b', '.c'];
      const pathIdentityHits: boolean[] = [];
      RulesClass.prototype.findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        const [key] = args;
        if (
          Array.isArray(key)
          && key.length === path.length
          && key[0] === path[0]
        ) {
          pathIdentityHits.push(key === path);
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        const node = rules([
          ruleset({
            selector: compound([el('.a'), el('.b'), el('.c')]),
            rules: rules([
              decl({ name: 'color', value: any('blue') })
            ])
          }),
          ruleset({
            selector: el('.out'),
            rules: rules([
              call({
                name: ref({ key: path }, { type: 'mixin-ruleset' })
              })
            ])
          })
        ]);

        const evald = await node.eval(context);

        expect(await renderNodeToString(evald, context)).toBeString(`
          .a.b.c {
            color: blue;
          }
          .out {
            color: blue;
          }
        `);
        expect(pathIdentityHits).toContain(true);
        expect(pathIdentityHits).not.toContain(false);
      } finally {
        RulesClass.prototype.findMixin = originalFindMixin;
      }
    });

    it('reuses static callable binding handles until the target rules version changes', async () => {
      const originalFindMixin = RulesClass.prototype.findMixin;
      const path = ['.a', '.b', '.c'];
      let pathLookups = 0;
      RulesClass.prototype.findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        const [key] = args;
        if (key === path) {
          pathLookups++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        const node = rules([
          ruleset({
            selector: compound([el('.a'), el('.b'), el('.c')]),
            rules: rules([
              decl({ name: 'color', value: any('blue') })
            ])
          })
        ]);
        setRulesContext(await node.eval(context));
        const lookupRef = ref({ key: path }, { type: 'mixin-ruleset' });

        const first = lookupRef.eval(context);
        expect(isNode(first)).toBe(true);
        if (isNode(first)) {
          expect(first.type).toBe('MixinCollection');
        }
        expect(pathLookups).toBe(1);

        const second = lookupRef.eval(context);
        expect(isNode(second)).toBe(true);
        if (isNode(second)) {
          expect(second.type).toBe('MixinCollection');
        }
        expect(pathLookups).toBe(1);

        node.push(decl({ name: 'unrelated', value: any('1') }));
        const third = lookupRef.eval(context);
        expect(isNode(third)).toBe(true);
        if (isNode(third)) {
          expect(third.type).toBe('MixinCollection');
        }
        expect(pathLookups).toBe(2);
      } finally {
        RulesClass.prototype.findMixin = originalFindMixin;
      }
    });

    it('reuses static function binding handles until the target rules version changes', async () => {
      const originalFindFunction = RulesClass.prototype.findFunction;
      let functionLookups = 0;
      RulesClass.prototype.findFunction = function(...args: Parameters<typeof originalFindFunction>) {
        const [key] = args;
        if (key === 'paint') {
          functionLookups++;
        }
        return originalFindFunction.apply(this, args);
      };

      try {
        const node = rules([]);
        node.register('function', new JsFunction({
          name: 'paint',
          fn: () => any('blue')
        }));
        setRulesContext(await node.eval(context));
        const lookupRef = ref({ key: 'paint' }, { type: 'function' });

        const first = lookupRef.eval(context);
        expect(isNode(first)).toBe(true);
        if (isNode(first)) {
          expect(first.type).toBe('JsFunction');
        }
        expect(functionLookups).toBe(1);

        const second = lookupRef.eval(context);
        expect(isNode(second)).toBe(true);
        if (isNode(second)) {
          expect(second.type).toBe('JsFunction');
        }
        expect(functionLookups).toBe(1);

        node.push(decl({ name: 'unrelated', value: any('1') }));
        const third = lookupRef.eval(context);
        expect(isNode(third)).toBe(true);
        if (isNode(third)) {
          expect(third.type).toBe('JsFunction');
        }
        expect(functionLookups).toBe(2);
      } finally {
        RulesClass.prototype.findFunction = originalFindFunction;
      }
    });

    it('reuses static property binding handles until the target rules version changes', async () => {
      const originalFindProperty = RulesClass.prototype.findProperty;
      let propertyLookups = 0;
      RulesClass.prototype.findProperty = function(...args: Parameters<typeof originalFindProperty>) {
        const [key] = args;
        if (key === 'color') {
          propertyLookups++;
        }
        return originalFindProperty.apply(this, args);
      };

      try {
        const node = rules([
          decl({ name: 'color', value: any('blue') })
        ]);
        setRulesContext(await node.eval(context));
        const lookupRef = ref({ key: 'color' }, { type: 'property' });

        expect(lookupRef.eval(context).valueOf()).toBe('blue');
        expect(propertyLookups).toBe(1);

        expect(lookupRef.eval(context).valueOf()).toBe('blue');
        expect(propertyLookups).toBe(1);

        node.push(decl({ name: 'unrelated', value: any('1') }));
        expect(lookupRef.eval(context).valueOf()).toBe('blue');
        expect(propertyLookups).toBe(2);
      } finally {
        RulesClass.prototype.findProperty = originalFindProperty;
      }
    });

    it('reuses static declaration binding handles until the target rules version changes', async () => {
      const originalFindDeclaration = RulesClass.prototype.findDeclaration;
      let declarationLookups = 0;
      RulesClass.prototype.findDeclaration = function(...args: Parameters<typeof originalFindDeclaration>) {
        const [key] = args;
        if (key === 'color') {
          declarationLookups++;
        }
        return originalFindDeclaration.apply(this, args);
      };

      try {
        const node = rules([
          decl({ name: 'color', value: any('blue') })
        ]);
        setRulesContext(await node.eval(context));
        const lookupRef = ref({ key: 'color' }, { type: 'declaration' });

        expect(lookupRef.eval(context).valueOf()).toBe('blue');
        expect(declarationLookups).toBe(1);

        expect(lookupRef.eval(context).valueOf()).toBe('blue');
        expect(declarationLookups).toBe(1);

        node.push(decl({ name: 'unrelated', value: any('1') }));
        expect(lookupRef.eval(context).valueOf()).toBe('blue');
        expect(declarationLookups).toBe(2);
      } finally {
        RulesClass.prototype.findDeclaration = originalFindDeclaration;
      }
    });

    it('should resolve a mixin-ruleset call keyed by a complex selector while ignoring namespace separators', async () => {
      const node = rules([
        ruleset({
          selector: sel([el('#foo-foo')]),
          rules: rules([
            ruleset({
              selector: sel([co('>'), compound([el('.bar'), el('.baz')])]),
              rules: rules([
                decl({ name: 'c', value: any('c') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({
                key: sel([el('#foo-foo'), co('>'), compound([el('.bar'), el('.baz')])])
              }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        #foo-foo {
          > .bar.baz {
            c: c;
          }
        }
        .out {
          c: c;
        }
      `);
    });

    it('fast-paths complex selector callable ruleset paths under a ruleset namespace prefix', async () => {
      const node = rules([
        ruleset({
          selector: sel([el('#foo-foo')]),
          rules: rules([
            ruleset({
              selector: sel([co('>'), compound([el('.bar'), el('.baz')])]),
              rules: rules([
                decl({ name: 'c', value: any('c') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({
                key: sel([el('#foo-foo'), co('>'), compound([el('.bar'), el('.baz')])])
              }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        #foo-foo {
          > .bar.baz {
            c: c;
          }
        }
        .out {
          c: c;
        }
      `);
    });

    it('should resolve nested mixin-ruleset reference chains through nested mixins', async () => {
      // #theme {
      //   .dark {
      //     .navbar() {
      //       .colors() {
      //         primary: cyan;
      //       }
      //     }
      //   }
      // }
      // #theme.dark.navbar {
      //   .colors() {
      //     primary: red;
      //   }
      // }
      // .output {
      //   @colors: #theme.dark.navbar.colors();
      //   background: @colors[primary];
      // }
      // Because this is a nested reference chain, it should keep traversing the
      // nested mixin namespace and resolve primary: cyan.
      const node = rules([
        mixin({
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('cyan') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            mixin({
              name: any('.colors'),
              rules: rules([
                decl({ name: 'primary', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  target: ref({
                    target: ref({
                      target: ref({ key: '#theme' }, { type: 'mixin-ruleset' }),
                      key: '.dark'
                    }, { type: 'mixin-ruleset' }),
                    key: '.navbar'
                  }, { type: 'mixin-ruleset' }),
                  key: '.colors'
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          background: cyan;
        }
      `);
    });

    it('fast-paths pure nested no-arg mixin namespace array paths', async () => {
      const node = rules([
        mixin({
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('cyan') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  key: ['#theme', '.dark', '.navbar', '.colors']
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          background: cyan;
        }
      `);
    });

    it('does not fall back for unrelated rulesets that only share the first namespace segment', async () => {
      const node = rules([
        mixin({
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('cyan') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: compound([el('#theme'), el('.warning')]),
          rules: rules([
            mixin({
              name: any('.palette'),
              rules: rules([
                decl({ name: 'primary', value: any('orange') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  key: ['#theme', '.dark', '.navbar', '.colors']
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          background: cyan;
        }
      `);
    });

    it('fast-paths terminal rulesets under pure nested no-arg mixin namespaces', async () => {
      const node = rules([
        mixin({
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    ruleset({
                      selector: el('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('cyan') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  key: ['#theme', '.dark', '.navbar', '.colors']
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          background: cyan;
        }
      `);
    });

    it('fast-paths compound-prefix precedence even when a competing namespace hop requires args', async () => {
      const node = rules([
        mixin({
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              params: list([any('mode', { role: 'property' })]),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('cyan') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            mixin({
              name: any('.colors'),
              rules: rules([
                decl({ name: 'primary', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  key: ['#theme', '.dark', '.navbar', '.colors']
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(await renderNodeToString(evald, context)).toBeString(`
        .output {
          background: red;
        }
      `);
    });

    it('treats required-arg intermediate namespace hops as definite misses when no compound-prefix ruleset is involved', () => {
      const node = rules([
        mixin({
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              params: list([any('mode', { role: 'property' })]),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('cyan') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        })
      ]);

      context.root = node;
      context.rulesContext = node;

      const result = node.findMixin(['#theme', '.dark', '.navbar', '.colors'], undefined, {
        context
      });

      expect(result).toBeUndefined();
    });

    it('fast-paths definite namespace array-path misses', () => {
      const node = rules([
        mixin({
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('cyan') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        })
      ]);

      context.root = node;
      context.rulesContext = node;

      const result = node.findMixin(['#theme', '.dark', '.missing', '.colors'], undefined, {
        context
      });

      expect(result).toBeUndefined();
    });
  });
});
