import { ref, rules, decl, vardecl, spaced, any, quoted, expr, ruleset, mixin, call, compound, el, list, atrule, sel, co, interpolated, interpolatedSelector, INTERPOLATION_PLACEHOLDER, Rules as RulesClass, Mixin as MixinClass, Reference, VarDeclaration, Any, List, Sequence, Dimension, dimension, JsArray, JsObject, JsFunction, AssignmentType, F_MAY_ASYNC, F_NON_STATIC, defaultguard, type Node } from '../index.js';
import { Context } from '../../context.js';
import type { ReferenceOptions } from '../reference.js';
import { isNode } from '../util/is-node.js';
import { getPrintOptions, OutputWriter } from '../util/print.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { buildScopeFrame, lookupScopeFrameVariable, setScopeFrameLiveBinding } from '../scope-frame.js';
import {
  findPropertyDeclarationOccurrence,
  findVariableDeclarationOccurrence
} from '../util/direct-rules-lookup.js';
let context: Context;
let expectedAsyncRulesContext: RulesClass | undefined;

function getDirectDeclarationOwnerLookupVersion(value: unknown): number | undefined {
  if (
    value
    && typeof value === 'object'
    && 'kind' in value
    && value.kind === 'direct-declaration-occurrence'
    && 'ownerLookupVersion' in value
    && typeof value.ownerLookupVersion === 'number'
  ) {
    return value.ownerLookupVersion;
  }
  return undefined;
}

function getDirectDeclarationSlot(value: unknown): number | undefined {
  if (
    value
    && typeof value === 'object'
    && 'kind' in value
    && value.kind === 'direct-declaration-occurrence'
    && 'slot' in value
    && typeof value.slot === 'number'
  ) {
    return value.slot;
  }
  return undefined;
}

function setRulesContext(root: Node): RulesClass {
  expect(root).toBeInstanceOf(RulesClass);
  if (!(root instanceof RulesClass)) {
    throw new Error('Expected Rules root');
  }
  context.root = root;
  context.rulesContext = root;
  return root;
}

function expectNodeType(value: unknown, type: string): void {
  expect(isNode(value)).toBe(true);
  if (isNode(value)) {
    expect(value.type).toBe(type);
  }
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

class RejectingAsyncAny extends Any<string> {
  constructor(value: string) {
    super(value);
    this.addFlags(F_MAY_ASYNC, F_NON_STATIC);
  }

  override eval() {
    return Promise.reject(new Error(this.value));
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

    it('writes node reference keys without public string transport', () => {
      const key = quoted('foo');
      key.toString = () => {
        throw new Error('Reference key syntax should use writeSyntax directly');
      };
      const node = ref({ key }, { type: 'index' });

      expect(node.toTrimmedString()).toBe('$["foo"]');
    });

    it('writes reference targets without public string transport', () => {
      const target = ref({ key: 'theme' }, { type: 'variable' });
      target.toString = () => {
        throw new Error('Reference target syntax should use writeSyntax directly');
      };
      const node = ref({ target, key: 'color' }, { type: 'property' });

      expect(node.toTrimmedString()).toBe('$theme[color]');
    });

    it('writes array reference key segments directly', () => {
      const chunks: string[] = [];
      const writer = new OutputWriter(false, chunks);
      const node = ref({ key: ['#theme', '.dark'] }, { type: 'index' });

      node.writeSyntax(getPrintOptions({ writer }));

      expect(chunks).toEqual(['$', '[', '#theme', '.dark', ']']);
    });

    it('serializes reference source syntax through writeSyntax ownership', () => {
      const originalWriteSyntax = Reference.prototype.writeSyntax;
      let writeSyntaxCalls = 0;
      Reference.prototype.writeSyntax = function countWriteSyntax(
        this: Reference,
        ...args: Parameters<typeof originalWriteSyntax>
      ): ReturnType<typeof originalWriteSyntax> {
        writeSyntaxCalls++;
        return originalWriteSyntax.apply(this, args);
      };
      const node = ref({ key: 'foo' }, { type: 'variable' });

      try {
        expect(node.toTrimmedString()).toBe('$foo');
        expect(writeSyntaxCalls).toBe(1);
      } finally {
        Reference.prototype.writeSyntax = originalWriteSyntax;
      }
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

    it('restores runtime binding frames when async live-slot value eval rejects', async () => {
      const definitionRules = rules([]);
      const paramDecl = vardecl({ name: any('tone'), value: any('blue') }, { paramVar: true });
      definitionRules.push(paramDecl);
      const asyncValue = new RejectingAsyncAny('runtime binding failed');
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

      await expect(ref({ key: 'tone' }, { type: 'variable' }).eval(context)).rejects.toThrow('runtime binding failed');
      expect(context.rulesContext).toBe(runtimeScope);
      expect(context.searchScope.has(paramDecl)).toBe(false);
      expect(context.referenceStack).toBe(0);
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

    it('does not rediscover fallback-frame parent declarations after covered misses', async () => {
      const fallbackParent = rules([
        vardecl({ name: any('tone'), value: any('blue') })
      ]);
      const originalValue = fallbackParent.value;

      try {
        const fallbackChild = rules([]);
        fallbackParent.push(fallbackChild);
        await fallbackParent.eval(context);
        const runtimeScope = rules([]);
        await runtimeScope.eval(context);
        fallbackChild.scopeFrame = buildScopeFrame(undefined, fallbackChild);
        const fallbackFrame = fallbackChild.getScopeFrame();
        runtimeScope.getScopeFrame().fallbackFrame = fallbackFrame;
        context.rulesContext = runtimeScope;

        Object.defineProperty(fallbackParent, 'value', {
          configurable: true,
          get() {
            throw new Error('covered fallback-frame miss should not rediscover fallback parent declarations');
          }
        });

        const resolved = await ref({
          key: 'tone'
        }, {
          type: 'variable',
          fallbackValue: any('fallback')
        }).eval(context);

        expect(resolved.toTrimmedString()).toBe('fallback');
      } finally {
        Object.defineProperty(fallbackParent, 'value', {
          configurable: true,
          writable: true,
          value: originalValue
        });
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

    it('restores declaration reference frames when async value eval rejects', async () => {
      const declaration = decl({
        name: any('src'),
        value: list([new RejectingAsyncAny('declaration reference failed')])
      });
      const node = rules([declaration]);
      setRulesContext(node);

      await expect(ref({ key: 'src' }, { type: 'declaration' }).eval(context)).rejects.toThrow('declaration reference failed');
      expect(context.searchScope.has(declaration)).toBe(false);
      expect(context.referenceStack).toBe(0);
    });

    it('restores important source when async important declaration reference rejects', async () => {
      const declaration = decl({
        name: any('src'),
        value: list([new RejectingAsyncAny('important declaration failed')]),
        important: any('!important', { role: 'flag' })
      });
      const node = rules([declaration]);
      setRulesContext(node);

      await expect(ref({ key: 'src' }, { type: 'declaration' }).eval(context)).rejects.toThrow('important declaration failed');
      expect(context.hasImportantSource).toBe(false);
      expect(context.searchScope.has(declaration)).toBe(false);
      expect(context.referenceStack).toBe(0);
    });

    it('restores declaration reference frames when async merged finalization throws', async () => {
      const declaration = decl({
        name: any('src'),
        value: list([new AsyncNativeRenderAny('red'), any('blue')]),
        important: any('!important', { role: 'flag' })
      }, { normalizedFromAssign: '+:' });
      const node = rules([declaration]);
      setRulesContext(node);
      const refNode = ref({ key: 'src' }, { type: 'declaration' });

      const originalInherit = List.prototype.inherit;
      List.prototype.inherit = function throwingInherit(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] !== refNode) {
          return originalInherit.apply(this, args);
        }
        throw new Error('merged finalization failed');
      };
      try {
        await expect(refNode.eval(context)).rejects.toThrow('merged finalization failed');
        expect(context.hasImportantSource).toBe(false);
        expect(context.searchScope.has(declaration)).toBe(false);
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

    it('index references use typed declaration lanes without generic declaration fallback', async () => {
      const node = rules([
        vardecl({ name: 'tone-var', value: any('purple') }),
        decl({ name: 'tone', value: any('orange') }),
        decl({
          name: any('seen-var'),
          value: ref({ key: 'tone-var' }, { type: 'index' })
        }),
        decl({
          name: any('seen-prop'),
          value: ref({ key: quoted('tone') }, { type: 'index' })
        })
      ]);

      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        tone: orange;
        seen-var: purple;
        seen-prop: orange;
      `);
    });

    it('direct Rules index targets use typed declaration lanes without generic declaration fallback', async () => {
      const targetRules = rules([
        decl({ name: 'tone', value: any('orange') }),
        vardecl({ name: 'toneVar', value: any('purple') })
      ]);
      const node = rules([
        vardecl({ name: 'targetRules', value: targetRules })
      ]);
      setRulesContext(await node.eval(context));

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

    it('direct Rules index target reads clear stale handles without handle strategy prep', async () => {
      const targetRules = rules([
        decl({ name: 'tone', value: any('orange') }),
        vardecl({ name: 'toneVar', value: any('purple') })
      ]);
      const node = rules([
        vardecl({ name: 'targetRules', value: targetRules }),
        vardecl({ name: 'seed', value: any('blue') })
      ]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: 'seed' }, { type: 'variable' });

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle?.lookupType).toBe('variable');

      const indexRef = ref({
        target: ref({ key: 'targetRules' }, { type: 'variable' }),
        key: quoted('tone')
      }, { type: 'index' });
      indexRef._rulesLookupHandle = lookupRef._rulesLookupHandle;

      expect(indexRef.eval(context).valueOf()).toBe('orange');
      expect(indexRef._rulesLookupHandle).toBeUndefined();
      expect(indexRef._lookupStrategy?.lookupType).toBe('index');
      expect(context.referenceStack).toBe(0);
    });

    it('direct Rules index target occurrences re-read after owner mutation', async () => {
      const targetRules = rules([
        decl({ name: 'tone', value: any('orange') }),
        vardecl({ name: 'toneVar', value: any('purple') })
      ]);
      const node = rules([
        vardecl({ name: 'targetRules', value: targetRules })
      ]);
      setRulesContext(await node.eval(context));
      const propertyRef = ref({
        target: ref({ key: 'targetRules' }, { type: 'variable' }),
        key: quoted('tone')
      }, { type: 'index' });
      const variableRef = ref({
        target: ref({ key: 'targetRules' }, { type: 'variable' }),
        key: 'toneVar'
      }, { type: 'index' });

      expect(propertyRef.eval(context).valueOf()).toBe('orange');
      expect(variableRef.eval(context).valueOf()).toBe('purple');

      targetRules.push(decl({ name: 'tone', value: any('green') }));
      targetRules.push(vardecl({ name: 'toneVar', value: any('blue') }));

      expect(propertyRef.eval(context).valueOf()).toBe('green');
      expect(variableRef.eval(context).valueOf()).toBe('blue');
    });

    it('explicit target variable refs use occurrence fallback without public Rules variable facade', async () => {
      const targetRules = rules([
        vardecl({ name: 'toneVar', value: any('purple') })
      ]);
      const node = rules([
        vardecl({ name: 'targetRules', value: targetRules })
      ]);
      setRulesContext(await node.eval(context));
      const variableRef = ref({
        target: ref({ key: 'targetRules' }, { type: 'variable' }),
        key: 'toneVar'
      }, { type: 'variable' });

      expect(variableRef.eval(context).valueOf()).toBe('purple');

      targetRules.push(vardecl({ name: 'toneVar', value: any('blue') }));

      expect(variableRef.eval(context).valueOf()).toBe('blue');
    });

    it('explicit target variable fallback uses carried declaration child entries', async () => {
      const childRules = rules([
        vardecl({ name: 'target-color', value: any('blue') })
      ]);
      const targetRules = rules([
        childRules
      ]);
      const node = rules([
        vardecl({ name: 'targetRules', value: targetRules })
      ]);
      setRulesContext(await node.eval(context));

      targetRules.collectDirectDeclarationChildEntries();
      targetRules.getScopeFrame();
      childRules.getScopeFrame();

      expect('_rulesSet' in targetRules).toBe(false);
      await expect(Promise.resolve(ref({
        target: ref({ key: 'targetRules' }, { type: 'variable' }),
        key: 'target-color'
      }, { type: 'variable' }).render(context))).resolves.toBe('blue');
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
        expect(result.items).toHaveLength(sourceList.items.length);
        expect(sourceList.items).toHaveLength(2);
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

    it('restores reference stack when async fallback render rejects', async () => {
      const fallback = new RejectingAsyncAny('fallback failed');
      const refNode = ref(
        { key: 'missing' },
        {
          type: 'variable',
          fallbackValue: fallback
        }
      );

      await expect(Promise.resolve(refNode.render(context))).rejects.toThrow('fallback failed');
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

    it('materializes mixin reference targets without double-inheriting evaluated rules', async () => {
      const mixinRules = rules([
        decl({ name: 'color', value: any('green') })
      ]);
      const mixinDef = mixin({
        name: any('.box'),
        rules: mixinRules
      });
      const root = rules([
        vardecl({ name: 'target', value: mixinDef }),
        decl({
          name: 'out',
          value: ref({
            target: ref({ key: 'target' }, { type: 'variable' }),
            key: quoted('color')
          }, { type: 'index' })
        })
      ]);
      const originalInherit = RulesClass.prototype.inherit;
      let inheritedFromMixinRules = 0;
      RulesClass.prototype.inherit = function inheritForCounting(
        this: RulesClass,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] === mixinRules) {
          inheritedFromMixinRules++;
        }
        return originalInherit.apply(this, args);
      };

      try {
        const evald = setRulesContext(await root.eval(context));

        expect(await renderNodeToString(evald, context)).toBeString(`
          out: green;
        `);
        expect(inheritedFromMixinRules).toBe(1);
        expect(context.referenceStack).toBe(0);
      } finally {
        RulesClass.prototype.inherit = originalInherit;
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

    it('normalizes exact Any declaration keys without calling key valueOf()', async () => {
      const keyNode = any('foo');
      keyNode.valueOf = () => {
        throw new Error('reference key should not call Any.valueOf()');
      };
      const node = rules([
        decl({
          name: any('foo'),
          value: any('blue')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: keyNode }, { type: 'declaration' })
        })
      ]);

      const evald = await node.eval(context);

      expect(await renderNodeToString(evald, context)).toBeString(`
        foo: blue;
        bar: blue;
      `);
    });

    it('normalizes exact quoted index keys without calling key valueOf()', async () => {
      const keyNode = quoted('foo');
      keyNode.valueOf = () => {
        throw new Error('reference key should not call Quoted.valueOf()');
      };
      const node = rules([
        decl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: keyNode }, { type: 'index' })
        })
      ]);

      const evald = await node.eval(context);

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

    it('reuses already-normalized static merged declaration values during public resolve', async () => {
      const sourceValue = list([any('red'), any('foo')]);
      const node = rules([
        decl({
          name: any('background-color'),
          value: sourceValue
        }, { normalizedFromAssign: '+:' })
      ]);

      const originalInherit = List.prototype.inherit;
      const originalCopy = List.prototype.copy;
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
      const refNode = ref({ key: 'background-color' }, { type: 'declaration' });
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (this === sourceValue || args[0] === sourceValue || args[0] === refNode) {
          listInherits++;
        }
        return originalInherit.apply(this, args);
      };
      try {
        const evald = setRulesContext(await node.eval(context));
        const evaluatedDecl = evald.value[0];
        expect(evaluatedDecl?.type).toBe('Declaration');
        if (evaluatedDecl?.type !== 'Declaration') {
          return;
        }
        const evaluatedValue = evaluatedDecl.valueNode;
        listCopies = 0;
        listInherits = 0;
        const resolved = await refNode.resolve(context);

        expect(resolved).toBe(evaluatedValue);
        expect(resolved.toTrimmedString()).toBe('red, foo');
        expect(listCopies).toBe(0);
        expect(listInherits).toBe(0);
      } finally {
        List.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
      }
    });

    it('flattens merged declaration references that still need normalization without recopying copied leaves', async () => {
      const sourceValue = list([list([any('red')]), any('foo')]);
      const node = rules([
        decl({
          name: any('background-color'),
          value: sourceValue
        }, { normalizedFromAssign: '+:' })
      ]);

      const originalCopy = Any.prototype.copy;
      const originalInherit = List.prototype.inherit;
      let valueCopyCount = 0;
      let latestCopiedList: List | undefined;
      let finalizedList: List | undefined;
      Any.prototype.copy = function(this: Any, deep?: boolean, cloneFn?: (n: Node) => Node) {
        if (this.value === 'red' || this.value === 'foo') {
          valueCopyCount++;
        }
        return originalCopy.call(this, deep, cloneFn);
      };
      const refNode = ref({ key: 'background-color' }, { type: 'declaration' });
      List.prototype.inherit = function inheritForCounting(
        this: List,
        ...args: Parameters<typeof originalInherit>
      ): ReturnType<typeof originalInherit> {
        if (args[0] instanceof List) {
          latestCopiedList = this;
        } else if (args[0] === refNode) {
          finalizedList = this;
        }
        return originalInherit.apply(this, args);
      };
      try {
        setRulesContext(await node.eval(context));
        const resolved = await refNode.resolve(context);

        expect(resolved.toTrimmedString()).toBe('red, foo');
        expect(valueCopyCount).toBe(0);
        expect(latestCopiedList).toBeDefined();
        expect(finalizedList).toBeDefined();
      } finally {
        Any.prototype.copy = originalCopy;
        List.prototype.inherit = originalInherit;
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

    it('plain lexical misses do not fall back to broad declaration find when no child scopes are searchable', async () => {
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

    it('snapshot reads avoid broad declaration find for covered same-frame source-order lookup', async () => {
      const originalFind = RulesClass.prototype.find;
      let declarationHits = 0;
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'color') {
          declarationHits++;
        }
        return originalFind.apply(this, args);
      };

      const snapshotRef = ref({ key: 'color' }, { type: 'variable', readMode: 'snapshot' });
      const node = rules([
        vardecl({ name: 'color', value: any('red') }),
        decl({
          name: any('seen'),
          value: snapshotRef
        }),
        vardecl({ name: 'color', value: any('blue') })
      ]);

      const css = await renderNodeToString(node, context);

      RulesClass.prototype.find = originalFind;
      expect(css).toBeString(`
        seen: red;
      `);
      expect(declarationHits).toBe(0);
      expect(isNode(snapshotRef._rulesLookupHandle?.returnVal)).toBe(false);
      expect(snapshotRef._rulesLookupHandle?.returnVal).toMatchObject({
        kind: 'scope-frame-variable-binding-handle'
      });
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

    it('static variable handle reuses binding identity without caching stale live values', async () => {
      const colorRef = ref({ key: 'color' }, { type: 'variable' });
      const node = rules([
        vardecl({ name: 'color', value: any('red') }),
        decl({
          name: any('seen'),
          value: colorRef
        })
      ]);
      setRulesContext(node);

      const first = await colorRef.eval(context);
      expect(first.valueOf()).toBe('red');
      expect(colorRef._rulesLookupHandle?.lookupType).toBe('variable');
      expect(colorRef._rulesLookupHandle?.returnVal).toMatchObject({
        kind: 'scope-frame-variable-binding-handle'
      });

      setScopeFrameLiveBinding(node.getScopeFrame(), 'color', {
        value: any('blue')
      });
      const second = await colorRef.eval(context);

      expect(second.valueOf()).toBe('blue');
      expect(colorRef.render(context)).toBe('blue');
    });

    it('cached variable handles use frame and cell identity without re-reading the current binding map', async () => {
      const colorRef = ref({ key: 'color' }, { type: 'variable' });
      const node = rules([
        vardecl({ name: 'color', value: any('red') }),
        decl({
          name: any('seen'),
          value: colorRef
        })
      ]);
      setRulesContext(node);

      const first = await colorRef.eval(context);
      expect(first.valueOf()).toBe('red');
      expect(colorRef._rulesLookupHandle?.returnVal).toMatchObject({
        kind: 'scope-frame-variable-binding-handle',
        ownerFrameCurrentBindingsVersion: node.getScopeFrame().currentBindingsVersion
      });

      const frame = node.getScopeFrame();
      const originalGet = frame.currentBindingsByName.get;
      let currentBindingReads = 0;
      frame.currentBindingsByName.get = function countCurrentBindingReads(
        this: typeof frame.currentBindingsByName,
        ...args: Parameters<typeof originalGet>
      ): ReturnType<typeof originalGet> {
        currentBindingReads++;
        return originalGet.apply(this, args);
      };

      try {
        const second = await colorRef.eval(context);
        expect(second.valueOf()).toBe('red');
        expect(currentBindingReads).toBe(1);
      } finally {
        frame.currentBindingsByName.get = originalGet;
      }
    });

    it('variable references prepare scope frames without callable miss coverage', async () => {
      const originalGetScopeFrame = RulesClass.prototype.getScopeFrame;
      const callableCoveragePrep: unknown[] = [];
      RulesClass.prototype.getScopeFrame = function(...args: Parameters<typeof originalGetScopeFrame>) {
        callableCoveragePrep.push(args[1]);
        return originalGetScopeFrame.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({ name: 'color', value: any('red') })
        ]);
        setRulesContext(node);
        const colorRef = ref({ key: 'color' }, { type: 'variable' });

        const value = await colorRef.eval(context);

        expect(value.valueOf()).toBe('red');
        expect(callableCoveragePrep).toContain(false);
        expect(callableCoveragePrep).not.toContain(true);
      } finally {
        RulesClass.prototype.getScopeFrame = originalGetScopeFrame;
      }
    });

    it('nested variable references do not prepare callable coverage on auto-wired parents', async () => {
      const originalGetScopeFrame = RulesClass.prototype.getScopeFrame;
      const callableCoveragePrep: unknown[] = [];
      RulesClass.prototype.getScopeFrame = function(...args: Parameters<typeof originalGetScopeFrame>) {
        callableCoveragePrep.push(args[1]);
        return originalGetScopeFrame.apply(this, args);
      };

      try {
        const colorRef = ref({ key: 'color' }, { type: 'variable' });
        const childRules = rules([
          decl({
            name: any('seen'),
            value: colorRef
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

        const value = await colorRef.eval(context);

        expect(value.valueOf()).toBe('red');
        expect(callableCoveragePrep).toContain(false);
        expect(callableCoveragePrep).not.toContain(true);
      } finally {
        RulesClass.prototype.getScopeFrame = originalGetScopeFrame;
      }
    });

    it('static variable handle invalidates when a parent frame replaces the current cell', async () => {
      const colorRef = ref({ key: 'color' }, { type: 'variable' });
      const childRules = rules([
        decl({
          name: any('seen'),
          value: colorRef
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
      childRules.scopeFrame = childRules.getScopeFrame(root.getScopeFrame());

      const first = await colorRef.eval(context);
      expect(first.valueOf()).toBe('red');
      expect(colorRef._rulesLookupHandle?.lookupType).toBe('variable');

      setScopeFrameLiveBinding(root.getScopeFrame(), 'color', {
        value: any('blue')
      });
      const second = await colorRef.eval(context);

      expect(second.valueOf()).toBe('blue');
    });

    it('covered variable misses avoid duplicate live-current retries', async () => {
      const originalGetScopeFrame = RulesClass.prototype.getScopeFrame;
      let variableFramePreps = 0;
      RulesClass.prototype.getScopeFrame = function(...args: Parameters<typeof originalGetScopeFrame>) {
        if (args[1] === false) {
          variableFramePreps++;
        }
        return originalGetScopeFrame.apply(this, args);
      };

      try {
        const missingRef = ref({ key: 'missing' }, { type: 'variable' });
        const node = rules([
          decl({
            name: any('seen'),
            value: missingRef
          })
        ]);
        setRulesContext(node);

        await expect(async () => await missingRef.eval(context)).rejects.toThrow();

        expect(variableFramePreps).toBe(1);
      } finally {
        RulesClass.prototype.getScopeFrame = originalGetScopeFrame;
      }
    });

    it('ancestor variable binding handles invalidate when a child frame gains a current binding', async () => {
      const colorRef = ref({ key: 'color' }, { type: 'variable' });
      const childRules = rules([
        decl({
          name: any('seen'),
          value: colorRef
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
      const rootFrame = root.getScopeFrame();
      childRules.scopeFrame = childRules.getScopeFrame(rootFrame);

      const first = await colorRef.eval(context);
      expect(first.valueOf()).toBe('red');
      expect(colorRef._rulesLookupHandle?.lookupType).toBe('variable');
      expect(colorRef._rulesLookupHandle?.returnVal).toMatchObject({
        kind: 'scope-frame-variable-binding-handle'
      });
      const firstHandle = colorRef._rulesLookupHandle;

      setScopeFrameLiveBinding(childRules.scopeFrame, 'color', {
        value: any('blue')
      });
      const second = await colorRef.eval(context);

      expect(second.valueOf()).toBe('blue');
      expect(colorRef._rulesLookupHandle).not.toBe(firstHandle);
      expect(colorRef._rulesLookupHandle?.returnVal).toMatchObject({
        kind: 'scope-frame-variable-binding-handle'
      });
    });

    it('VarDeclaration occurrence lookup uses direct lookup', async () => {
      const node = rules([
        vardecl({ name: 'color', value: any('red') })
      ]);

      await node.eval(context);
      const found = findVariableDeclarationOccurrence(node, 'color')?.node;

      expect(found?.valueNode.valueOf()).toBe('red');
    });

    it('variable occurrence lookup uses the variable lane directly', async () => {
      const node = rules([
        vardecl({ name: 'color', value: any('red') })
      ]);

      await node.eval(context);
      const found = findVariableDeclarationOccurrence(node, 'color')?.node;

      expect(found?.valueNode.valueOf()).toBe('red');
    });

    it('direct VarDeclaration lookup reads live cells through current bindings', async () => {
      const liveSource = vardecl({ name: 'color', value: any('blue') });
      const node = rules([
        vardecl({ name: 'color', value: any('red') })
      ]);
      await node.eval(context);
      const frame = node.getScopeFrame();
      setScopeFrameLiveBinding(frame, 'color', {
        value: liveSource.valueNode,
        sourceNode: liveSource
      });
      const originalGet = frame.liveSlotsByName.get;
      frame.liveSlotsByName.get = () => {
        throw new Error('direct lookup should read currentBindingsByName');
      };

      try {
        const found = findVariableDeclarationOccurrence(node, 'color')?.node;

        expect(found).toBe(liveSource);
      } finally {
        frame.liveSlotsByName.get = originalGet;
      }
    });

    it('variable occurrence lookup reads live cells through current bindings', async () => {
      const liveSource = vardecl({ name: 'color', value: any('blue') });
      const node = rules([
        vardecl({ name: 'color', value: any('red') })
      ]);
      await node.eval(context);
      const frame = node.getScopeFrame();
      setScopeFrameLiveBinding(frame, 'color', {
        value: liveSource.valueNode,
        sourceNode: liveSource
      });
      const originalGet = frame.liveSlotsByName.get;
      frame.liveSlotsByName.get = () => {
        throw new Error('direct lookup should read currentBindingsByName');
      };

      try {
        const found = findVariableDeclarationOccurrence(node, 'color')?.node;

        expect(found).toBe(liveSource);
      } finally {
        frame.liveSlotsByName.get = originalGet;
      }
    });

    it('property occurrence lookup uses direct Declaration lookup for unfiltered exact hits', async () => {
      const node = rules([
        decl({ name: any('color'), value: any('red') })
      ]);

      await node.eval(context);
      const found = findPropertyDeclarationOccurrence(node, 'color')?.node;

      expect(found?.valueNode.valueOf()).toBe('red');
    });

    it('direct property lookup records merge-chain occurrence slots', async () => {
      const directLookupNode = rules([
        decl({
          name: any('background-color'),
          value: any('red')
        }, { assign: '+:' }),
        decl({
          name: any('background-color'),
          value: any('foo')
        }, { assign: '+:' })
      ]);
      const directFound = findPropertyDeclarationOccurrence(
        directLookupNode,
        'background-color',
        { searchParents: false }
      )?.node;
      const cachedSlot = getDirectDeclarationSlot(
        directLookupNode.directDeclarationLookupCache?.values().next().value?.publicMatch
      );

      const renderNode = rules([
        decl({
          name: any('background-color'),
          value: any('red')
        }, { assign: '+:' }),
        decl({
          name: any('background-color'),
          value: any('foo')
        }, { assign: '+:' })
      ]);
      const css = await renderNodeToString(renderNode, context);

      expect(directFound?.valueNode.valueOf()).toBe('foo');
      expect(cachedSlot).toBe(1);
      expect(css).toBeString(`
        background-color: red, foo;
      `);
    });

    it('property occurrence lookup uses direct Declaration lookup for covered unfiltered misses', async () => {
      const node = rules([
        decl({ name: any('color'), value: any('red') })
      ]);

      await node.eval(context);

      expect(findPropertyDeclarationOccurrence(node, 'missing')).toBeUndefined();
    });

    it('direct declaration cache survives unrelated static declaration writes', async () => {
      const node = rules([
        decl({ name: any('color'), value: any('blue') })
      ]);

      await node.eval(context);

      expect(findPropertyDeclarationOccurrence(node, 'color')?.node.valueNode.valueOf()).toBe('blue');
      expect(findPropertyDeclarationOccurrence(node, 'missing')).toBeUndefined();
      expect(findPropertyDeclarationOccurrence(node, 'unrelated')).toBeUndefined();
      const buckets = node.directDeclarationsByName;
      const colorBucket = buckets?.get('color');
      const cache = node.directDeclarationLookupCache;
      const colorCacheKeys = [...(cache?.keys() ?? [])].filter(key => key.startsWith('color\u001f'));
      const missingCacheKeys = [...(cache?.keys() ?? [])].filter(key => key.startsWith('missing\u001f'));
      const unrelatedCacheKeys = [...(cache?.keys() ?? [])].filter(key => key.startsWith('unrelated\u001f'));
      expect(colorBucket).toBeDefined();
      expect(colorCacheKeys.length).toBeGreaterThan(0);
      expect(missingCacheKeys.length).toBeGreaterThan(0);
      expect(unrelatedCacheKeys.length).toBeGreaterThan(0);

      node.push(decl({ name: 'unrelated', value: any('1') }));

      expect(node.directDeclarationsByName).toBe(buckets);
      expect(node.directDeclarationsByName?.get('color')).toBe(colorBucket);
      expect([...((node.directDeclarationLookupCache ?? new Map()).keys())].filter(
        key => key.startsWith('color\u001f')
      )).toEqual(colorCacheKeys);
      expect([...((node.directDeclarationLookupCache ?? new Map()).keys())].filter(
        key => key.startsWith('missing\u001f')
      )).toEqual(missingCacheKeys);
      expect([...((node.directDeclarationLookupCache ?? new Map()).keys())].filter(
        key => key.startsWith('unrelated\u001f')
      )).toEqual([]);
      expect(findPropertyDeclarationOccurrence(node, 'color')?.node.valueNode.valueOf()).toBe('blue');
      expect(findPropertyDeclarationOccurrence(node, 'unrelated')?.node.valueNode.valueOf()).toBe('1');
    });

    it('direct declaration cache resets for child declaration surface writes', async () => {
      const node = rules([
        decl({ name: any('color'), value: any('blue') })
      ]);

      await node.eval(context);

      expect(findPropertyDeclarationOccurrence(node, 'color')?.node.valueNode.valueOf()).toBe('blue');
      expect(findPropertyDeclarationOccurrence(node, 'missing')).toBeUndefined();
      const declarationLookupVersion = node.declarationLookupVersion;
      expect(node.directDeclarationsByName).toBeDefined();
      expect(node.directDeclarationLookupCache?.size).toBeGreaterThan(0);

      node.push(rules([
        decl({ name: any('child-color'), value: any('green') })
      ]));

      expect(node.declarationLookupVersion).toBeGreaterThan(declarationLookupVersion);
      expect(node.directDeclarationsByName).toBeUndefined();
      expect(node.directDeclarationLookupCache).toBeUndefined();
      expect(findPropertyDeclarationOccurrence(node, 'child-color', { searchParents: false })?.node.valueNode.valueOf()).toBe('green');
    });

    it('direct VarDeclaration lookup ignores empty candidate sets', async () => {
      const node = rules([
        vardecl({ name: 'color', value: any('red') })
      ]);

      await node.eval(context);
      const opts = {
        candidates: new Set(),
        optionalCandidates: new Set()
      };
      const found = findVariableDeclarationOccurrence(node, 'color', opts)?.node;

      expect(found?.valueNode.valueOf()).toBe('red');
    });

    it('direct property lookup ignores empty candidate sets', async () => {
      const node = rules([
        decl({ name: any('color'), value: any('red') })
      ]);

      await node.eval(context);
      const opts = {
        candidates: new Set(),
        optionalCandidates: new Set()
      };
      const found = findPropertyDeclarationOccurrence(node, 'color', opts)?.node;

      expect(found?.valueNode.valueOf()).toBe('red');
      expect(node.directDeclarationLookupCache?.size).toBeGreaterThan(0);
    });

    it('direct property lookup records non-empty candidate hits', async () => {
      const stale = decl({ name: any('other-color'), value: any('black') });
      const node = rules([
        decl({ name: any('color'), value: any('red') })
      ]);

      await node.eval(context);
      const candidates = new Set<Node>([stale]);
      const optionalCandidates = new Set<Node>();
      const found = findPropertyDeclarationOccurrence(node, 'color', {
        candidates,
        optionalCandidates
      })?.node;

      expect(found?.valueNode.valueOf()).toBe('red');
      expect(found).toBeDefined();
      expect(candidates.has(found!)).toBe(true);
      expect(candidates.has(stale)).toBe(true);
      expect(optionalCandidates.size).toBe(0);
    });

    it('unfiltered property references use direct Declaration lookup', async () => {
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
    });

    it('semantic filtered property lookup uses direct declaration lookup', async () => {
      const node = rules([
        decl({ name: any('color'), value: any('red') })
      ]);

      await node.eval(context);
      const found = findPropertyDeclarationOccurrence(node, 'color', {
        semanticFilter: true,
        filter: () => true
      })?.node;

      expect(found?.valueNode.valueOf()).toBe('red');
    });

    it('semantic filtered child declaration fallback uses carried child entries without rulesSet storage', async () => {
      const childRules = rules([
        decl({ name: any('child-color'), value: any('blue') })
      ]);
      const root = rules([
        ruleset({
          selector: el('.scope'),
          rules: childRules
        })
      ]);
      await root.eval(context);

      expect('_rulesSet' in root).toBe(false);
      const found = findPropertyDeclarationOccurrence(root, 'child-color', {
        searchParents: false,
        semanticFilter: true,
        filter: () => true
      })?.node;
      expect(found?.valueNode.valueOf()).toBe('blue');
    });

    it('direct property lookup reuses carried child rule entries after indexing', async () => {
      const childRules = rules([
        decl({ name: any('child-color'), value: any('blue') })
      ]);
      const root = rules([
        decl({ name: any('root-color'), value: any('red') }),
        ruleset({
          selector: el('.scope'),
          rules: childRules
        })
      ]);
      await root.eval(context);

      expect(findPropertyDeclarationOccurrence(
        root,
        'child-color',
        { searchParents: false }
      )?.node.valueNode.valueOf()).toBe('blue');
      expect(root.directDeclarationChildEntries?.map(entry => entry.node)).toEqual([childRules]);
      let cachedMatch = root.directDeclarationLookupCache?.get('__missing__');
      for (const entry of root.directDeclarationLookupCache?.values() ?? []) {
        if (entry.publicMatch?.node === childRules.value[0]) {
          cachedMatch = entry;
          break;
        }
      }
      expect(cachedMatch?.publicMatch).toMatchObject({
        node: childRules.value[0],
        ownerRules: childRules,
        index: 0
      });

      const originalValue = root.rules;
      Object.defineProperty(root, 'value', {
        configurable: true,
        get() {
          throw new Error('direct declaration lookup should reuse carried child entries');
        }
      });

      try {
        const found = findPropertyDeclarationOccurrence(root, 'child-color', { searchParents: false })?.node;
        expect(found?.valueNode.valueOf()).toBe('blue');
      } finally {
        Object.defineProperty(root, 'value', {
          configurable: true,
          writable: true,
          value: originalValue
        });
      }
    });

    it('direct property lookup skips child rules whose visibility cannot contain properties', async () => {
      const childRules = rules([
        vardecl({ name: 'child-color', value: any('blue') })
      ], {
        rulesVisibility: {
          VarDeclaration: 'public',
          Declaration: 'private'
        }
      });
      const root = rules([childRules]);
      await root.eval(context);
      root.getScopeFrame();
      root.collectDirectDeclarationChildEntries();
      expect(root.hasDeclarationChildSurface).toBe(false);
      expect(root.hasVarDeclarationChildSurface).toBe(true);
      expect(root.directDeclarationChildEntries?.[0]).toMatchObject({
        hasDeclarationSurface: false,
        hasVarDeclarationSurface: true
      });

      const originalValue = childRules.value;
      Object.defineProperty(childRules, 'value', {
        configurable: true,
        get() {
          throw new Error('property lookup should skip variable-only child surfaces');
        }
      });

      try {
        const found = findPropertyDeclarationOccurrence(root, 'child-color', { searchParents: false })?.node;
        expect(found).toBeUndefined();
      } finally {
        Object.defineProperty(childRules, 'value', {
          configurable: true,
          writable: true,
          value: originalValue
        });
      }
    });

    it('direct variable lookup skips child rules whose visibility cannot contain variables', async () => {
      const childRules = rules([
        decl({ name: any('child-color'), value: any('blue') })
      ], {
        rulesVisibility: {
          VarDeclaration: 'private',
          Declaration: 'public'
        }
      });
      const root = rules([childRules]);
      await root.eval(context);
      root.collectDirectDeclarationChildEntries();
      expect(root.hasDeclarationChildSurface).toBe(true);
      expect(root.hasVarDeclarationChildSurface).toBe(false);
      expect(root.directDeclarationChildEntries?.[0]).toMatchObject({
        hasDeclarationSurface: true,
        hasVarDeclarationSurface: false
      });

      const originalValue = childRules.value;
      Object.defineProperty(childRules, 'value', {
        configurable: true,
        get() {
          throw new Error('variable lookup should skip property-only child surfaces');
        }
      });

      try {
        const found = findVariableDeclarationOccurrence(root, 'child-color', { searchParents: false })?.node;
        expect(found).toBeUndefined();
      } finally {
        Object.defineProperty(childRules, 'value', {
          configurable: true,
          writable: true,
          value: originalValue
        });
      }
    });

    it('direct variable lookup enters reference-import child surfaces even when family flags are absent', async () => {
      const childRules = rules([
        vardecl({ name: any('from-ref'), value: any('blue') })
      ], {
        rulesVisibility: {
          VarDeclaration: 'public'
        }
      });
      const root = rules([childRules]);
      await root.eval(context);
      root.collectDirectDeclarationChildEntries();
      const entry = root.directDeclarationChildEntries?.[0];
      expect(entry).toBeDefined();
      if (!entry) {
        throw new Error('expected carried child entry');
      }
      root.hasVarDeclarationChildSurface = false;
      root.hasReferenceImportChildSurface = true;
      entry.hasVarDeclarationSurface = false;
      entry.hasReferenceImportSurface = true;

      const found = findVariableDeclarationOccurrence(root, 'from-ref', { searchParents: false })?.node;

      expect(found?.valueNode.valueOf()).toBe('blue');
    });

    it('direct variable lookup still skips children without variable or reference-import surfaces', async () => {
      const childRules = rules([
        vardecl({ name: any('from-ref'), value: any('blue') })
      ], {
        rulesVisibility: {
          VarDeclaration: 'public'
        }
      });
      const root = rules([childRules]);
      await root.eval(context);
      root.collectDirectDeclarationChildEntries();
      const entry = root.directDeclarationChildEntries?.[0];
      expect(entry).toBeDefined();
      if (!entry) {
        throw new Error('expected carried child entry');
      }
      root.hasVarDeclarationChildSurface = false;
      root.hasReferenceImportChildSurface = false;
      entry.hasVarDeclarationSurface = false;
      entry.hasReferenceImportSurface = false;

      const originalValue = childRules.value;
      Object.defineProperty(childRules, 'value', {
        configurable: true,
        get() {
          throw new Error('variable lookup should skip non-variable non-reference-import child surfaces');
        }
      });

      try {
        const found = findVariableDeclarationOccurrence(root, 'from-ref', { searchParents: false })?.node;
        expect(found).toBeUndefined();
      } finally {
        Object.defineProperty(childRules, 'value', {
          configurable: true,
          writable: true,
          value: originalValue
        });
      }
    });

    it('setDefined variable assignment uses occurrence lookup', async () => {
      const node = rules([
        vardecl({ name: 'color', value: any('red') }),
        vardecl({ name: 'color', value: any('blue') }, { setDefined: true }),
        decl({
          name: any('seen'),
          value: ref({ key: 'color' }, { type: 'variable' })
        })
      ]);

      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        seen: blue;
      `);
    });

    it('setDefined current-cell probes do not use historical declaration buckets', async () => {
      const latest = vardecl({ name: 'color', value: any('green') });
      const node = rules([
        vardecl({ name: 'color', value: any('red') }),
        latest
      ]);

      await node.eval(context);
      const frame = node.getScopeFrame();
      const assignmentProbe = lookupScopeFrameVariable(frame, 'color', {
        bailOnPendingDeclarations: true,
        blockedSource: source => source === latest,
        filter: source => source !== latest
      });
      const sourceOrderRead = lookupScopeFrameVariable(frame, 'color', {
        start: latest.index
      });

      expect(assignmentProbe.kind).toBe('miss');
      expect(sourceOrderRead.kind).toBe('declaration');
      expect(sourceOrderRead.kind === 'declaration' && sourceOrderRead.cell.value?.valueOf()).toBe('red');
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

    it('plain lexical misses ignore unresolved dynamic declaration names', async () => {
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

    it('same-scope unresolved dynamic names before a static winner stay on direct lookup', async () => {
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

    it('same-scope unresolved dynamic names after a static winner stay on direct lookup', async () => {
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

    it('scope-frame prep records pending dynamic names without a second value scan', () => {
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
        })
      ]);
      const originalValue = node.value;
      let reads = 0;
      Object.defineProperty(node, 'value', {
        configurable: true,
        get() {
          reads++;
          if (reads > 1) {
            throw new Error('scope-frame declaration prep should collect pending names in the first scan');
          }
          return originalValue;
        }
      });

      try {
        const frame = node.getScopeFrame(undefined, false);
        expect(frame.pendingDeclarationNames).toHaveLength(1);
        expect(frame.pendingDeclarationNames[0]).toBe(originalValue[0]);
        expect(frame.declarationBucketsByName.get('x')?.at(-1)?.sourceNode).toBe(originalValue[1]);
      } finally {
        Object.defineProperty(node, 'value', {
          configurable: true,
          writable: true,
          value: originalValue
        });
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
        expect(findPropertyDeclarationOccurrence(node, 'x', { searchParents: false })).toBeUndefined();
        expect(findPropertyDeclarationOccurrence(node, 'unaffected', { searchParents: false })).toBeUndefined();
        expect(node.directDeclarationsByName?.get('x')).toBeNull();
        expect(node.directDeclarationsByName?.get('unaffected')).toBeNull();
        await Promise.resolve(node.prepareRegistration(context));
        setRulesContext(node);
        const dynamicDecl = node.value.find(child => child instanceof VarDeclaration && child.name.valueOf() === 'x')!;

        expect(declarationHits).toHaveLength(0);
        expect(node.directDeclarationsByName?.get('x')).toBeUndefined();
        expect(node.directDeclarationsByName?.get('unaffected')).toBeNull();
        expect([...(node.directDeclarationLookupCache?.keys() ?? [])].filter(key => key.startsWith('x\u001f'))).toHaveLength(0);
        expect([...(node.directDeclarationLookupCache?.keys() ?? [])].filter(key => key.startsWith('unaffected\u001f')).length).toBeGreaterThan(0);
        expect(frame.pendingDeclarationNames).toHaveLength(0);
        expect(frame.declarationBucketsByName.get('x')?.at(-1)?.sourceNode).toBe(dynamicDecl);
        expect(node.getDeclarationLookupVersion('x')).toBeGreaterThan(0);
        expect(node.getDeclarationLookupVersion('unaffected')).toBe(0);
        const promotedHit = lookupScopeFrameVariable(frame, 'x', {
          bailOnPendingDeclarations: true
        });
        expect(promotedHit.kind).toBe('declaration');
        expect(promotedHit.kind === 'declaration' && promotedHit.sourceNode).toBe(dynamicDecl);
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
        node.setFunctionBinding('async-name', new JsFunction({
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

    it('reuses static callable binding handles across unrelated target rules version changes', async () => {
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
        expect(pathLookups).toBe(1);
      } finally {
        RulesClass.prototype.findMixin = originalFindMixin;
      }
    });

    it('ordinary simple callable references do not prepare scope frames', async () => {
      const node = rules([
        mixin({
          name: any('.paint'),
          rules: rules([decl({ name: 'color', value: any('blue') })])
        })
      ]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: '.paint' }, { type: 'mixin' });
      const originalGetScopeFrame = RulesClass.prototype.getScopeFrame;
      const framePreparations: string[] = [];
      RulesClass.prototype.getScopeFrame = function(...args: Parameters<typeof originalGetScopeFrame>) {
        framePreparations.push(this.toTrimmedString());
        return originalGetScopeFrame.apply(this, args);
      };

      try {
        expectNodeType(lookupRef.eval(context), 'MixinCollection');
        expect(lookupRef._rulesLookupHandle?.lookupType).toBe('mixin');
        expect(framePreparations).toEqual([]);

        expectNodeType(lookupRef.eval(context), 'MixinCollection');
        expect(framePreparations).toEqual([]);
      } finally {
        RulesClass.prototype.getScopeFrame = originalGetScopeFrame;
      }
    });

    it('reuses static function binding handles until the function key version changes', async () => {
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
        node.setFunctionBinding('paint', new JsFunction({
          name: 'paint',
          fn: () => any('blue')
        }));
        setRulesContext(await node.eval(context));
        const ignoredExcludedDeclarations = [
          decl({ name: 'color', value: any('red') }),
          decl({ name: 'color', value: any('green') }),
          decl({ name: 'color', value: any('black') })
        ];
        const lookupRef = ref({ key: 'paint' }, {
          type: 'function',
          excludedDeclarations: ignoredExcludedDeclarations,
          requiredDeclarationAssignments: ['one', 'two', 'three', 'four', 'five']
        });

        const first = lookupRef.eval(context);
        expect(isNode(first)).toBe(true);
        if (isNode(first)) {
          expect(first.type).toBe('JsFunction');
        }
        expect(functionLookups).toBe(1);
        const firstHandle = lookupRef._rulesLookupHandle;
        expect(firstHandle?.lookupType).toBe('function');
        expect(firstHandle && 'requiredDeclarationAssignmentsKey' in firstHandle).toBe(false);
        expect(firstHandle && 'excludedDeclaration0' in firstHandle).toBe(false);
        expect(firstHandle && 'excludedDeclaration1' in firstHandle).toBe(false);

        ignoredExcludedDeclarations[0] = decl({ name: 'color', value: any('mutated') });
        const second = lookupRef.eval(context);
        expect(isNode(second)).toBe(true);
        if (isNode(second)) {
          expect(second.type).toBe('JsFunction');
        }
        expect(lookupRef._rulesLookupHandle).toBe(firstHandle);
        expect(functionLookups).toBe(1);

        node.setFunctionBinding('paint', new JsFunction({
          name: 'paint',
          fn: () => any('green')
        }));
        const third = lookupRef.eval(context);
        expect(isNode(third)).toBe(true);
        if (isNode(third)) {
          expect(third.type).toBe('JsFunction');
        }
        expect(functionLookups).toBe(2);

        node.push(decl({ name: 'unrelated', value: any('1') }));
        const fourth = lookupRef.eval(context);
        expect(isNode(fourth)).toBe(true);
        if (isNode(fourth)) {
          expect(fourth.type).toBe('JsFunction');
        }
        expect(functionLookups).toBe(2);

        node.setFunctionBinding('other-fn', new JsFunction({
          name: 'other-fn',
          fn: () => any('black')
        }));
        const fifth = lookupRef.eval(context);
        expect(isNode(fifth)).toBe(true);
        if (isNode(fifth)) {
          expect(fifth.type).toBe('JsFunction');
        }
        expect(functionLookups).toBe(2);
      } finally {
        RulesClass.prototype.findFunction = originalFindFunction;
      }
    });

    it('static property references use direct declaration lookup before binding handle reuse', async () => {
      const node = rules([
        decl({ name: 'color', value: any('blue') })
      ]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: 'color' }, { type: 'property' });

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle?.returnVal).toMatchObject({
        kind: 'direct-declaration-occurrence'
      });
      const handle = lookupRef._rulesLookupHandle;
      const handleVersion = handle?.targetLookupVersion;

      expect(lookupRef.eval(context).valueOf()).toBe('blue');

      node.push(decl({ name: 'unrelated', value: any('1') }));
      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBe(handle);
      expect(lookupRef._rulesLookupHandle?.targetLookupVersion).toBe(handleVersion);
    });

    it('static variable references use scope-frame bindings before public variable bridge', async () => {
      const node = rules([
        vardecl({ name: 'color', value: any('blue') })
      ]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: 'color' }, { type: 'variable' });

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.returnVal).toMatchObject({
        kind: 'scope-frame-variable-binding-handle'
      });

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBe(handle);

      node.push(decl({ name: 'unrelated', value: any('1') }));
      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBe(handle);
    });

    it('source-static handles read before rebuilding lookup strategy', async () => {
      const node = rules([
        vardecl({ name: 'tone-var', value: any('purple') }),
        decl({ name: 'tone-prop', value: any('orange') }),
        mixin({
          name: any('.tone-mixin'),
          rules: rules([decl({ name: 'color', value: any('blue') })])
        })
      ]);
      node.setFunctionBinding('tone-fn', new JsFunction({
        name: 'tone-fn',
        fn: () => any('green')
      }));
      setRulesContext(await node.eval(context));
      const reads = [
        {
          lookupRef: ref({ key: 'tone-var' }, { type: 'variable' }),
          expectValue: 'purple'
        },
        {
          lookupRef: ref({ key: 'tone-prop' }, { type: 'property' }),
          expectValue: 'orange'
        },
        {
          lookupRef: ref({ key: 'tone-fn' }, { type: 'function' }),
          expectType: 'JsFunction'
        },
        {
          lookupRef: ref({ key: '.tone-mixin' }, { type: 'mixin' }),
          expectType: 'MixinCollection'
        }
      ];

      for (const read of reads) {
        const first = read.lookupRef.eval(context);
        if (read.expectValue) {
          expect(first.valueOf()).toBe(read.expectValue);
        } else if (read.expectType) {
          expect(isNode(first)).toBe(true);
          if (isNode(first)) {
            expect(first.type).toBe(read.expectType);
          }
        } else if ('expectArray' in read) {
          expect(Array.isArray(first)).toBe(read.expectArray);
        }
        const handle = read.lookupRef._rulesLookupHandle;
        expect(handle).toBeDefined();
        expect(read.lookupRef._lookupStrategy).toBeDefined();

        read.lookupRef._lookupStrategy = undefined;
        const second = read.lookupRef.eval(context);

        if (read.expectValue) {
          expect(second.valueOf()).toBe(read.expectValue);
        } else if (read.expectType) {
          expect(isNode(second)).toBe(true);
          if (isNode(second)) {
            expect(second.type).toBe(read.expectType);
          }
        } else if ('expectArray' in read) {
          expect(Array.isArray(second)).toBe(read.expectArray);
        }
        expect(read.lookupRef._rulesLookupHandle).toBe(handle);
        expect(read.lookupRef._lookupStrategy).toBeUndefined();
      }
    });

    it('source-static handles rebuild lookup strategy for unstable reference facts', async () => {
      const node = rules([
        vardecl({ name: 'tone-var', value: any('purple') }),
        decl({ name: 'tone-prop', value: any('orange') })
      ]);
      setRulesContext(await node.eval(context));

      const snapshotRef = ref({ key: 'tone-var' }, { type: 'variable' });
      expect(snapshotRef.eval(context).valueOf()).toBe('purple');
      expect(snapshotRef._rulesLookupHandle?.lookupType).toBe('variable');
      snapshotRef._lookupStrategy = undefined;
      snapshotRef.options.readMode = 'snapshot';

      expect(snapshotRef.eval(context).valueOf()).toBe('purple');
      expect(snapshotRef._lookupStrategy?.lookupType).toBe('variable');

      const filteredRef = ref({ key: 'tone-prop' }, { type: 'property' });
      expect(filteredRef.eval(context).valueOf()).toBe('orange');
      expect(filteredRef._rulesLookupHandle?.lookupType).toBe('property');
      filteredRef._lookupStrategy = undefined;
      filteredRef.options.filter = node => node.type === 'Declaration';

      expect(filteredRef.eval(context).valueOf()).toBe('orange');
      expect(filteredRef._lookupStrategy?.lookupType).toBe('property');
    });

    it('static property occurrence handles invalidate when owner rules changes', async () => {
      const childRules = rules([
        decl({ name: 'color', value: any('blue') })
      ]);
      const root = rules([
        ruleset({
          selector: el('.scope'),
          rules: childRules
        })
      ]);
      setRulesContext(await root.eval(context));
      const lookupRef = ref({ key: 'color' }, { type: 'property' });

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle?.returnVal).toMatchObject({
        kind: 'direct-declaration-occurrence'
      });
      const occurrence = lookupRef._rulesLookupHandle?.returnVal;
      const ownerLookupVersion = getDirectDeclarationOwnerLookupVersion(occurrence);

      childRules.push(decl({ name: 'color', value: any('green') }));

      expect(lookupRef.eval(context).valueOf()).toBe('green');
      const updatedOccurrence = lookupRef._rulesLookupHandle?.returnVal;
      expect(getDirectDeclarationOwnerLookupVersion(updatedOccurrence)).not.toBe(ownerLookupVersion);
    });

    it('static property handles stay cold while searchScope disqualifies lookup', async () => {
      const declaration = decl({ name: 'color', value: any('blue') });
      const node = rules([declaration]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: 'color' }, {
        type: 'property',
        fallbackValue: any('fallback')
      });

      context.searchScope.add(declaration);
      expect(lookupRef.eval(context).valueOf()).toBe('fallback');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      context.searchScope.delete(declaration);
      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.returnVal).toMatchObject({
        kind: 'direct-declaration-occurrence'
      });

      context.searchScope.add(declaration);
      expect(lookupRef.eval(context).valueOf()).toBe('fallback');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();
      context.searchScope.delete(declaration);

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static variable handles stay cold while searchScope disqualifies lookup', async () => {
      const declaration = vardecl({ name: 'color', value: any('blue') });
      const node = rules([declaration]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: 'color' }, {
        type: 'variable',
        fallbackValue: any('fallback')
      });

      context.searchScope.add(declaration);
      expect(lookupRef.eval(context).valueOf()).toBe('fallback');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      context.searchScope.delete(declaration);
      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.returnVal).toMatchObject({
        kind: 'scope-frame-variable-binding-handle'
      });

      context.searchScope.add(declaration);
      expect(lookupRef.eval(context).valueOf()).toBe('fallback');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();
      context.searchScope.delete(declaration);

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static declaration handles stay cold while searchScope disqualifies lookup', async () => {
      const declaration = decl({ name: 'color', value: any('blue') });
      const node = rules([declaration]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: 'color' }, {
        type: 'declaration',
        fallbackValue: any('fallback')
      });

      context.searchScope.add(declaration);
      expect(lookupRef.eval(context).valueOf()).toBe('fallback');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      context.searchScope.delete(declaration);
      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.returnVal).toMatchObject({
        kind: 'direct-declaration-occurrence'
      });

      context.searchScope.add(declaration);
      expect(lookupRef.eval(context).valueOf()).toBe('fallback');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();
      context.searchScope.delete(declaration);

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static declaration handles stay cold while leakyRules disqualifies lookup', async () => {
      const declaration = decl({ name: 'color', value: any('blue') });
      const node = rules([declaration]);
      const root = setRulesContext(await node.eval(context));
      const leakyContext = new Context({ leakyRules: true });
      leakyContext.root = root;
      leakyContext.rulesContext = root;
      const lookupRef = ref({ key: 'color' }, {
        type: 'declaration',
        fallbackValue: any('fallback')
      });

      expect(lookupRef.eval(leakyContext).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.returnVal).toMatchObject({
        kind: 'direct-declaration-occurrence'
      });

      expect(lookupRef.eval(leakyContext).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static property handles stay cold while leakyRules disqualifies lookup', async () => {
      const declaration = decl({ name: 'color', value: any('blue') });
      const node = rules([declaration]);
      const root = setRulesContext(await node.eval(context));
      const leakyContext = new Context({ leakyRules: true });
      leakyContext.root = root;
      leakyContext.rulesContext = root;
      const lookupRef = ref({ key: 'color' }, {
        type: 'property',
        fallbackValue: any('fallback')
      });

      expect(lookupRef.eval(leakyContext).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.returnVal).toMatchObject({
        kind: 'direct-declaration-occurrence'
      });

      expect(lookupRef.eval(leakyContext).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static variable handles stay cold while leakyRules disqualifies lookup', async () => {
      const declaration = vardecl({ name: 'color', value: any('blue') });
      const node = rules([declaration]);
      const root = setRulesContext(await node.eval(context));
      const leakyContext = new Context({ leakyRules: true });
      leakyContext.root = root;
      leakyContext.rulesContext = root;
      const lookupRef = ref({ key: 'color' }, {
        type: 'variable',
        fallbackValue: any('fallback')
      });

      expect(lookupRef.eval(leakyContext).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.returnVal).toMatchObject({
        kind: 'scope-frame-variable-binding-handle'
      });

      expect(lookupRef.eval(leakyContext).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static function handles stay cold while leakyRules disqualifies lookup', async () => {
      const node = rules([]);
      node.setFunctionBinding('paint', new JsFunction({
        name: 'paint',
        fn: () => any('blue')
      }));
      const root = setRulesContext(await node.eval(context));
      const leakyContext = new Context({ leakyRules: true });
      leakyContext.root = root;
      leakyContext.rulesContext = root;
      const lookupRef = ref({ key: 'paint' }, { type: 'function' });

      expectNodeType(lookupRef.eval(leakyContext), 'JsFunction');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expectNodeType(lookupRef.eval(context), 'JsFunction');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.lookupType).toBe('function');

      expectNodeType(lookupRef.eval(leakyContext), 'JsFunction');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expectNodeType(lookupRef.eval(context), 'JsFunction');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static function handles stay cold while searchScope disqualifies lookup', async () => {
      const ignoredDeclaration = decl({ name: 'color', value: any('blue') });
      const node = rules([ignoredDeclaration]);
      node.setFunctionBinding('paint', new JsFunction({
        name: 'paint',
        fn: () => any('blue')
      }));
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: 'paint' }, { type: 'function' });

      context.searchScope.add(ignoredDeclaration);
      expectNodeType(lookupRef.eval(context), 'JsFunction');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      context.searchScope.delete(ignoredDeclaration);
      expectNodeType(lookupRef.eval(context), 'JsFunction');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.lookupType).toBe('function');

      context.searchScope.add(ignoredDeclaration);
      expectNodeType(lookupRef.eval(context), 'JsFunction');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();
      context.searchScope.delete(ignoredDeclaration);

      expectNodeType(lookupRef.eval(context), 'JsFunction');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static callable handles stay cold while leakyRules disqualifies lookup', async () => {
      const callable = mixin({
        name: any('.paint'),
        rules: rules([decl({ name: 'color', value: any('green') })])
      });
      const node = rules([callable]);
      const root = setRulesContext(await node.eval(context));
      const leakyContext = new Context({ leakyRules: true });
      leakyContext.root = root;
      leakyContext.rulesContext = root;
      const lookupRef = ref({ key: '.paint' }, { type: 'mixin' });

      expectNodeType(lookupRef.eval(leakyContext), 'MixinCollection');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expectNodeType(lookupRef.eval(context), 'MixinCollection');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.lookupType).toBe('mixin');

      expectNodeType(lookupRef.eval(leakyContext), 'MixinCollection');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expectNodeType(lookupRef.eval(context), 'MixinCollection');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static callable handles stay cold while searchScope disqualifies lookup', async () => {
      const ignoredDeclaration = decl({ name: 'color', value: any('blue') });
      const callable = mixin({
        name: any('.paint'),
        rules: rules([decl({ name: 'color', value: any('green') })])
      });
      const node = rules([ignoredDeclaration, callable]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: '.paint' }, { type: 'mixin' });

      context.searchScope.add(ignoredDeclaration);
      expect(lookupRef.eval(context)).toBeDefined();
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      context.searchScope.delete(ignoredDeclaration);
      expect(lookupRef.eval(context)).toBeDefined();
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.lookupType).toBe('mixin');

      context.searchScope.add(ignoredDeclaration);
      expect(lookupRef.eval(context)).toBeDefined();
      expect(lookupRef._rulesLookupHandle).toBeUndefined();
      context.searchScope.delete(ignoredDeclaration);

      expect(lookupRef.eval(context)).toBeDefined();
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static mixin-ruleset handles stay cold while leakyRules disqualifies lookup', async () => {
      const callable = ruleset({
        selector: el('.paint'),
        rules: rules([decl({ name: 'color', value: any('green') })])
      });
      const node = rules([callable]);
      const root = setRulesContext(await node.eval(context));
      const leakyContext = new Context({ leakyRules: true });
      leakyContext.root = root;
      leakyContext.rulesContext = root;
      const lookupRef = ref({ key: '.paint' }, { type: 'mixin-ruleset' });

      expectNodeType(lookupRef.eval(leakyContext), 'MixinCollection');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expectNodeType(lookupRef.eval(context), 'MixinCollection');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.lookupType).toBe('mixin-ruleset');

      expectNodeType(lookupRef.eval(leakyContext), 'MixinCollection');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      expectNodeType(lookupRef.eval(context), 'MixinCollection');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static mixin-ruleset handles stay cold while searchScope disqualifies lookup', async () => {
      const ignoredDeclaration = decl({ name: 'color', value: any('blue') });
      const callable = ruleset({
        selector: el('.paint'),
        rules: rules([decl({ name: 'color', value: any('green') })])
      });
      const node = rules([ignoredDeclaration, callable]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: '.paint' }, { type: 'mixin-ruleset' });

      context.searchScope.add(ignoredDeclaration);
      expectNodeType(lookupRef.eval(context), 'MixinCollection');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();

      context.searchScope.delete(ignoredDeclaration);
      expectNodeType(lookupRef.eval(context), 'MixinCollection');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.lookupType).toBe('mixin-ruleset');

      context.searchScope.add(ignoredDeclaration);
      expectNodeType(lookupRef.eval(context), 'MixinCollection');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();
      context.searchScope.delete(ignoredDeclaration);

      expectNodeType(lookupRef.eval(context), 'MixinCollection');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('static property handles reuse source-static declaration assignment constraints', async () => {
      const node = rules([
        decl({ name: 'background-color', value: any('red') }),
        decl({ name: 'background-color', value: any('blue') }, { normalizedFromAssign: '+,:' })
      ]);
      setRulesContext(await node.eval(context));
      const requiredDeclarationAssignments = ['+,:'];
      const lookupRef = ref({ key: 'background-color' }, {
        type: 'property',
        requiredDeclarationAssignments
      });

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.returnVal).toMatchObject({
        kind: 'direct-declaration-occurrence'
      });

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBe(handle);
    });

    it('static property handles include excluded source/output identities', async () => {
      const earlier = decl({ name: 'color', value: any('red') });
      const later = decl({ name: 'color', value: any('blue') });
      const node = rules([earlier, later]);
      setRulesContext(await node.eval(context));
      const excludedDeclarations: Node[] = [later];
      const lookupRef = ref({ key: 'color' }, {
        type: 'property',
        excludedDeclarations
      });

      expect(lookupRef.eval(context).valueOf()).toBe('red');
      const firstHandle = lookupRef._rulesLookupHandle;
      expect(firstHandle?.returnVal).toMatchObject({
        kind: 'direct-declaration-occurrence'
      });

      excludedDeclarations[0] = earlier;

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).not.toBe(firstHandle);
    });

    it('static property handles track first and second declaration exclusions without count state', async () => {
      const first = decl({ name: 'color', value: any('red') });
      const second = decl({ name: 'color', value: any('blue') });
      const third = decl({ name: 'color', value: any('green') });
      const node = rules([first, second, third]);
      setRulesContext(await node.eval(context));
      const excludedDeclarations: Node[] = [];
      const lookupRef = ref({ key: 'color' }, {
        type: 'property',
        excludedDeclarations
      });

      expect(lookupRef.eval(context).valueOf()).toBe('green');
      const firstHandle = lookupRef._rulesLookupHandle;
      expect(firstHandle).toBeDefined();
      expect(firstHandle && 'excludedDeclarationCount' in firstHandle).toBe(false);

      excludedDeclarations[0] = third;

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const secondHandle = lookupRef._rulesLookupHandle;
      expect(secondHandle).not.toBe(firstHandle);
      expect(secondHandle && 'excludedDeclarationCount' in secondHandle).toBe(false);

      excludedDeclarations[1] = second;

      expect(lookupRef.eval(context).valueOf()).toBe('red');
      const thirdHandle = lookupRef._rulesLookupHandle;
      expect(thirdHandle).not.toBe(secondHandle);
      expect(thirdHandle && 'excludedDeclarationCount' in thirdHandle).toBe(false);

      excludedDeclarations[1] = first;

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).not.toBe(thirdHandle);
    });

    it('static property handles invalidate when bindOutput exposes the output identity', async () => {
      const source = decl({ name: 'color', value: any('red') }, {
        normalizedFromAssign: AssignmentType.MergeList
      });
      const output = decl({ name: 'color', value: any('blue') }, {
        normalizedFromAssign: AssignmentType.MergeList
      });
      const node = rules([source, output]);
      setRulesContext(node);
      const excludedDeclarations: Node[] = [source];
      const options: ReferenceOptions = {
        type: 'property',
        fallbackValue: any('fallback'),
        excludedDeclarations,
        requiredDeclarationAssignments: [
          AssignmentType.MergeList,
          AssignmentType.MergeSequence,
          '+,:',
          '+_:'
        ]
      };
      const lookupRef = ref({ key: 'color' }, options);

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const firstHandle = lookupRef._rulesLookupHandle;
      expect(firstHandle?.returnVal).toMatchObject({
        kind: 'direct-declaration-occurrence'
      });
      if (!firstHandle || firstHandle.returnVal === 'cached-rules-lookup-miss' || !('node' in firstHandle.returnVal)) {
        expect.fail('Expected direct declaration occurrence handle');
      }

      excludedDeclarations[1] = firstHandle.returnVal.node;

      expect(lookupRef.eval(context).valueOf()).toBe('fallback');
      expect(lookupRef._rulesLookupHandle).not.toBe(firstHandle);
    });

    it('real Less merge-chain property refs avoid public lookup bridges', async () => {
      const { Parser } = await import('../../../../less-parser/src/index.ts');
      const parser = new Parser();
      const tree = parser.parse(`
        .out {
          box-shadow+: inset 0 0 1px red;
          box-shadow+: 0 0 2px blue;
          background+: red;
          background+: blue;
        }
      `).tree;
      context.root = tree;
      const css = await renderNodeToString(tree, context, { context });

      expect(css).toContain('box-shadow: inset 0 0 1px red, 0 0 2px blue;');
      expect(css).toContain('background: red, blue;');
    });

    it('keeps wider declaration-exclusion filters cold instead of caching generic filter shape', async () => {
      const first = decl({ name: 'color', value: any('red') });
      const second = decl({ name: 'color', value: any('blue') });
      const third = decl({ name: 'other', value: any('green') });
      const node = rules([first, second, third]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: 'color' }, {
        type: 'property',
        excludedDeclarations: [first, second, third],
        fallbackValue: any('fallback')
      });

      expect(lookupRef.eval(context).valueOf()).toBe('fallback');
      expect(lookupRef._rulesLookupHandle).toBeUndefined();
    });

    it('static declaration references use direct declaration lookup before binding handle reuse', async () => {
      const node = rules([
        decl({ name: 'color', value: any('blue') })
      ]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: 'color' }, { type: 'declaration' });

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const handle = lookupRef._rulesLookupHandle;
      const handleVersion = handle?.targetLookupVersion;

      expect(lookupRef.eval(context).valueOf()).toBe('blue');

      node.push(decl({ name: 'unrelated', value: any('1') }));
      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._rulesLookupHandle).toBe(handle);
      expect(lookupRef._rulesLookupHandle?.targetLookupVersion).toBe(handleVersion);
    });

    it('static declaration handles reuse source-static declaration assignment constraints', async () => {
      const node = rules([
        decl({ name: 'background-color', value: any('red') }),
        decl({ name: 'background-color', value: any('blue') }, { normalizedFromAssign: '&,:' }),
        decl({ name: 'background-color', value: any('green') }, { normalizedFromAssign: '+,:' })
      ]);
      setRulesContext(await node.eval(context));
      const requiredDeclarationAssignments = ['&,:'];
      const lookupRef = ref({ key: 'background-color' }, {
        type: 'declaration',
        requiredDeclarationAssignments
      });

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      const handle = lookupRef._rulesLookupHandle;
      expect(handle?.returnVal).toMatchObject({
        kind: 'direct-declaration-occurrence'
      });

      requiredDeclarationAssignments[0] = '+,:';

      expect(lookupRef.eval(context).valueOf()).toBe('green');
      expect(lookupRef._rulesLookupHandle).not.toBe(handle);
    });

    it('reference strategy cache rejects stale lookup types in one node slot', async () => {
      const node = rules([
        vardecl({ name: 'color', value: any('red') }),
        decl({ name: any('color'), value: any('blue') })
      ]);
      setRulesContext(await node.eval(context));
      const lookupRef = ref({ key: 'color' }, { type: 'property' });

      expect(lookupRef.eval(context).valueOf()).toBe('blue');
      expect(lookupRef._lookupStrategy?.lookupType).toBe('property');
      expect(lookupRef._rulesLookupHandle?.lookupType).toBe('property');

      lookupRef.options.type = 'variable';

      expect(lookupRef.eval(context).valueOf()).toBe('red');
      expect(lookupRef._lookupStrategy?.lookupType).toBe('variable');
      expect(lookupRef._rulesLookupHandle?.lookupType).toBe('variable');
    });

    it('callable handles reject stale terminal mixin-only mode', async () => {
      const originalFindMixin = RulesClass.prototype.findMixin;
      let callableLookups = 0;
      RulesClass.prototype.findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        const [key] = args;
        if (key === '.parameterized-handle') {
          callableLookups++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        const node = rules([
          ruleset({
            selector: el('.parameterized-handle'),
            rules: rules([decl({ name: 'color', value: any('ruleset') })])
          }),
          mixin({
            name: any('.parameterized-handle'),
            params: list([any('color', { role: 'property' })]),
            rules: rules([decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })])
          })
        ]);
        setRulesContext(await node.eval(context));
        const lookupRef = ref({ key: '.parameterized-handle' }, { type: 'mixin-ruleset' });

        const first = lookupRef.eval(context);
        expect(isNode(first)).toBe(true);
        expect(callableLookups).toBe(1);
        expect(lookupRef._rulesLookupHandle?.terminalMixinOnly).toBe(false);

        lookupRef.options.mixinRulesetCallHasArgs = true;

        const second = lookupRef.eval(context);
        expect(isNode(second)).toBe(true);
        expect(callableLookups).toBe(2);
        expect(lookupRef._rulesLookupHandle?.terminalMixinOnly).toBe(true);
      } finally {
        RulesClass.prototype.findMixin = originalFindMixin;
      }
    });

    it('callable handles survive unrelated declaration and function writes', async () => {
      const originalFindMixin = RulesClass.prototype.findMixin;
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      let callableLookups = 0;
      let broadCallableLookups = 0;
      RulesClass.prototype.findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        const [key] = args;
        if (key === '.callable-handle') {
          callableLookups++;
        }
        return originalFindMixin.apply(this, args);
      };
      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.callable-handle') {
          broadCallableLookups++;
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const node = rules([
          mixin({
            name: any('.callable-handle'),
            rules: rules([decl({ name: 'color', value: any('blue') })])
          })
        ]);
        setRulesContext(await node.eval(context));
        const ignoredExcludedDeclarations = [
          decl({ name: 'color', value: any('red') }),
          decl({ name: 'color', value: any('green') }),
          decl({ name: 'color', value: any('black') })
        ];
        const lookupRef = ref({ key: '.callable-handle' }, {
          type: 'mixin',
          excludedDeclarations: ignoredExcludedDeclarations,
          requiredDeclarationAssignments: ['one', 'two', 'three', 'four', 'five']
        });

        const first = lookupRef.eval(context);
        expect(first).toBeDefined();
        expect(callableLookups).toBe(1);
        expect(broadCallableLookups).toBe(1);
        const callableCache = node.callableLookupCache;
        const callableBuckets = node._scopeFrame?.callableBucketsByName;
        const firstHandle = lookupRef._rulesLookupHandle;
        expect(callableCache).toBeDefined();
        expect(firstHandle?.lookupType).toBe('mixin');
        expect(firstHandle && 'requiredDeclarationAssignmentsKey' in firstHandle).toBe(false);
        expect(firstHandle && 'excludedDeclaration0' in firstHandle).toBe(false);
        expect(firstHandle && 'excludedDeclaration1' in firstHandle).toBe(false);

        ignoredExcludedDeclarations[0] = decl({ name: 'color', value: any('mutated') });
        node.push(decl({ name: 'unrelated', value: any('1') }));
        const second = lookupRef.eval(context);
        expect(second).toBeDefined();
        expect(callableLookups).toBe(1);
        expect(broadCallableLookups).toBe(1);
        expect(lookupRef._rulesLookupHandle).toBe(firstHandle);
        expect(node.callableLookupCache).toBe(callableCache);
        expect(node._scopeFrame?.callableBucketsByName).toBe(callableBuckets);

        node.setFunctionBinding('unrelated-fn', new JsFunction({
          name: 'unrelated-fn',
          fn: () => any('ok')
        }));
        const third = lookupRef.eval(context);
        expect(third).toBeDefined();
        expect(callableLookups).toBe(1);
        expect(broadCallableLookups).toBe(1);
      } finally {
        RulesClass.prototype.findMixin = originalFindMixin;
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('mixin-ruleset handles skip public and broad callable lookup after cache write', async () => {
      const originalFindMixin = RulesClass.prototype.findMixin;
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      let callableLookups = 0;
      let broadCallableLookups = 0;
      RulesClass.prototype.findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        const [key] = args;
        if (key === '.ruleset-handle') {
          callableLookups++;
        }
        return originalFindMixin.apply(this, args);
      };
      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.ruleset-handle') {
          broadCallableLookups++;
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const node = rules([
          ruleset({
            selector: el('.ruleset-handle'),
            rules: rules([decl({ name: 'color', value: any('blue') })])
          })
        ]);
        setRulesContext(await node.eval(context));
        const lookupRef = ref({ key: '.ruleset-handle' }, { type: 'mixin-ruleset' });

        expectNodeType(lookupRef.eval(context), 'MixinCollection');
        expect(callableLookups).toBe(1);
        expect(broadCallableLookups).toBe(1);
        const firstHandle = lookupRef._rulesLookupHandle;
        expect(firstHandle?.lookupType).toBe('mixin-ruleset');

        node.push(decl({ name: 'unrelated', value: any('1') }));
        expectNodeType(lookupRef.eval(context), 'MixinCollection');
        expect(lookupRef._rulesLookupHandle).toBe(firstHandle);
        expect(callableLookups).toBe(1);
        expect(broadCallableLookups).toBe(1);
      } finally {
        RulesClass.prototype.findMixin = originalFindMixin;
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('callable handles invalidate when callable surfaces change', async () => {
      const originalFindMixin = RulesClass.prototype.findMixin;
      let callableLookups = 0;
      RulesClass.prototype.findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        const [key] = args;
        if (key === '.callable-handle') {
          callableLookups++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        const node = rules([
          mixin({
            name: any('.callable-handle'),
            rules: rules([decl({ name: 'color', value: any('blue') })])
          })
        ]);
        setRulesContext(await node.eval(context));
        const lookupRef = ref({ key: '.callable-handle' }, { type: 'mixin' });

        const first = lookupRef.eval(context);
        expect(first).toBeDefined();
        expect(callableLookups).toBe(1);

        node.push(mixin({
          name: any('.other-callable'),
          rules: rules([decl({ name: 'color', value: any('red') })])
        }));
        const second = lookupRef.eval(context);
        expect(second).toBeDefined();
        expect(callableLookups).toBe(2);
      } finally {
        RulesClass.prototype.findMixin = originalFindMixin;
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
