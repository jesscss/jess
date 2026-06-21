import {
  rules, sel, el, spaced, any, sellist, ruleset, decl, atrule, atrulestatement,
  vardecl, ref, mixin, call, list, op,
  num, dimension, amp, F_MAY_ASYNC,
  F_STATIC, paren, query, seq, comment, nil, quoted, color, co, interpolated,
  keyword, Anonymous
} from '../index.js';
import type { IToken } from 'chevrotain';
import { Context } from '../../context.js';
import {
  AtRule
} from '../at-rule.js';
import { AtRuleStatement } from '../at-rule-statement.js';
import { Rules } from '../rules.js';
import { Node } from '../node.js';
import { serializeTypes } from '../util/serialize-types.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { getPrintOptions, OutputWriter } from '../util/print.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import * as path from 'path';
import * as fs from 'fs';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';

let context: Context;

const token = (image: string, tokenTypeName = 'WS'): IToken => ({
  image,
  tokenType: { name: tokenTypeName } as IToken['tokenType'],
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

class CountingWriter extends OutputWriter {
  captures = 0;
  marks = 0;
  previews = 0;
  reads = 0;
  restores = 0;

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

  override preview(fn: () => string | void, preserveSegments?: boolean): string;
  override preview(fn: () => Promise<string | void>, preserveSegments?: boolean): Promise<string>;
  override preview(fn: () => MaybePromise<string | void>, preserveSegments?: boolean): MaybePromise<string> {
    this.previews++;
    return super.preview(fn, preserveSegments);
  }

  override restore(mark: number): void {
    this.restores++;
    super.restore(mark);
  }
}

describe('AtRule', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('renders string-backed block headers without scalar wrapper nodes', () => {
    const node = atrule({
      name: '@media',
      prelude: 'screen',
      rules: [
        ruleset({
          selector: sel([el('.inside')]),
          rules: [
            decl({ name: 'color', value: any('red') })
          ]
        })
      ]
    });

    expect(node.name).toBe('@media');
    expect(node.prelude).toBe('screen');
    expect(node.toTrimmedString()).toBe([
      '@media screen {',
      '  .inside {',
      '    color: red;',
      '  }',
      '}',
      ''
    ].join('\n'));
    expect(serializeTypes(node)).toContainString(`
      (AtRule
        name: '@media'
        prelude: 'screen'
    `);
  });

  it('evaluates string-backed block headers as static text', async () => {
    const node = atrule({
      name: '@media',
      prelude: 'screen',
      rules: [
        ruleset({
          selector: sel([el('.inside')]),
          rules: [
            decl({ name: 'color', value: any('red') })
          ]
        })
      ]
    });
    const evaluated = await node.eval(context);

    expect(evaluated).toBeInstanceOf(AtRule);
    if (evaluated instanceof AtRule) {
      expect(evaluated.name).toBe('@media');
      expect(evaluated.prelude).toBe('screen');
      expect(evaluated.toString({ context })).toContain('@media screen');
    }
  });

  it('keeps static leaf at-rules canonical in registration prep', async () => {
    const node = new AtRuleStatement({
      name: any('@namespace', { role: 'atkeyword' }),
      prelude: seq([any('svg')])
    });

    const prepared = await node.prepareRegistration(context);

    expect(prepared).toBe(node);
  });

  it('keeps static at-rules canonical in registration prep when child rules are already registration-prepared', async () => {
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    body.registrationPrepared = true;
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([any('screen', { role: 'keyword' })]),
      rules: body.rules
    });

    const prepared = await node.prepareRegistration(context);

    expect(prepared).toBe(node);
  });

  it('compares at-rule names without public string transport', () => {
    const name = any('@media', { role: 'atkeyword' });
    let toStringCalls = 0;
    name.toString = () => {
      toStringCalls++;
      return '@wrong';
    };
    const node = atrulestatement({
      name,
      prelude: seq([any('screen', { role: 'keyword' })])
    });

    expect(node.valueOf()).toBe('@media screen');
    expect(toStringCalls).toBe(0);
  });

  it('includes structured preludes in raw-name at-rule identity', () => {
    const grid = new AtRule({
      name: '@supports',
      prelude: paren(query([any('display:', { role: 'property' }), any('grid', { role: 'keyword' })])),
      rules: []
    });
    const flex = new AtRule({
      name: '@supports',
      prelude: paren(query([any('display:', { role: 'property' }), any('flex', { role: 'keyword' })])),
      rules: []
    });

    expect(grid.valueOf()).toBe('@supports (display: grid)');
    expect(flex.valueOf()).toBe('@supports (display: flex)');
    expect(grid.valueOf()).not.toBe(flex.valueOf());
  });

  it('keeps interpolated at-rule registration prep wrappers self-owned instead of back-pointing to the canonical at-rule', async () => {
    const prelude = seq([any('screen', { role: 'keyword' })]);
    const node = atrulestatement({
      name: interpolated({
        source: '@media',
        replacements: []
      }),
      prelude
    });

    const prepared = await node.prepareRegistration(context);

    expect(prepared).toBe(node);
    expect(prepared).toBeInstanceOf(AtRuleStatement);
    expect(node.name.valueOf()).toBe('@media');
    expect(prelude.parent).toBe(node);
  });

  it('prepares at-rule body registration without replacing the source at-rule', async () => {
    const sourcePrelude = seq([any('screen', { role: 'keyword' })]);
    const sourceRule = decl({ name: 'color', value: any('red') });
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: sourcePrelude,
      rules: [sourceRule]
    });

    const prepared = await node.prepareRegistration(context);

    expect(prepared).toBe(node);
    expect(prepared).toBeInstanceOf(AtRule);
    expect(prepared.rules).toEqual([sourceRule]);
    expect(sourceRule.parent).toBe(node);
    expect(sourcePrelude.parent).toBe(node);
    expect(node.registrationPrepared).toBe(true);
  });

  it('restores at-rule body registration context when child registration prep throws', () => {
    const savedFrame = ruleset({
      selector: el('.parent'),
      rules: []
    });
    const throwingChild = ruleset({
      selector: el('.child'),
      rules: []
    });
    throwingChild.prepareRegistration = () => {
      throw new Error('child registration prep failed');
    };
    const node = atrule({
      name: any('@keyframes', { role: 'atkeyword' }),
      rules: [throwingChild]
    });
    context.rulesetFrames = [savedFrame];
    const extendRootStackLength = context.extendRoots.extendRootStack.length;

    expect(() => node.prepareRegistration(context)).toThrow('child registration prep failed');
    expect(context.rulesetFrames).toEqual([savedFrame]);
    expect(context.extendRoots.extendRootStack).toHaveLength(extendRootStackLength);
  });

  it('restores rules context when at-rule prelude eval throws', () => {
    const savedRulesContext = rules([]);
    const parentAtRule = atrule({
      name: any('@media', { role: 'atkeyword' }),
      rules: savedRulesContext.rules
    });
    const outerRulesContext = rules([parentAtRule]);
    const prelude = any('screen');
    prelude.eval = () => {
      throw new Error('prelude eval failed');
    };
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude,
      rules: []
    });
    for (const savedRule of savedRulesContext.rules) {
      expect(savedRule.parent).toBe(parentAtRule);
    }
    expect(parentAtRule.parent).toBe(outerRulesContext);
    context.rulesContext = savedRulesContext;

    expect(() => node.eval(context)).toThrow('prelude eval failed');
    expect(context.rulesContext).toBe(savedRulesContext);
  });

  it('keeps lifted rules context until async at-rule prelude eval settles', async () => {
    const savedRulesContext = rules([]);
    const parentAtRule = atrule({
      name: any('@media', { role: 'atkeyword' }),
      rules: savedRulesContext.rules
    });
    rules([parentAtRule]);
    const prelude = any('screen');
    prelude.addFlags(F_MAY_ASYNC);
    prelude.eval = async (evalContext: Context) => {
      await Promise.resolve();
      expect(evalContext.rulesContext).toBe(savedRulesContext);
      return any('print');
    };
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude,
      rules: []
    });
    context.rulesContext = savedRulesContext;

    const evaluated = await Promise.resolve(node.eval(context));
    expect(evaluated).toBeInstanceOf(AtRule);
    expect(evaluated).not.toBe(node);
    expect((evaluated as AtRule).prelude?.toTrimmedString()).toBe('print');
    expect(context.rulesContext).toBe(savedRulesContext);
  });

  it('restores at-rule frame when body eval throws', () => {
    const savedFrame = ruleset({
      selector: el('.frame'),
      rules: []
    });
    const throwingChild = decl({ name: 'color', value: ref({ key: 'missing' }, { type: 'variable' }) });
    const node = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: [throwingChild]
    });
    node.removeFlag(F_STATIC);
    context.frames = [savedFrame];

    expect(() => node.eval(context)).toThrow("'missing' is not defined");
    expect(context.frames).toEqual([savedFrame]);
  });

  it('keeps source hoist fields canonical when body eval throws', () => {
    const savedFrame = ruleset({
      selector: el('.frame'),
      rules: []
    });
    const throwingChild = decl({ name: 'color', value: ref({ key: 'missing' }, { type: 'variable' }) });
    const node = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: [throwingChild]
    });
    node.removeFlag(F_STATIC);
    context = new Context({ bubbleRootAtRules: true });
    context.frames = [savedFrame];

    expect(() => node.eval(context)).toThrow("'missing' is not defined");
    expect(node.isHoisted({ collapseNesting: false })).toBe(false);
    expect(node.getRenderFrames()).toBeUndefined();
    expect(node.frames).toBeUndefined();
  });

  it('restores cleared ruleset frames when hoisted body eval throws', () => {
    const savedFrame = ruleset({
      selector: el('.frame'),
      rules: []
    });
    const throwingChild = decl({ name: 'color', value: ref({ key: 'missing' }, { type: 'variable' }) });
    const node = atrule({
      name: any('@keyframes', { role: 'atkeyword' }),
      rules: [throwingChild]
    });
    node.removeFlag(F_STATIC);
    context = new Context({ bubbleRootAtRules: true });
    context.frames = [savedFrame];
    context.rulesetFrames = [savedFrame];

    expect(() => node.eval(context)).toThrow("'missing' is not defined");
    expect(context.rulesetFrames).toEqual([savedFrame]);
  });

  it('restores at-rule frame when body eval rejects', async () => {
    const savedFrame = ruleset({
      selector: el('.frame'),
      rules: []
    });
    const throwingChild = decl({ name: 'color', value: ref({ key: 'missing' }, { type: 'variable' }) });
    const node = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: [throwingChild]
    });
    node.removeFlag(F_STATIC);
    context.frames = [savedFrame];

    expect(() => node.eval(context)).toThrow("'missing' is not defined");
    expect(context.frames).toEqual([savedFrame]);
  });

  it('keeps source hoist fields canonical when body eval rejects', async () => {
    const savedFrame = ruleset({
      selector: el('.frame'),
      rules: []
    });
    const throwingChild = decl({ name: 'color', value: ref({ key: 'missing' }, { type: 'variable' }) });
    const node = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: [throwingChild]
    });
    node.removeFlag(F_STATIC);
    context = new Context({ bubbleRootAtRules: true });
    context.frames = [savedFrame];

    expect(() => node.eval(context)).toThrow("'missing' is not defined");
    expect(node.isHoisted({ collapseNesting: false })).toBe(false);
    expect(node.getRenderFrames()).toBeUndefined();
    expect(node.frames).toBeUndefined();
  });

  it('renders resolved at-rules through render(context)', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('print')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;

    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });

    expect(node.render(context)).toBeString(`
      @media print {
        color: red;
      }
    `);
  });

  it('writes non-leaf at-rule syntax without public string wrapper transport', () => {
    const writer = new CountingWriter();
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: any('screen'),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    node.toTrimmedString = () => {
      throw new Error('AtRule.writeSyntax should not call the public string wrapper');
    };

    expect(() => node.writeSyntax(getPrintOptions({ writer }))).not.toThrow();
    expect(writer.toString()).toBeString(`
      @media screen {
        color: red;
      }
    `);
  });

  it('writes finalized at-rule output into segmented buffers', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('print')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;

    const buffer = createRenderBuffer('segmented');
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
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

    const rendered = await Promise.resolve(node.render(context, buffer));

    expect(rendered).toBeString(`
      @media print {
        color: red;
      }
    `);
    expect(buffer.segments).toHaveLength(1);
    expect(buffer.segments[0]).toBeString(`
      @media print {
        color: red;
      }
    `);
    expect(resolveCalls).toBe(0);
  });

  it('renders resolved at-rule output directly without public resolve', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('print')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;

    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    node.resolve = () => {
      throw new Error('AtRule direct render should evaluate a derived surface');
    };

    expect(node.render(context)).toBeString(`
      @media print {
        color: red;
      }
    `);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('registers nested layer names from invocation records without mutating source children', async () => {
    const nestedBody = rules([
      ruleset({
        selector: el('.inner'),
        rules: [decl({ name: 'color', value: any('red') })]
      })
    ]);
    const nestedLayer = atrule({
      name: any('@layer', { role: 'atkeyword' }),
      prelude: any('child'),
      rules: nestedBody.rules
    });
    const outerBody = rules([nestedLayer]);
    const outerLayer = atrule({
      name: any('@layer', { role: 'atkeyword' }),
      prelude: any('parent'),
      rules: outerBody.rules
    });
    const registeredLayers: Array<string | undefined> = [];
    const originalRegisterRoot = context.extendRoots.registerRoot.bind(context.extendRoots);
    context.extendRoots.registerRoot = function registerRootWithLayerCapture(
      ...args: Parameters<typeof originalRegisterRoot>
    ): ReturnType<typeof originalRegisterRoot> {
      registeredLayers.push(args[2]?.layerName);
      return originalRegisterRoot(...args);
    };

    const root = rules([outerLayer]);

    await Promise.resolve(root.render(context));

    expect(registeredLayers).toContain('parent');
    expect(registeredLayers).toContain('parent.child');
    expect(outerBody.parent).toBeUndefined();
    expect(nestedLayer.parent).toBe(outerLayer);
    expect(nestedBody.parent).toBeUndefined();
    expect(outerLayer.rules).toBe(outerBody.rules);
    expect(nestedLayer.rules).toBe(nestedBody.rules);
  });

  it('registers nested layer names without public string transport', async () => {
    const outerName = any('@layer', { role: 'atkeyword' });
    const nestedName = any('@layer', { role: 'atkeyword' });
    const nestedPrelude = any('child');
    const nestedBody = rules([
      ruleset({
        selector: el('.inner'),
        rules: [decl({ name: 'color', value: any('red') })]
      })
    ]);
    const nestedLayer = atrule({
      name: nestedName,
      prelude: nestedPrelude,
      rules: nestedBody.rules
    });
    const outerBody = rules([nestedLayer]);
    const outerLayer = atrule({
      name: outerName,
      prelude: any('parent'),
      rules: outerBody.rules
    });
    const registeredLayers: Array<string | undefined> = [];
    const originalRegisterRoot = context.extendRoots.registerRoot.bind(context.extendRoots);
    context.extendRoots.registerRoot = function registerRootWithLayerCapture(
      ...args: Parameters<typeof originalRegisterRoot>
    ): ReturnType<typeof originalRegisterRoot> {
      registeredLayers.push(args[2]?.layerName);
      return originalRegisterRoot(...args);
    };
    outerName.toTrimmedString = () => {
      throw new Error('layer extraction should not use public toTrimmedString for at-rule names');
    };
    outerName.toString = () => {
      throw new Error('layer extraction should not use public toString for at-rule names');
    };
    nestedName.toTrimmedString = () => {
      throw new Error('layer extraction should not use public toTrimmedString for nested at-rule names');
    };
    nestedName.toString = () => {
      throw new Error('layer extraction should not use public toString for nested at-rule names');
    };
    nestedPrelude.toTrimmedString = () => {
      throw new Error('layer extraction should not use public toTrimmedString for layer preludes');
    };
    nestedPrelude.toString = () => {
      throw new Error('layer extraction should not use public toString for layer preludes');
    };

    const root = rules([outerLayer]);

    await Promise.resolve(root.render(context));

    expect(registeredLayers).toContain('parent');
    expect(registeredLayers).toContain('parent.child');
  });

  it('registers async nested layer names from invocation records without mutating source children', async () => {
    const nestedPrelude = any('child');
    nestedPrelude.addFlag(F_MAY_ASYNC);
    nestedPrelude.eval = async () => {
      await Promise.resolve();
      return any('child');
    };
    const nestedBody = rules([
      ruleset({
        selector: el('.inner'),
        rules: [decl({ name: 'color', value: any('red') })]
      })
    ]);
    const nestedLayer = atrule({
      name: any('@layer', { role: 'atkeyword' }),
      prelude: nestedPrelude,
      rules: nestedBody.rules
    });
    const outerBody = rules([nestedLayer]);
    const outerLayer = atrule({
      name: any('@layer', { role: 'atkeyword' }),
      prelude: any('parent'),
      rules: outerBody.rules
    });
    const registeredLayers: Array<string | undefined> = [];
    const originalRegisterRoot = context.extendRoots.registerRoot.bind(context.extendRoots);
    context.extendRoots.registerRoot = function registerRootWithLayerCapture(
      ...args: Parameters<typeof originalRegisterRoot>
    ): ReturnType<typeof originalRegisterRoot> {
      registeredLayers.push(args[2]?.layerName);
      return originalRegisterRoot(...args);
    };

    const root = rules([outerLayer]);

    await Promise.resolve(root.render(context));

    expect(registeredLayers).toContain('parent');
    expect(registeredLayers).toContain('parent.child');
    expect(outerBody.parent).toBeUndefined();
    expect(nestedLayer.parent).toBe(outerLayer);
    expect(nestedBody.parent).toBeUndefined();
    expect(outerLayer.rules).toBe(outerBody.rules);
    expect(nestedLayer.rules).toBe(nestedBody.rules);
  });

  it('renders already evaluated at-rules without deriving another eval surface', async () => {
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([any('screen')]),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    const evald = await node.eval(context);
    const originalEval = AtRule.prototype.eval;
    let evalCalls = 0;
    AtRule.prototype.eval = function countEvalCalls(
      this: AtRule,
      ...args: Parameters<typeof originalEval>
    ): ReturnType<typeof originalEval> {
      evalCalls++;
      return originalEval.apply(this, args);
    };

    try {
      await expect(Promise.resolve(evald.render(context))).resolves.toBeString(`
        @media screen {
          color: red;
        }
      `);
      expect(evalCalls).toBe(0);
    } finally {
      AtRule.prototype.eval = originalEval;
    }
  });

  it('renders evaluated at-rules with owned body state without reading source runtime render rules', async () => {
    const root = rules([
      vardecl({ name: 'accent', value: any('blue') })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const originalRules = rules([
      decl({ name: 'color', value: ref({ key: 'accent' }, { type: 'variable' }) })
    ]);
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([any('screen')]),
      rules: originalRules.rules
    });
    const evaluated = await node.eval(context);
    if (!(evaluated instanceof AtRule)) {
      throw new Error('Expected evaluated AtRule result');
    }
    node.getRenderRules = () => {
      throw new Error('evaluated render should not read source runtime render rules');
    };

    expect(evaluated).not.toBe(node);
    expect(evaluated.render(context)).toBeString(`
      @media screen {
        color: blue;
      }
    `);
  });

  it('renders static at-rules without deriving or evaluating', () => {
    const node = atrulestatement({
      name: any('@namespace', { role: 'atkeyword' }),
      prelude: seq([any('svg')])
    });
    const originalEval = AtRule.prototype.eval;
    let evalCalls = 0;
    AtRule.prototype.eval = function countEvalCalls(
      this: AtRuleStatement,
      ...args: Parameters<typeof originalEval>
    ): ReturnType<typeof originalEval> {
      evalCalls++;
      return originalEval.apply(this, args);
    };

    try {
      expect(node.render(context)).toBe('@namespace svg;');
      expect(evalCalls).toBe(0);
      expect(node.evaluated).toBe(false);
    } finally {
      AtRule.prototype.eval = originalEval;
    }
  });

  it('renders dynamic leaf at-rule preludes without evaluating an at-rule surface', async () => {
    const namespaceValue = any('svg');
    const root = rules([
      vardecl({
        name: 'namespace',
        value: namespaceValue
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const name = any('@namespace', { role: 'atkeyword' });
    const prelude = seq([ref({ key: 'namespace' }, { type: 'variable' })]);
    const node = atrulestatement({
      name,
      prelude
    });
    const originalEval = AtRule.prototype.eval;
    const originalNameToString = name.toString;
    const originalNameWriteSyntax = name.writeSyntax;
    const originalPreludeToString = node.prelude!.toString;
    const originalNamespaceValueWriteSyntax = namespaceValue.writeSyntax;
    let nameStringCalls = 0;
    let preludeStringCalls = 0;
    let nameWriteSyntaxCalls = 0;
    let namespaceValueWriteSyntaxCalls = 0;
    name.toString = () => {
      nameStringCalls++;
      return '@wrong';
    };
    name.writeSyntax = function countNameWriteSyntax(
      this: typeof name,
      ...args: Parameters<typeof originalNameWriteSyntax>
    ): ReturnType<typeof originalNameWriteSyntax> {
      nameWriteSyntaxCalls++;
      return originalNameWriteSyntax.apply(this, args);
    };
    namespaceValue.writeSyntax = function countNamespaceValueWriteSyntax(
      this: typeof namespaceValue,
      ...args: Parameters<typeof originalNamespaceValueWriteSyntax>
    ): ReturnType<typeof originalNamespaceValueWriteSyntax> {
      namespaceValueWriteSyntaxCalls++;
      return originalNamespaceValueWriteSyntax.apply(this, args);
    };
    AtRule.prototype.eval = () => {
      throw new Error('leaf at-rule render should not evaluate an at-rule surface');
    };

    try {
      node.prelude!.toString = function countPreludeString(
        this: typeof prelude,
        ...args: Parameters<typeof originalPreludeToString>
      ): string {
        preludeStringCalls++;
        return originalPreludeToString.apply(this, args);
      };
      expect(await Promise.resolve(node.render(context))).toBe('@namespace svg;');
      const buffer = createRenderBuffer('flat');
      expect(await Promise.resolve(node.render(context, buffer))).toBe('@namespace svg;');
      expect(buffer.parts).toEqual(['@namespace svg;']);
      expect(nameStringCalls).toBe(0);
      expect(preludeStringCalls).toBe(0);
      expect(nameWriteSyntaxCalls).toBe(0);
      expect(namespaceValueWriteSyntaxCalls).toBe(0);
      name.toString = originalNameToString;
      name.writeSyntax = originalNameWriteSyntax;
      namespaceValue.writeSyntax = originalNamespaceValueWriteSyntax;
      node.prelude!.toString = originalPreludeToString;
      const resolved = await Promise.resolve(node.resolve(context));
      expect(resolved.toTrimmedString()).toBe('@namespace svg;');
      expect(prelude.parent).toBe(node);
      expect(prelude.evaluated).toBe(false);
      expect(node.evaluated).toBe(false);
    } finally {
      AtRule.prototype.eval = originalEval;
      name.toString = originalNameToString;
      name.writeSyntax = originalNameWriteSyntax;
      namespaceValue.writeSyntax = originalNamespaceValueWriteSyntax;
      node.prelude!.toString = originalPreludeToString;
    }
  });

  it('keeps source at-rule bodies canonical during dynamic direct render', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('print')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const sourcePrelude = seq([ref({ key: 'mode' }, { type: 'variable' })]);
    const sourceRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: sourcePrelude,
      rules: sourceRules.rules
    });
    const buffer = createRenderBuffer('segmented');

    expect(await Promise.resolve(node.render(context))).toBeString(`
      @media print {
        color: red;
      }
    `);
    expect(await Promise.resolve(node.render(context, buffer))).toBeString(`
      @media print {
        color: red;
      }
    `);
    expect(buffer.segments[0]).toBeString(`
      @media print {
        color: red;
      }
    `);
    expect(node.prelude).toBe(sourcePrelude);
    expect(sourcePrelude.parent).toBe(node);
    expect(sourcePrelude.evaluated).toBe(false);
    expect(sourceRules.parent).toBeUndefined();
    expect(sourceRules.evaluated).toBe(false);
    expect(node.getRenderRules()).toBe(sourceRules.rules);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('keeps dynamic body eval on an owned rules target instead of the canonical source rules', async () => {
    const sourceRules = rules([
      decl({
        name: 'color',
        value: call({ name: 'rgb', args: list([num(1), num(2), num(3)]) })
      })
    ]);
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: any('screen'),
      rules: sourceRules.rules
    });
    sourceRules.eval = () => {
      throw new Error('Dynamic at-rule render must not eval canonical source rules');
    };

    await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
      @media screen {
        color: rgb(1, 2, 3);
      }
    `);
    expect(sourceRules.parent).toBeUndefined();
    expect(sourceRules.evaluated).toBe(false);
  });

  it('renders plain static body rules without an owned body eval target', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('print')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const sourceRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: sourceRules.rules
    });
    const originalEval = Rules.prototype.eval;
    let rulesEvalCalls = 0;
    Rules.prototype.eval = function countRulesEval(
      this: Rules,
      ...args: Parameters<typeof originalEval>
    ): ReturnType<typeof originalEval> {
      rulesEvalCalls++;
      return originalEval.apply(this, args);
    };
    try {
      expect(await Promise.resolve(node.render(context))).toBeString(`
        @media print {
          color: red;
        }
      `);
    } finally {
      Rules.prototype.eval = originalEval;
    }
    expect(rulesEvalCalls).toBe(0);
    expect(sourceRules.parent).toBeUndefined();
    expect(sourceRules.evaluated).toBe(false);
  });

  it('renders static invisible var body rules without an owned body eval target', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('print')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const variable = vardecl({ name: 'brand', value: any('red') });
    const sourceRules = rules([
      variable,
      decl({ name: 'color', value: any('red') })
    ]);
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: sourceRules.rules
    });
    const originalRulesEval = Rules.prototype.eval;
    const originalVarEval = variable.eval;
    let rulesEvalCalls = 0;
    let varEvalCalls = 0;
    Rules.prototype.eval = function countRulesEval(
      this: Rules,
      ...args: Parameters<typeof originalRulesEval>
    ): ReturnType<typeof originalRulesEval> {
      rulesEvalCalls++;
      return originalRulesEval.apply(this, args);
    };
    variable.eval = function countVarEval(
      this: typeof variable,
      ...args: Parameters<typeof originalVarEval>
    ): ReturnType<typeof originalVarEval> {
      varEvalCalls++;
      return originalVarEval.apply(this, args);
    };
    try {
      expect(await Promise.resolve(node.render(context))).toBeString(`
        @media print {
          color: red;
        }
      `);
    } finally {
      Rules.prototype.eval = originalRulesEval;
      variable.eval = originalVarEval;
    }
    expect(rulesEvalCalls).toBe(0);
    expect(varEvalCalls).toBe(0);
    expect(sourceRules.parent).toBeUndefined();
    expect(sourceRules.evaluated).toBe(false);
    expect(variable.parent).toBe(node);
    expect(variable.evaluated).toBe(false);
  });

  it('renders static root-only body rules with hoist side state without an owned body eval target', async () => {
    const parentFrame = ruleset({
      selector: el('.parent'),
      rules: []
    });
    context = new Context({ bubbleRootAtRules: true });
    context.frames = [parentFrame];
    const sourceRules = rules([
      decl({ name: 'font-family', value: any('Jess') })
    ]);
    const node = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: sourceRules.rules
    });
    const originalEval = Rules.prototype.eval;
    let rulesEvalCalls = 0;
    Rules.prototype.eval = function countRulesEval(
      this: Rules,
      ...args: Parameters<typeof originalEval>
    ): ReturnType<typeof originalEval> {
      rulesEvalCalls++;
      return originalEval.apply(this, args);
    };
    node.withParts = function deriveShouldNotRun(): AtRule {
      throw new Error('static direct root-only body render should not derive a temporary at-rule');
    };
    try {
      expect(await Promise.resolve(node.render(context))).toBeString(`
        @font-face {
          font-family: Jess;
        }
      `);
    } finally {
      Rules.prototype.eval = originalEval;
    }
    expect(rulesEvalCalls).toBe(0);
    expect(node.hoistToRoot).toBeUndefined();
    expect(node.frames).toBeUndefined();
    expect(sourceRules.parent).toBeUndefined();
    expect(sourceRules.evaluated).toBe(false);
  });

  it('keeps direct body-render visibility off the source at-rule', async () => {
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: any('screen'),
      rules: [
        vardecl({ name: 'hidden', value: any('yes') })
      ]
    });

    expect(await Promise.resolve(node.render(context))).toBe('');
    expect(node.visible).toBe(true);
    expect(node.rules[0]?.parent).toBe(node);
    expect(node.rules[0]?.evaluated).toBe(false);
  });

  it('keeps public body-resolve visibility on the owned result', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('screen')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const sourceRules = rules([
      vardecl({ name: 'hidden', value: any('yes') })
    ]);
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: sourceRules.rules
    });

    const resolved = await Promise.resolve(node.resolve(context));

    expect(resolved.toString()).toBe('');
    expect(node.visible).toBe(true);
    expect(node.rules).toBe(sourceRules.rules);
    expect(sourceRules.parent).toBeUndefined();
    if (resolved instanceof AtRule) {
      expect(resolved).not.toBe(node);
      expect(resolved.visible).toBe(false);
    }
  });

  it('keeps direct body-render hoist facts off the source at-rule', async () => {
    const parentFrame = ruleset({
      selector: el('.parent'),
      rules: []
    });
    context = new Context({ bubbleRootAtRules: true });
    context.frames = [parentFrame];
    const node = atrule({
      name: any('@keyframes', { role: 'atkeyword' }),
      prelude: seq([any('spin', { role: 'keyword' })]),
      rules: [
        ruleset({
          selector: el('to'),
          rules: [
            decl({ name: 'opacity', value: dimension([1]) })
          ]
        })
      ]
    });

    expect(await Promise.resolve(node.render(context))).toBeString(`
      @keyframes spin {
        to {
          opacity: 1;
        }
      }
    `);
    expect(node.hoistToRoot).toBeUndefined();
    expect(node.frames).toBeUndefined();
    expect(node.evaluated).toBe(false);
    expect(node.getRenderRules()).toBe(node.rules);
  });

  it('returns an owned at-rule when body eval changes hoist output', async () => {
    const parentFrame = ruleset({
      selector: el('.parent'),
      rules: []
    });
    context = new Context({ bubbleRootAtRules: true });
    context.frames = [parentFrame];
    const node = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: [
        decl({ name: 'font-family', value: any('Jess') })
      ]
    });

    const evaluated = await Promise.resolve(node.eval(context));

    expect(evaluated).toBeInstanceOf(AtRule);
    expect(evaluated).not.toBe(node);
    expect(node.frames).toBeUndefined();
    expect(node.hoistToRoot).toBeUndefined();
    expect(node.isHoisted({ collapseNesting: false })).toBe(false);
    if (!(evaluated instanceof AtRule)) {
      throw new Error('Expected AtRule eval result');
    }
    expect(evaluated.hoistToRoot).toBe(true);
    expect(evaluated.isHoisted({ collapseNesting: false })).toBe(true);
    expect(evaluated.getRenderFrames()).toBeUndefined();
    expect(evaluated.toTrimmedString()).toBeString(`
      @font-face {
        font-family: Jess;
      }
    `);
  });

  it('returns owned evaluated collapse-nesting hoist state in frames without a runtime hoist field', async () => {
    const parentFrame = ruleset({
      selector: el('.parent'),
      rules: []
    });
    context.opts.collapseNesting = true;
    context.frames = [parentFrame];
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: paren(decl({ name: 'max-width', value: dimension([10, 'px']) })),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });

    const evaluated = await Promise.resolve(node.eval(context));

    expect(evaluated).toBeInstanceOf(AtRule);
    expect(evaluated).not.toBe(node);
    expect(node.hoistToRoot).toBeUndefined();
    expect(node.frames).toBeUndefined();
    expect(node.isHoisted({ collapseNesting: false })).toBe(false);
    expect(node.getRenderFrames()).toBeUndefined();
    if (!(evaluated instanceof AtRule)) {
      throw new Error('Expected AtRule eval result');
    }
    expect(evaluated.hoistToRoot).toBeUndefined();
    expect(evaluated.frames).toEqual([parentFrame]);
    expect(evaluated.isHoisted({ collapseNesting: false })).toBe(true);
    expect(evaluated.getRenderFrames()).toEqual([parentFrame]);
  });

  it('renders owned evaluated collapse-nesting at-rules without mutating source frame state', async () => {
    const parentFrame = ruleset({
      selector: el('.parent'),
      rules: []
    });
    context.opts.collapseNesting = true;
    context.frames = [parentFrame];
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: paren(decl({ name: 'max-width', value: dimension([10, 'px']) })),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });

    const evaluated = await Promise.resolve(node.eval(context));

    expect(evaluated).toBeInstanceOf(AtRule);
    expect(evaluated).not.toBe(node);
    if (!(evaluated instanceof AtRule)) {
      throw new Error('Expected AtRule eval result');
    }
    expect(evaluated.render(context)).toBeString(`
      @media (max-width: 10px) {
        .parent {
          color: red;
        }
      }
    `);
    expect(node.frames).toBeUndefined();
    expect(node.hoistToRoot).toBeUndefined();
    expect(node.getRenderFrames()).toBeUndefined();
    expect(evaluated.getRenderFrames()).toEqual([parentFrame]);
  });

  it('renders owned evaluated collapse-nesting at-rules without deriving another temporary at-rule node', async () => {
    const parentFrame = ruleset({
      selector: el('.parent'),
      rules: []
    });
    context.opts.collapseNesting = true;
    context.frames = [parentFrame];
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: paren(decl({ name: 'max-width', value: dimension([10, 'px']) })),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });

    const evaluated = await Promise.resolve(node.eval(context));

    expect(evaluated).toBeInstanceOf(AtRule);
    if (!(evaluated instanceof AtRule)) {
      throw new Error('Expected AtRule eval result');
    }
    evaluated.withParts = function deriveShouldNotRun(): AtRule {
      throw new Error('evaluated collapse-nesting render should not derive a temporary at-rule');
    };

    expect(evaluated.render(context)).toBeString(`
      @media (max-width: 10px) {
        .parent {
          color: red;
        }
      }
    `);
  });

  it('serializes owned evaluated collapse-nesting at-rules without consulting source compatibility frame getters', async () => {
    const parentFrame = ruleset({
      selector: el('.parent'),
      rules: []
    });
    context.opts.collapseNesting = true;
    context.frames = [parentFrame];
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: paren(decl({ name: 'max-width', value: dimension([10, 'px']) })),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });

    const evaluated = await Promise.resolve(node.eval(context));

    expect(evaluated).toBeInstanceOf(AtRule);
    expect(evaluated).not.toBe(node);
    if (!(evaluated instanceof AtRule)) {
      throw new Error('Expected AtRule eval result');
    }
    expect(node.hoistToRoot).toBeUndefined();
    expect(node.frames).toBeUndefined();
    node.getRenderFrames = function getRenderFramesShouldNotRun(): AtRule['frames'] {
      throw new Error('evaluated collapse-nesting serialization should not consult compatibility frame getters');
    };
    expect(evaluated.toTrimmedString()).toBeString(`
      @media (max-width: 10px) {
        .parent {
          color: red;
        }
      }
    `);
  });

  it('keeps async collapse-nesting frame state on the owned result without mutating source state', async () => {
    const parentFrame = ruleset({
      selector: el('.parent'),
      rules: []
    });
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    body.addFlag(F_MAY_ASYNC);
    body.eval = async () => {
      await Promise.resolve();
      return body;
    };
    context.opts.collapseNesting = true;
    context.frames = [parentFrame];
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: paren(decl({ name: 'max-width', value: dimension([10, 'px']) })),
      rules: body.rules
    });

    const evaluated = await Promise.resolve(node.eval(context));

    expect(evaluated).toBeInstanceOf(AtRule);
    expect(evaluated).not.toBe(node);
    if (!(evaluated instanceof AtRule)) {
      throw new Error('Expected AtRule eval result');
    }
    expect(node.frames).toBeUndefined();
    expect(node.hoistToRoot).toBeUndefined();
    expect(node.getRenderFrames()).toBeUndefined();
    expect(evaluated.getRenderFrames()).toEqual([parentFrame]);
    expect(evaluated.render(context)).toBeString(`
      @media (max-width: 10px) {
        .parent {
          color: red;
        }
      }
    `);
  });

  it('carries direct body-render prelude evaluation through body state once', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('print')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const sourcePrelude = seq([ref({ key: 'mode' }, { type: 'variable' })]);
    const originalEval = sourcePrelude.eval;
    let preludeEvalCalls = 0;
    sourcePrelude.eval = function evalPreludeForCounting(
      this: typeof sourcePrelude,
      ...args: Parameters<typeof originalEval>
    ): ReturnType<typeof originalEval> {
      preludeEvalCalls++;
      return originalEval.apply(this, args);
    };
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: sourcePrelude,
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });

    node.withParts = function deriveShouldNotRun(): AtRule {
      throw new Error('direct body render with evaluated prelude should not derive a temporary at-rule');
    };

    expect(await Promise.resolve(node.render(context))).toBeString(`
      @media print {
        color: red;
      }
    `);
    expect(preludeEvalCalls).toBe(1);
    expect(node.prelude).toBe(sourcePrelude);
    expect(sourcePrelude.parent).toBe(node);
    expect(sourcePrelude.evaluated).toBe(false);
    expect(node.evaluated).toBe(false);
  });

  it('returns owned evaluated at-rule body output without mutating source value.rules', async () => {
    const root = rules([
      vardecl({ name: 'accent', value: any('blue') })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const sourceDecl = decl({ name: 'color', value: ref({ key: 'accent' }, { type: 'variable' }) });
    const originalRules = rules([
      sourceDecl
    ]);
    const node = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: originalRules.rules
    });

    const evaluated = await Promise.resolve(node.eval(context));

    expect(evaluated).toBeInstanceOf(AtRule);
    if (!(evaluated instanceof AtRule)) {
      throw new Error('Expected evaluated AtRule result');
    }
    expect(evaluated).not.toBe(node);
    expect(node.rules).toBe(originalRules.rules);
    expect(node.getRenderRules()).toBe(originalRules.rules);
    expect(evaluated.rules).not.toBe(originalRules.rules);
    expect(evaluated.getRenderRules()).toBe(evaluated.rules);
    expect(evaluated.rules[0]).not.toBe(sourceDecl);
    expect(node.toTrimmedString()).toBeString(`
      @font-face {
        color: $accent;
      }
    `);
    expect(evaluated.toTrimmedString()).toBeString(`
      @font-face {
        color: blue;
      }
    `);
    expect(originalRules.parent).toBeUndefined();
  });

  it('keeps source body state canonical when post-eval visibility checks throw', async () => {
    const root = rules([
      vardecl({ name: 'accent', value: any('blue') })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const originalRules = rules([
      decl({ name: 'color', value: ref({ key: 'accent' }, { type: 'variable' }) })
    ]);
    const node = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: originalRules.rules
    });
    const originalHasVisibleRules = Rules.prototype.hasVisibleRules;
    Rules.prototype.hasVisibleRules = function throwAfterEval(
      this: Rules,
      ..._args: Parameters<typeof originalHasVisibleRules>
    ): ReturnType<typeof originalHasVisibleRules> {
      if (this !== originalRules && this.rules.length === 1) {
        throw new Error('hasVisibleRules failed');
      }
      return originalHasVisibleRules.apply(this, _args);
    };

    try {
      expect(() => node.eval(context)).toThrow('hasVisibleRules failed');
      expect(node.rules).toBe(originalRules.rules);
      expect(node.getRenderRules()).toBe(originalRules.rules);
      expect(node.toTrimmedString()).toBeString(`
        @font-face {
          color: $accent;
        }
      `);
    } finally {
      Rules.prototype.hasVisibleRules = originalHasVisibleRules;
    }
  });

  it('resolves at-rules without touching render state', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('print')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;

    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    const sourceName = node.name;
    const sourcePrelude = node.prelude;
    const sourceRules = node.rules;

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBeString(`
      @media print {
        color: red;
      }
    `);
    expect(sourceName.parent).toBe(node);
    expect(sourcePrelude?.parent).toBe(node);
    expect(sourceRules[0]?.parent).toBe(node);
    expect(node.prelude).toBe(sourcePrelude);
    if (resolved instanceof AtRule) {
      expect(resolved.prelude).not.toBe(sourcePrelude);
    }
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('resolves body at-rule output through a public result adapter', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('screen')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const originalRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const evaluatedRules = rules([
      decl({ name: 'color', value: any('blue') })
    ]);
    originalRules.prepareRegistration = function prepareReplacementBody() {
      evaluatedRules.registrationPrepared = true;
      return evaluatedRules;
    };
    evaluatedRules.eval = function evalReplacementBody(
      this: Rules,
      ..._args: Parameters<typeof evaluatedRules.eval>
    ): ReturnType<typeof evaluatedRules.eval> {
      evaluatedRules.evaluated = true;
      return evaluatedRules;
    };
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: originalRules.rules
    });

    const resolved = await Promise.resolve(node.resolve(context));

    expect(resolved).toBeInstanceOf(AtRule);
    if (!(resolved instanceof AtRule)) {
      throw new Error('Expected AtRule result');
    }
    expect(resolved).not.toBe(node);
    expect(resolved.getRenderRules()).not.toBe(originalRules.rules);
    expect(resolved.toTrimmedString()).toBeString(`
      @media screen {
        color: red;
      }
    `);
    expect(node.rules).toBe(originalRules.rules);
    expect(originalRules.parent).toBeUndefined();
  });

  it('resolves body at-rules with the source frame while owning the public result at the adapter', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('screen')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const sourceRules = rules([
      ruleset({
        selector: el('.box'),
        rules: [
          decl({ name: 'color', value: any('red') })
        ]
      })
    ]);
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: sourceRules.rules
    });
    const sourcePrelude = node.prelude;
    const originalPrepareRegistration = Rules.prototype.prepareRegistration;
    const bodyPrepFrames: Node[] = [];
    Rules.prototype.prepareRegistration = function countBodyPrepFrame(
      this: Rules,
      ...args: Parameters<typeof originalPrepareRegistration>
    ): ReturnType<typeof originalPrepareRegistration> {
      if (this !== context.root) {
        bodyPrepFrames.push(context.frames.at(-1)!);
      }
      return originalPrepareRegistration.apply(this, args);
    };

    let resolved: Node;
    try {
      resolved = await Promise.resolve(node.resolve(context));
    } finally {
      Rules.prototype.prepareRegistration = originalPrepareRegistration;
    }

    expect(bodyPrepFrames).toContain(node);
    expect(resolved).toBeInstanceOf(AtRule);
    if (!(resolved instanceof AtRule)) {
      throw new Error('Expected AtRule result');
    }
    expect(resolved).not.toBe(node);
    expect(resolved.toTrimmedString()).toBeString(`
      @media screen {
        .box {
          color: red;
        }
      }
    `);
    expect(node.prelude).toBe(sourcePrelude);
    expect(sourcePrelude?.parent).toBe(node);
    expect(node.rules).toBe(sourceRules.rules);
    expect(sourceRules.parent).toBeUndefined();
    expect(node.evaluated).toBe(false);
    expect(node.visible).toBe(true);
  });

  it('keeps public body at-rule resolve results mutable and isolated even when output is unchanged', async () => {
    const root = rules([
      vardecl({
        name: any('mode'),
        value: any('screen')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const sourcePrelude = seq([ref({ key: 'mode' }, { type: 'variable' })]);
    const sourceRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: sourcePrelude,
      rules: sourceRules.rules
    });

    const first = await Promise.resolve(node.resolve(context));
    const second = await Promise.resolve(node.resolve(context));

    expect(first).toBeInstanceOf(AtRule);
    expect(second).toBeInstanceOf(AtRule);
    if (!(first instanceof AtRule) || !(second instanceof AtRule)) {
      throw new Error('Expected public at-rule results');
    }

    first.prelude = any('print');

    expect(first).not.toBe(node);
    expect(first).not.toBe(second);
    expect(second.prelude?.toTrimmedString()).toBe('screen');
    expect(node.prelude).toBe(sourcePrelude);
    expect(node.rules).toBe(sourceRules.rules);
    expect(sourcePrelude.parent).toBe(node);
    expect(sourceRules.parent).toBeUndefined();
  });

  it('stores public body resolve facts directly on the owned result node', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('spin')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const parentFrame = ruleset({
      selector: el('.parent'),
      rules: []
    });
    context = new Context({ bubbleRootAtRules: true });
    context.frames = [parentFrame];
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const sourcePrelude = seq([ref({ key: 'mode' }, { type: 'variable' })]);
    const sourceRules = rules([
      ruleset({
        selector: el('to'),
        rules: [
          decl({ name: 'opacity', value: dimension([1]) })
        ]
      })
    ]);
    const node = atrule({
      name: any('@keyframes', { role: 'atkeyword' }),
      prelude: sourcePrelude,
      rules: sourceRules.rules
    });

    const resolved = await Promise.resolve(node.resolve(context));

    expect(resolved).toBeInstanceOf(AtRule);
    if (!(resolved instanceof AtRule)) {
      throw new Error('Expected public at-rule result');
    }

    expect(resolved).not.toBe(node);
    expect(resolved.rules).not.toBe(sourceRules.rules);
    expect(resolved.getRenderRules()).toBe(resolved.rules);
    expect(resolved.hoistToRoot).toBe(true);
    expect(resolved.isHoisted({ collapseNesting: false })).toBe(true);
    expect(resolved.getRenderFrames()).toBeUndefined();
    expect(resolved.frames).toBeUndefined();
    expect(resolved.toTrimmedString()).toBeString(`
      @keyframes spin {
        to {
          opacity: 1;
        }
      }
    `);
    expect(node.prelude).toBe(sourcePrelude);
    expect(node.rules).toBe(sourceRules.rules);
    expect(sourcePrelude.parent).toBe(node);
    expect(sourceRules.parent).toBeUndefined();
    expect(node.hoistToRoot).toBeUndefined();
    expect(node.frames).toBeUndefined();
  });

  it('resolves static at-rules without deriving or evaluating', () => {
    const node = atrulestatement({
      name: any('@namespace', { role: 'atkeyword' }),
      prelude: seq([any('svg')])
    });
    const originalEval = AtRuleStatement.prototype.eval;
    let evalCalls = 0;
    AtRuleStatement.prototype.eval = function countEvalCalls(
      this: AtRuleStatement,
      ...args: Parameters<typeof originalEval>
    ): ReturnType<typeof originalEval> {
      evalCalls++;
      return originalEval.apply(this, args);
    };

    try {
      const resolved = node.resolve(context);

      expect(resolved).toBe(node);
      expect(evalCalls).toBe(0);
      expect(node.evaluated).toBe(false);
      expect(context.printState.writer).toBeUndefined();
    } finally {
      AtRuleStatement.prototype.eval = originalEval;
    }
  });

  it('serializes comment trivia between at-rule preludes and blocks', () => {
    const name = any('@-webkit-keyframes', { role: 'atkeyword' });
    name._location = [0, 1, 1, 17, 1, 18];
    const prelude = any('hover', { role: 'keyword' });
    prelude._location = [32, 1, 33, 36, 1, 37];
    const leading = [token(' '), token('/* Safari */', 'BlockComment'), token(' ')];
    const trailing = [token(' '), token('/* and Chrome */', 'BlockComment'), token(' ')];
    const trivia = createTriviaMap({
      before: new Map([
        [prelude.location[0], leading],
        [55, trailing]
      ]),
      after: new Map([
        [name.location[3], leading],
        [prelude.location[3], trailing]
      ])
    }) satisfies TriviaMap;
    const node = atrule({
      name,
      prelude,
      rules: [
        ruleset({
          selector: sel([el('0%')]),
          rules: [
            decl({ name: 'color', value: any('red') })
          ]
        })
      ]
    });

    expect(node.toString({ trivia })).toContain('@-webkit-keyframes /* Safari */ hover /* and Chrome */ {');
  });

  it('streams at-rule headers without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([any('screen', { role: 'keyword' })]),
      rules: []
    });
    const options = getPrintOptions({ writer });
    const name = node.name;
    const prelude = node.prelude!;
    const originalNameToString = name.toString;
    const originalPreludeToString = prelude.toString;
    let nameToStringCalls = 0;
    let preludeToStringCalls = 0;
    name.toString = function toStringWithWriterCheck(
      this: typeof name
    ): string {
      nameToStringCalls++;
      return originalNameToString.call(this);
    };
    prelude.toString = function toStringWithWriterCheck(
      this: typeof prelude
    ): string {
      preludeToStringCalls++;
      return originalPreludeToString.call(this);
    };

    try {
      expect(node.getHeaderString(options)).toBe('@media screen {\n');
      expect(writer.toString()).toBe('');
      expect(writer.captures).toBe(0);
      expect(writer.marks).toBe(0);
      expect(writer.previews).toBe(0);
      expect(writer.reads).toBe(0);
      expect(writer.restores).toBe(0);
      expect(nameToStringCalls).toBe(0);
      expect(preludeToStringCalls).toBe(0);
    } finally {
      name.toString = originalNameToString;
      prelude.toString = originalPreludeToString;
    }
  });

  it('writes exact scalar at-rule statements without child syntax capture', () => {
    const writer = new CountingWriter();
    const name = any('@namespace', { role: 'atkeyword' });
    const prelude = keyword('svg');
    const node = atrulestatement({
      name,
      prelude
    });
    let preludeWriteSyntaxCalls = 0;
    prelude.writeSyntax = () => {
      preludeWriteSyntaxCalls++;
    };

    node.writeSyntax(getPrintOptions({ writer }));

    expect(writer.toString()).toBe('@namespace svg;');
    expect(preludeWriteSyntaxCalls).toBe(0);
  });

  it('renders leaf at-rules without preview scaffolding', () => {
    const writer = new CountingWriter();
    const node = atrulestatement({
      name: any('@custom-media', { role: 'atkeyword' }),
      prelude: spaced([any('--narrow'), any('(max-width: 30em)')])
    });
    const options = getPrintOptions({ writer });

    const rendered = '@custom-media --narrow (max-width: 30em);';
    expect(node.render(context, options)).toBe(rendered);
    expect(writer.toString()).toBe(rendered);
    expect(writer.captures).toBe(0);
    expect(writer.previews).toBe(0);
  });

  it('renders scalar leaf at-rules without leaf syntax rollback', () => {
    const writer = new CountingWriter();
    const node = atrulestatement({
      name: any('@namespace', { role: 'atkeyword' }),
      prelude: any('svg')
    });
    node.removeFlag(F_STATIC);
    const options = getPrintOptions({ writer });

    const rendered = '@namespace svg;';
    expect(node.render(context, options)).toBe(rendered);
    expect(writer.toString()).toBe(rendered);
    expect(writer.marks).toBe(1);
    expect(writer.reads).toBe(1);
    expect(writer.restores).toBe(0);
    expect(writer.captures).toBe(0);
    expect(writer.previews).toBe(0);
  });

  it('writes scalar leaf at-rules without header string transport', () => {
    const writer = new CountingWriter();
    const node = atrulestatement({
      name: any('@namespace', { role: 'atkeyword' }),
      prelude: any('svg')
    });

    expect(() => node.writeSyntax(getPrintOptions({ writer }))).not.toThrow();
    expect(writer.toString()).toBe('@namespace svg;');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(writer.restores).toBe(0);
  });

  it('writes non-scalar no-trivia leaf at-rules without header string transport', () => {
    const writer = new CountingWriter();
    const node = atrulestatement({
      name: any('@custom-media', { role: 'atkeyword' }),
      prelude: spaced([any('--narrow'), any('(max-width: 30em)')])
    });

    expect(() => node.writeSyntax(getPrintOptions({ writer }))).not.toThrow();
    expect(writer.toString()).toBe('@custom-media --narrow (max-width: 30em);');
    expect(writer.captures).toBe(0);
    expect(writer.marks).toBe(0);
    expect(writer.previews).toBe(0);
    expect(writer.reads).toBe(0);
    expect(writer.restores).toBe(0);
  });

  it('normalizes leading prelude whitespace when writing direct leaf at-rules', () => {
    const writer = new CountingWriter();
    const node = atrulestatement({
      name: any('@namespace', { role: 'atkeyword' }),
      prelude: any(' foo url(http://www.example.com)', { role: 'keyword' })
    });
    node.getHeaderString = () => {
      throw new Error('direct leaf at-rule writeSyntax should not use header string transport');
    };

    expect(() => node.writeSyntax(getPrintOptions({ writer }))).not.toThrow();
    expect(writer.toString()).toBe('@namespace foo url(http://www.example.com);');
  });

  it('normalizes leading prelude whitespace when rendering evaluated leaf at-rules', () => {
    const node = atrulestatement({
      name: any('@impor', { role: 'atkeyword' }),
      prelude: quoted(any('impor-typo-dont-parse-as-@import.less'))
    });
    node.removeFlag(F_STATIC);

    expect(node.render(context)).toBe('@impor "impor-typo-dont-parse-as-@import.less";');
  });

  it('renders keyword and anonymous leaf at-rule preludes without syntax rollback', () => {
    const writer = new CountingWriter();
    const first = atrulestatement({
      name: any('@namespace', { role: 'atkeyword' }),
      prelude: keyword('svg')
    });
    const second = atrulestatement({
      name: any('@namespace', { role: 'atkeyword' }),
      prelude: new Anonymous('html')
    });
    first.removeFlag(F_STATIC);
    second.removeFlag(F_STATIC);
    const options = getPrintOptions({ writer });

    expect(first.render(context, options)).toBe('@namespace svg;');
    expect(second.render(context, options)).toBe('@namespace html;');
    expect(writer.toString()).toBe('@namespace svg;@namespace html;');
    expect(writer.marks).toBe(2);
    expect(writer.reads).toBe(2);
    expect(writer.restores).toBe(0);
    expect(writer.captures).toBe(0);
    expect(writer.previews).toBe(0);
  });

  it('renders comment-free at-rule headers without cloning source-free prelude leaves', () => {
    const preludeLeaf = any('screen', { role: 'keyword' });
    const originalClone = preludeLeaf.clone;
    let preludeLeafClones = 0;
    preludeLeaf.clone = function cloneForCounting(
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      preludeLeafClones++;
      return originalClone.apply(this, args);
    };
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([preludeLeaf]),
      rules: []
    });

    try {
      expect(node.getHeaderString(getPrintOptions(), true)).toBe('@media screen {\n');
      expect(preludeLeafClones).toBe(0);
      expect(preludeLeaf.parent?.valueOf()).toBe('screen');
    } finally {
      preludeLeaf.clone = originalClone;
    }
  });

  it('strips structural comments from comment-free at-rule frame headers only when needed', () => {
    const sourceComment = comment('/* frame note */');
    const prelude = seq([
      any('screen', { role: 'keyword' }),
      sourceComment
    ]);
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude,
      rules: []
    });

    expect(node.getHeaderString(getPrintOptions(), true)).toBe('@media screen {\n');
    expect(sourceComment.parent).toBe(prelude);
    expect(prelude.parent).toBe(node);
  });

  it('compares repeated at-rule headers through comparable header keys', async () => {
    const first = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([any('screen', { role: 'keyword' })]),
      rules: [
        decl({ name: 'case', value: any('1') })
      ]
    });
    const second = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([any('screen', { role: 'keyword' })]),
      rules: [
        decl({ name: 'case', value: any('2') })
      ]
    });
    const node = rules([first, second]);
    let withoutCommentsHeaderCalls = 0;
    let comparableHeaderCalls = 0;
    const atRulePrototypeCandidate = Object.getPrototypeOf(first);
    if (
      !atRulePrototypeCandidate
      || typeof atRulePrototypeCandidate !== 'object'
      || !('getHeaderString' in atRulePrototypeCandidate)
      || typeof atRulePrototypeCandidate.getHeaderString !== 'function'
      || !('getComparableHeaderString' in atRulePrototypeCandidate)
      || typeof atRulePrototypeCandidate.getComparableHeaderString !== 'function'
    ) {
      throw new TypeError('Expected at-rule prototype with header helpers');
    }
    const atRulePrototype: {
      getHeaderString: typeof first.getHeaderString;
      getComparableHeaderString: typeof first.getComparableHeaderString;
    } = atRulePrototypeCandidate;
    const originalGetHeaderString = atRulePrototype.getHeaderString;
    const originalGetComparableHeaderString = atRulePrototype.getComparableHeaderString;
    atRulePrototype.getHeaderString = function countWithoutCommentsCalls(
      this: typeof first,
      ...args: Parameters<typeof originalGetHeaderString>
    ): ReturnType<typeof originalGetHeaderString> {
      if (args[1] === true) {
        withoutCommentsHeaderCalls++;
      }
      return originalGetHeaderString.apply(this, args);
    };
    atRulePrototype.getComparableHeaderString = function countComparableCalls(
      this: typeof first,
      ...args: Parameters<typeof originalGetComparableHeaderString>
    ): ReturnType<typeof originalGetComparableHeaderString> {
      comparableHeaderCalls++;
      return originalGetComparableHeaderString.apply(this, args);
    };

    try {
      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toBeString(`
        @media screen {
          case: 1;
        }
        @media screen {
          case: 2;
        }`
      );
      expect(withoutCommentsHeaderCalls).toBe(0);
      expect(comparableHeaderCalls).toBeGreaterThan(0);
    } finally {
      atRulePrototype.getHeaderString = originalGetHeaderString;
      atRulePrototype.getComparableHeaderString = originalGetComparableHeaderString;
    }
  });

  it('serializeRulesContainer writes no-trivia at-rule headers without header string transport', () => {
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([any('screen', { role: 'keyword' })]),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      collapseNesting: true
    });
    const originalGetHeaderString = node.getHeaderString;
    let headerStringCalls = 0;
    node.getHeaderString = function countHeaderStringCalls(
      this: typeof node,
      ...args: Parameters<typeof originalGetHeaderString>
    ): ReturnType<typeof originalGetHeaderString> {
      headerStringCalls++;
      return originalGetHeaderString.apply(this, args);
    };

    try {
      const out = node.toTrimmedString(options);

      expect(out).toBeString(`
        @media screen {
          color: red;
        }
      `);
      expect(headerStringCalls).toBe(0);
    } finally {
      node.getHeaderString = originalGetHeaderString;
    }
  });

  it('normalizes leading prelude whitespace at the at-rule name boundary', () => {
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: any('  all and (tv)', { role: 'keyword' }),
      rules: []
    });

    expect(node.getHeaderString(getPrintOptions())).toBe('@media all and (tv) {\n');
  });

  describe('nested @media rules', () => {
    it('should handle nested @media rules inside rulesets', async () => {
      // Represents: .body { @media print { padding: 20px; } }
      const node = rules([
        ruleset({
          selector: sel([el('.body')]),
          rules: [
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('print', { role: 'keyword' })]),
              rules: [
                decl({ name: 'padding', value: dimension([20, 'px']) })
              ]
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        .body {
          @media print {
            padding: 20px;
          }
        }
      `);
    });

    /**
     * We need to hoist rulesets that have Less-style ampersands
     * that add to the inherited selector.
     */
    it('should collapse ampersands when we need to', async () => {
      // Represents:
      // .body {
      //   @media print {
      //     padding: 20px;
      //     &-1 {
      //       color: black;
      //     }
      //   }
      // }
      const node = rules([
        ruleset({
          selector: sel([el('.body')]),
          rules: [
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('print', { role: 'keyword' })]),
              rules: [
                decl({ name: 'padding', value: dimension([20, 'px']) }),
                ruleset({
                  selector: sel([amp('-1')]),
                  rules: [
                    decl({ name: 'color', value: any('black') })
                  ]
                })
              ]
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        .body {
          @media print {
            padding: 20px;
          }
        }
        @media print {
          .body-1 {
            color: black;
          }
        }
      `);
    });

    it('should collapse ampersands when we need to #2', async () => {
      // Represents:
      // .body {
      //   @media print {
      //     padding: 20px;
      //     &-1 {
      //       color: black;
      //     }
      //     background-color: white;
      //     &-2 {
      //       color: blue;
      //     }
      //   }
      // }
      const node = rules([
        ruleset({
          selector: sel([el('.body')]),
          rules: [
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('print', { role: 'keyword' })]),
              rules: [
                decl({ name: 'padding', value: dimension([20, 'px']) }),
                ruleset({
                  selector: sel([amp('-1')]),
                  rules: [
                    decl({ name: 'color', value: any('black') })
                  ]
                }),
                decl({ name: 'background-color', value: any('white') }),
                ruleset({
                  selector: sel([amp('-2')]),
                  rules: [
                    decl({ name: 'color', value: any('blue') })
                  ]
                }),
                ruleset({
                  selector: sel([amp('-3')]),
                  rules: [
                    decl({ name: 'color', value: any('red') })
                  ]
                })
              ]
            }),
            decl({ name: 'zoom', value: num(1) })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        .body {
          @media print {
            padding: 20px;
          }
        }
        @media print {
          .body-1 {
            color: black;
          }
        }
        .body {
          @media print {
            background-color: white;
          }
        }
        @media print {
          .body-2 {
            color: blue;
          }
          .body-3 {
            color: red;
          }
        }
        .body {
          zoom: 1;
        }
      `);
    });

    it('should handle deeply nested @media rules', async () => {
      // Represents: .body { @media print { header { background-color: red; @media (orientation:landscape) { margin-left: 20px; } } } }
      const node = rules([
        ruleset({
          selector: sel([el('.body')]),
          rules: [
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('print', { role: 'keyword' })]),
              rules: [
                decl({ name: 'padding', value: dimension([20, 'px']) }),
                ruleset({
                  selector: sel([el('header')]),
                  rules: [
                    decl({ name: 'background-color', value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 }) }),
                    atrule({
                      name: any('@media', { role: 'atkeyword' }),
                      prelude: seq([paren(decl({
                        name: 'orientation',
                        value: any('landscape')
                      }))]),
                      rules: [
                        decl({ name: 'margin-left', value: dimension([20, 'px']) })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        .body {
          @media print {
            padding: 20px;
            header {
              background-color: red;
              @media (orientation: landscape) {
                margin-left: 20px;
              }
            }
          }
        }
      `);
    });
  });

  describe('collapse nesting at-rule categories', () => {
    it('keeps nested @starting-style in place when collapseNesting is true', async () => {
      context.opts.collapseNesting = true;
      const node = rules([
        ruleset({
          selector: sel([el('[popover]:popover-open')]),
          rules: [
            decl({ name: 'opacity', value: num(1) }),
            atrule({
              name: any('@starting-style', { role: 'atkeyword' }),
              rules: [
                decl({ name: 'opacity', value: num(0) })
              ]
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toBeString(`
        [popover]:popover-open {
          opacity: 1;
          @starting-style {
            opacity: 0;
          }
        }
      `);
    });

    it('keeps leaf custom at-rules inside the current ruleset', async () => {
      context.opts.collapseNesting = true;
      const node = rules([
        ruleset({
          selector: sel([el('.box')]),
          rules: [
            atrulestatement({
              name: any('@apply', { role: 'atkeyword' }),
              prelude: any('h-64 w-64')
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toBeString(`
        .box {
          @apply h-64 w-64;
        }
      `);
    });

    it('does not compose root-only @keyframes children with parent selector context', async () => {
      context = new Context({ collapseNesting: true, bubbleRootAtRules: true });
      const node = rules([
        ruleset({
          selector: sel([el('.onTop')]),
          rules: [
            atrule({
              name: any('@keyframes', { role: 'atkeyword' }),
              prelude: quoted(any('textscale')),
              rules: [
                ruleset({
                  selector: sel([el('0%')]),
                  rules: [
                    decl({ name: 'font-size', value: dimension([1, 'em']) })
                  ]
                }),
                ruleset({
                  selector: sel([el('100%')]),
                  rules: [
                    decl({ name: 'font-size', value: dimension([2, 'em']) })
                  ]
                })
              ]
            }),
            decl({ name: 'animation', value: quoted(any('textscale')) })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toBeString(`
        @keyframes "textscale" {
          0% {
            font-size: 1em;
          }
          100% {
            font-size: 2em;
          }
        }
        .onTop {
          animation: "textscale";
        }
      `);
    });

    it('treats generated hoisted ampersand wrappers as transparent inside nested wrapper at-rules', async () => {
      context.opts.collapseNesting = true;
      const node = rules([
        atrule({
          name: any('@supports', { role: 'atkeyword' }),
          prelude: paren(decl({ name: 'property', value: any('value') })),
          rules: [
            ruleset({
              selector: sel([el('.outOfMedia'), co(' '), amp()]),
              rules: [
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: paren(decl({ name: 'max-size', value: dimension([2, 'px']) })),
                  rules: [
                    atrule({
                      name: any('@supports', { role: 'atkeyword' }),
                      prelude: paren(decl({ name: 'whatever', value: any('something') })),
                      rules: [
                        decl({ name: 'property', value: any('value') })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toBeString(`
        @supports (property: value) {
          @media (max-size: 2px) {
            @supports (whatever: something) {
              .outOfMedia {
                property: value;
              }
            }
          }
        }
      `);
    });

    it('does not merge adjacent root-only at-rules with identical headers', async () => {
      const node = rules([
        atrule({
          name: any('@font-face', { role: 'atkeyword' }),
          rules: [
            decl({ name: 'font-family', value: quoted('One') })
          ]
        }),
        atrule({
          name: any('@font-face', { role: 'atkeyword' }),
          rules: [
            decl({ name: 'font-family', value: quoted('Two') })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toBeString(`
        @font-face {
          font-family: "One";
        }
        @font-face {
          font-family: "Two";
        }
      `);
    });

    it('does not merge adjacent wrapper at-rules from distinct sibling branches', async () => {
      context.opts.collapseNesting = true;
      const node = rules([
        ruleset({
          selector: sel([el('.one')]),
          rules: [
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('screen', { role: 'keyword' })]),
              rules: [
                decl({ name: 'color', value: any('red') })
              ]
            })
          ]
        }),
        ruleset({
          selector: sel([el('.two')]),
          rules: [
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('screen', { role: 'keyword' })]),
              rules: [
                decl({ name: 'color', value: any('blue') })
              ]
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toBeString(`
        @media screen {
          .one {
            color: red;
          }
        }
        @media screen {
          .two {
            color: blue;
          }
        }
      `);
    });

    it('does not merge identical wrapper stacks across at-rule and hoisted-ruleset sibling branches', async () => {
      context.opts.collapseNesting = true;
      const node = rules([
        atrule({
          name: any('@supports', { role: 'atkeyword' }),
          prelude: paren(decl({ name: 'property', value: any('value') })),
          rules: [
            ruleset({
              selector: sel([el('.outOfMedia'), co(' '), amp()]),
              rules: [
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: paren(decl({ name: 'max-size', value: dimension([2, 'px']) })),
                  rules: [
                    atrule({
                      name: any('@supports', { role: 'atkeyword' }),
                      prelude: paren(decl({ name: 'whatever', value: any('something') })),
                      rules: [
                        decl({ name: 'property', value: any('value') })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: sel([el('.onTop'), co(' '), amp()]),
          rules: [
            atrule({
              name: any('@supports', { role: 'atkeyword' }),
              prelude: paren(decl({ name: 'property', value: any('value') })),
              rules: [
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: paren(decl({ name: 'max-size', value: dimension([2, 'px']) })),
                  rules: [
                    atrule({
                      name: any('@supports', { role: 'atkeyword' }),
                      prelude: paren(decl({ name: 'whatever', value: any('something') })),
                      rules: [
                        decl({ name: 'property', value: any('value') })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toBeString(`
        @supports (property: value) {
          @media (max-size: 2px) {
            @supports (whatever: something) {
              .outOfMedia {
                property: value;
              }
            }
          }
        }
        @supports (property: value) {
          @media (max-size: 2px) {
            @supports (whatever: something) {
              .onTop {
                property: value;
              }
            }
          }
        }
      `);
    });
  });

  describe('@media with mixins and parameters', () => {
    it('should handle mixin with nested @media using parameter', async () => {
      // Represents:
      // .mediaMixin(@fallback: 200px) {
      //   background: black;
      //   @media handheld {
      //     background: white;
      //     @media (max-width: @fallback) {
      //       background: red;
      //     }
      //   }
      // }
      // .a {
      //   .mediaMixin(100px);
      // }
      const mixinDef = mixin({
        name: any('.mediaMixin'),
        params: list([
          vardecl({ name: any('fallback', { role: 'property' }), value: dimension([200, 'px']) }, { paramVar: true })
        ]),
        rules: [
          decl({ name: 'background', value: color({ node: 'black', format: 0, rgb: [0, 0, 0], alpha: 1 }) }),
          atrule({
            name: any('@media', { role: 'atkeyword' }),
            prelude: seq([any('handheld', { role: 'keyword' })]),
            rules: [
              decl({ name: 'background', value: color({ node: 'white', format: 0, rgb: [255, 255, 255], alpha: 1 }) }),
              atrule({
                name: any('@media', { role: 'atkeyword' }),
                prelude: seq([paren(decl({
                  name: 'max-width',
                  value: ref({ key: 'fallback' }, { type: 'variable' })
                }))]),
                rules: [
                  decl({ name: 'background', value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 }) })
                ]
              })
            ]
          })
        ]
      });

      const callSite = ruleset({
        selector: sel([el('.a')]),
        rules: [
          call({
            name: ref({ key: '.mediaMixin' }, { type: 'mixin-ruleset' }),
            args: list([dimension([100, 'px'])])
          })
        ]
      });

      const rootRules = rules([mixinDef, callSite]);
      context.root = rootRules;
      const css = await renderNodeToString(rootRules, context);

      expect(css).toBeString(`
        .a {
          background: black;
          @media handheld {
            background: white;
            @media (max-width: 100px) {
              background: red;
            }
          }
        }
      `);
    });

    it('should handle mixin with nested @media using indexed parameter references', async () => {
      const createMixinRoot = (args: Node[] = []) => {
        const mixinDef = mixin({
          name: any('.mediaMixin'),
          params: list([
            vardecl({ name: 'fallback', value: dimension([200, 'px']) }, { paramVar: true })
          ]),
          rules: [
            decl({
              name: 'background',
              value: color({ node: 'black', format: 0, rgb: [0, 0, 0], alpha: 1 })
            }),
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('handheld', { role: 'keyword' })]),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'white', format: 0, rgb: [255, 255, 255], alpha: 1 })
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: paren(decl({
                    name: 'max-width',
                    value: ref({ key: 'fallback' }, { type: 'index' })
                  })),
                  rules: [
                    decl({
                      name: 'background',
                      value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
                    })
                  ]
                })
              ]
            })
          ]
        });

        const callSite = ruleset({
          selector: sel([el('.a')]),
          rules: [
            call({
              name: ref({ key: '.mediaMixin' }, { type: 'mixin-ruleset' }),
              args: list(args)
            })
          ]
        });

        return rules([mixinDef, callSite]);
      };

      const explicitRoot = createMixinRoot([dimension([100, 'px'])]);
      context.root = explicitRoot;
      const explicitCss = await renderNodeToString(explicitRoot, context);

      expect(explicitCss).toBeString(`
        .a {
          background: black;
          @media handheld {
            background: white;
            @media (max-width: 100px) {
              background: red;
            }
          }
        }
      `);

      const defaultContext = new Context();
      const defaultRoot = createMixinRoot();
      defaultContext.root = defaultRoot;
      const defaultCss = await renderNodeToString(defaultRoot, defaultContext);

      expect(defaultCss).toBeString(`
        .a {
          background: black;
          @media handheld {
            background: white;
            @media (max-width: 200px) {
              background: red;
            }
          }
        }
      `);
    });
  });

  describe('multiple @media rules', () => {
    it('should handle multiple @media rules at root level', async () => {
      // Represents: @media print { ... } @media screen { ... }
      const node = rules([
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('print', { role: 'keyword' })]),
          rules: [
            ruleset({
              selector: sel([el('.class')]),
              rules: [
                decl({ name: 'color', value: color({ node: 'blue', format: 0, rgb: [0, 0, 255], alpha: 1 }) })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('screen', { role: 'keyword' })]),
          rules: [
            vardecl({ name: any('base', { role: 'ident' }), value: num(8) }),
            ruleset({
              selector: sel([el('.body')]),
              rules: [
                decl({ name: 'max-width', value: op([ref('base', { type: 'variable' }), '*', num(60)]) })
              ]
            })
          ]
        })
      ]);

      context.root = node;
      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        @media print {
          .class {
            color: blue;
          }
        }
        @media screen {
          .body {
            max-width: 480;
          }
        }
      `);
    });
  });

  describe('@media with variables in prelude', () => {
    it('should handle @media with variable references in prelude', async () => {
      // Represents: @all: ~"all"; @tv: ~"(tv)"; @media @all and @tv { ... }
      const node = rules([
        vardecl({ name: any('all', { role: 'ident' }), value: quoted(any('all', { role: 'any' }), { escaped: true }) }),
        vardecl({ name: any('tv', { role: 'ident' }), value: quoted(any('(tv)', { role: 'any' }), { escaped: true }) }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([ref('all', { type: 'variable' }), any('and', { role: 'keyword' }), ref('tv', { type: 'variable' })]),
          rules: [
            ruleset({
              selector: sel([el('.all-and-tv-variables')]),
              rules: [
                decl({ name: 'var', value: spaced([any('all-and-tv')]) })
              ]
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        @media all and (tv) {
          .all-and-tv-variables {
            var: all-and-tv;
          }
        }
      `);
    });
  });

  describe('@media with expressions in prelude', () => {
    it('should handle @media with expressions in prelude', async () => {
      // Represents: @some-var: 60px; @media screen and (min-width: (@some-var + 1)) { ... }
      const node = rules([
        vardecl({ name: any('some-var', { role: 'ident' }), value: dimension([60, 'px']) }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('screen', { role: 'keyword' }),
            any('and', { role: 'keyword' }),
            paren(decl({
              name: 'min-width',
              value: op([ref('some-var', { type: 'variable' }), '+', num(1)])
            }))
          ]),
          rules: [
            ruleset({
              selector: sel([el('.selector')]),
              rules: [
                decl({ name: 'foo', value: spaced([any('bar')]) })
              ]
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        @media screen and (min-width: 61px) {
          .selector {
            foo: bar;
          }
        }
      `);
    });
  });

  describe('@media with multiple conditions', () => {
    it('should handle @media with comma-separated conditions', async () => {
      // Represents: @media screen and (color), projection and (color) { ... }
      const node = rules([
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: list([
            seq([
              any('screen', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              paren(any('color', { role: 'keyword' }))
            ]),
            seq([
              any('projection', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              paren(any('color', { role: 'keyword' }))
            ])
          ]),
          rules: [
            ruleset({
              selector: sel([el('.selector')]),
              rules: [
                decl({ name: 'color', value: color({ node: '#eee', format: 0 }) })
              ]
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        @media screen and (color), projection and (color) {
          .selector {
            color: #eee;
          }
        }
      `);
    });
  });

  describe('nested @media in mixin calls', () => {
    it('should handle mixin call with nested @media', async () => {
      // Represents:
      // .nav-justified() {
      //   @media (min-width: 480px) {
      //     > li {
      //       display: table-cell;
      //     }
      //   }
      // }
      // .menu {
      //   @media (min-width: 768px) {
      //     .nav-justified();
      //   }
      // }
      const navJustifiedMixin = mixin({
        name: any('.nav-justified'),
        rules: [
          atrule({
            name: any('@media', { role: 'atkeyword' }),
            prelude: seq([paren(decl({
              name: 'min-width',
              value: dimension([480, 'px'])
            }))]),
            rules: [
              ruleset({
                selector: sel([el('> li')]),
                rules: [
                  decl({ name: 'display', value: spaced([any('table-cell')]) })
                ]
              })
            ]
          })
        ]
      });

      const callSite = ruleset({
        selector: sel([el('.menu')]),
        rules: [
          atrule({
            name: any('@media', { role: 'atkeyword' }),
            prelude: seq([paren(decl({
              name: 'min-width',
              value: dimension([768, 'px'])
            }))]),
            rules: [
              call({
                name: ref({ key: '.nav-justified' }, { type: 'mixin-ruleset' })
              })
            ]
          })
        ]
      });

      const rootRules = rules([navJustifiedMixin, callSite]);
      context.root = rootRules;
      const css = await renderNodeToString(rootRules, context);

      expect(css).toBeString(`
        .menu {
          @media (min-width: 768px) {
            @media (min-width: 480px) {
              > li {
                display: table-cell;
              }
            }
          }
        }
      `);
    });

    it('does not duplicate callable ruleset output inside nested media calls', async () => {
      context.opts.collapseNesting = true;
      const navJustified = ruleset({
        selector: sel([el('.nav-justified')]),
        rules: [
          atrule({
            name: any('@media', { role: 'atkeyword' }),
            prelude: seq([paren(decl({
              name: 'min-width',
              value: dimension([480, 'px'])
            }))]),
            rules: [
              ruleset({
                selector: sel([el('> li')]),
                rules: [
                  decl({ name: 'display', value: spaced([any('table-cell')]) })
                ]
              })
            ]
          })
        ]
      });

      const menu = ruleset({
        selector: sel([el('.menu')]),
        rules: [
          atrule({
            name: any('@media', { role: 'atkeyword' }),
            prelude: seq([paren(decl({
              name: 'min-width',
              value: dimension([768, 'px'])
            }))]),
            rules: [
              call({
                name: ref({ key: '.nav-justified' }, { type: 'mixin-ruleset' })
              })
            ]
          })
        ]
      });

      const rootRules = rules([navJustified, menu]);
      context.root = rootRules;
      const css = await renderNodeToString(rootRules, context, { context });

      expect(css).toBeString(`
        @media (min-width: 480px) {
          .nav-justified > li {
            display: table-cell;
          }
        }
        @media (min-width: 768px) {
          @media (min-width: 480px) {
            .menu > li {
              display: table-cell;
            }
          }
        }
      `);
    });
  });

  describe('serialization test for media.less AST', () => {
    it('should serialize the exact AST structure from media.less.s-expr.txt', async () => {
      context.opts.collapseNesting = true;
      // Build the AST exactly as represented in media.less.s-expr.txt
      const node = rules([
        comment('// For now, variables can\'t be declared…', { lineComment: true }),
        vardecl({ name: any('var', { role: 'ident' }), value: num(42) }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('print', { role: 'keyword' })]),
          rules: [
            ruleset({
              selector: el('.class'),
              rules: [
                decl({
                  name: 'color',
                  value: color({ node: 'blue', format: 0, rgb: [0, 0, 255], alpha: 1 })
                }),
                ruleset({
                  selector: el('.sub'),
                  rules: [
                    decl({
                      name: 'width',
                      value: ref({ key: 'var' }, { type: 'variable' })
                    })
                  ]
                })
              ]
            }),
            ruleset({
              selector: sellist([
                el('.top'),
                sel([
                  el('header'),
                  co('>'),
                  el('h1')
                ])
              ]),
              rules: [
                decl({
                  name: 'color',
                  value: paren(op([
                    color({ node: '#222', format: 0 }),
                    '*',
                    num(2)
                  ]))
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('screen', { role: 'keyword' })]),
          rules: [
            vardecl({ name: any('base', { role: 'ident' }), value: num(8) }),
            ruleset({
              selector: el('.body'),
              rules: [
                decl({
                  name: 'max-width',
                  value: paren(op([
                    ref({ key: 'base' }, { type: 'variable' }),
                    '*',
                    num(60)
                  ]))
                })
              ]
            })
          ]
        }),
        vardecl({ name: any('ratio_large', { role: 'ident' }), value: num(16) }),
        vardecl({ name: any('ratio_small', { role: 'ident' }), value: num(9) }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('all', { role: 'keyword' }),
            any('and', { role: 'keyword' }),
            seq([
              paren(decl({
                name: 'device-aspect-ratio',
                value: quoted(interpolated({
                  source: '%% / %%',
                  replacements: [
                    ref({ key: 'ratio_large' }, { type: 'variable' }),
                    ref({ key: 'ratio_small' }, { type: 'variable' })
                  ]
                }, { role: 'ident' }), { escaped: true })
              }))
            ])
          ]),
          rules: [
            ruleset({
              selector: el('.body'),
              rules: [
                decl({
                  name: 'max-width',
                  value: dimension([800, 'px'])
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('all', { role: 'keyword' }),
            any('and', { role: 'keyword' }),
            seq([
              paren(decl({
                name: 'orientation',
                value: any('portrait')
              }))
            ])
          ]),
          rules: [
            ruleset({
              selector: el('aside'),
              rules: [
                decl({
                  name: 'float',
                  value: any('none')
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: list([
            seq([
              any('handheld', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              seq([
                paren(decl({
                  name: 'min-width',
                  value: ref({ key: 'var' }, { type: 'variable' })
                }))
              ])
            ]),
            seq([
              any('screen', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              seq([
                paren(decl({
                  name: 'min-width',
                  value: dimension([20, 'em'])
                }))
              ])
            ])
          ]),
          rules: [
            ruleset({
              selector: el('.body'),
              rules: [
                decl({
                  name: 'max-width',
                  value: dimension([480, 'px'])
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.body'),
          rules: [
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('print', { role: 'keyword' })]),
              rules: [
                decl({
                  name: 'padding',
                  value: dimension([20, 'px'])
                }),
                ruleset({
                  selector: el('header'),
                  rules: [
                    decl({
                      name: 'background-color',
                      value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
                    })
                  ]
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: seq([
                    paren(decl({
                      name: 'orientation',
                      value: any('landscape')
                    }))
                  ]),
                  rules: [
                    decl({
                      name: 'margin-left',
                      value: dimension([20, 'px'])
                    })
                  ]
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('screen', { role: 'keyword' })]),
          rules: [
            ruleset({
              selector: el('.sidebar'),
              rules: [
                decl({
                  name: 'width',
                  value: dimension([300, 'px'])
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: seq([
                    paren(decl({
                      name: 'orientation',
                      value: any('landscape')
                    }))
                  ]),
                  rules: [
                    decl({
                      name: 'width',
                      value: dimension([500, 'px'])
                    })
                  ]
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('a', { role: 'keyword' })]),
          rules: [
            ruleset({
              selector: el('.first'),
              rules: [
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: seq([
                    paren(any('b', { role: 'keyword' }))
                  ]),
                  rules: [
                    ruleset({
                      selector: el('.second'),
                      rules: [
                        ruleset({
                          selector: el('.third'),
                          rules: [
                            decl({
                              name: 'width',
                              value: dimension([300, 'px'])
                            }),
                            atrule({
                              name: any('@media', { role: 'atkeyword' }),
                              prelude: seq([
                                paren(any('c', { role: 'keyword' }))
                              ]),
                              rules: [
                                decl({
                                  name: 'width',
                                  value: dimension([500, 'px'])
                                })
                              ]
                            })
                          ]
                        }),
                        ruleset({
                          selector: el('.fourth'),
                          rules: [
                            decl({
                              name: 'width',
                              value: num(3)
                            })
                          ]
                        })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.body'),
          rules: [
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: list([
                seq([any('a', { role: 'keyword' })]),
                seq([
                  paren(any('b', { role: 'keyword' })),
                  any('and', { role: 'keyword' }),
                  paren(any('c', { role: 'keyword' }))
                ])
              ]),
              rules: [
                decl({
                  name: 'width',
                  value: dimension([95, '%'])
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: list([
                    seq([paren(any('x', { role: 'keyword' }))]),
                    seq([paren(any('y', { role: 'keyword' }))])
                  ]),
                  rules: [
                    decl({
                      name: 'width',
                      value: dimension([100, '%'])
                    })
                  ]
                })
              ]
            })
          ]
        }),
        mixin({
          name: any('.mediaMixin'),
          params: list([
            vardecl({
              name: any('fallback', { role: 'property' }),
              value: dimension([200, 'px'])
            }, { paramVar: true })
          ]),
          rules: [
            decl({
              name: 'background',
              value: color({ node: 'black', format: 0, rgb: [0, 0, 0], alpha: 1 })
            }),
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('handheld', { role: 'keyword' })]),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'white', format: 0, rgb: [255, 255, 255], alpha: 1 })
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: seq([
                    paren(decl({
                      name: 'max-width',
                      value: ref({ key: 'fallback' }, { type: 'variable' })
                    }))
                  ]),
                  rules: [
                    decl({
                      name: 'background',
                      value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
                    })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.a'),
          rules: [
            call({
              name: ref({ key: '.mediaMixin' }, { type: 'mixin-ruleset' }),
              args: list([
                dimension([100, 'px'])
              ])
            })
          ]
        }),
        ruleset({
          selector: el('.b'),
          rules: [
            call({
              name: ref({ key: '.mediaMixin' }, { type: 'mixin-ruleset' })
            })
          ]
        }),
        vardecl({
          name: any('smartphone', { role: 'ident' }),
          value: quoted(any('only screen and (max-width: 200px)', { role: 'any' }), { escaped: true })
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            ref({ key: 'smartphone' }, { type: 'variable' })
          ]),
          rules: [
            ruleset({
              selector: el('.body'),
              rules: [
                decl({
                  name: 'width',
                  value: dimension([480, 'px'])
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('print', { role: 'keyword' })]),
          rules: [
            atrule({
              name: any('@page', { role: 'atkeyword' }),
              prelude: list([el(':left')]),
              rules: [
                decl({
                  name: 'margin',
                  value: dimension([0.5, 'cm'])
                })
              ]
            }),
            atrule({
              name: any('@page', { role: 'atkeyword' }),
              prelude: list([el(':right')]),
              rules: [
                decl({
                  name: 'margin',
                  value: dimension([0.5, 'cm'])
                })
              ]
            }),
            atrule({
              name: any('@page', { role: 'atkeyword' }),
              prelude: list([any('Test:first', { role: 'ident' })]),
              rules: [
                decl({
                  name: 'margin',
                  value: dimension([1, 'cm'])
                })
              ]
            }),
            atrule({
              name: any('@page', { role: 'atkeyword' }),
              prelude: list([el(':first')]),
              rules: [
                decl({
                  name: 'margin',
                  value: dimension([0.5, 'cm'])
                }),
                decl({
                  name: 'size',
                  value: seq([
                    dimension([8.5, 'in']),
                    dimension([11, 'in'])
                  ])
                }),
                atrule({
                  name: any('@top-left', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@top-left-corner', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@top-center', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@top-right', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@top-right-corner', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@bottom-left', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@bottom-left-corner', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@bottom-center', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@bottom-right', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@bottom-right-corner', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@left-top', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@left-middle', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@left-bottom', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@right-top', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                }),
                atrule({
                  name: any('@right-middle', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'content',
                      value: seq([
                        quoted(any('Page ', { role: 'any' })),
                        call({
                          name: any('counter', { role: 'ident' }),
                          args: list([
                            any('page')
                          ])
                        })
                      ])
                    })
                  ]
                }),
                atrule({
                  name: any('@right-bottom', { role: 'atkeyword' }),
                  rules: [
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ]
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: list([
            seq([
              paren(decl({
                name: '-webkit-min-device-pixel-ratio',
                value: num(2)
              }))
            ]),
            seq([
              paren(decl({
                name: 'min--moz-device-pixel-ratio',
                value: num(2)
              }))
            ]),
            seq([
              paren(decl({
                name: '-o-min-device-pixel-ratio',
                value: quoted(any('2/1', { role: 'any' }))
              }))
            ]),
            seq([
              paren(decl({
                name: 'min-resolution',
                value: dimension([2, 'dppx'])
              }))
            ]),
            seq([
              paren(decl({
                name: 'min-resolution',
                value: dimension([128, 'dpcm'])
              }))
            ])
          ]),
          rules: [
            ruleset({
              selector: el('.b'),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
                })
              ]
            })
          ]
        }),
        mixin({
          name: any('.bg'),
          rules: [
            decl({
              name: 'background',
              value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
            }),
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([
                paren(decl({
                  name: 'max-width',
                  value: dimension([500, 'px'])
                }))
              ]),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.body'),
          rules: [
            call({
              name: ref({ key: '.bg' }, { type: 'mixin-ruleset' })
            })
          ]
        }),
        vardecl({
          name: any('bpMedium', { role: 'ident' }),
          value: dimension([1000, 'px'])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            paren(decl({
              name: 'max-width',
              value: ref({ key: 'bpMedium' }, { type: 'variable' })
            }))
          ]),
          rules: [
            ruleset({
              selector: el('.body'),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: seq([
                    paren(decl({
                      name: 'max-width',
                      value: dimension([500, 'px'])
                    }))
                  ]),
                  rules: [
                    decl({
                      name: 'background',
                      value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                    })
                  ]
                }),
                decl({
                  name: 'background',
                  value: color({ node: 'blue', format: 0, rgb: [0, 0, 255], alpha: 1 })
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            paren(decl({
              name: 'max-width',
              value: dimension([1200, 'px'])
            }))
          ]),
          rules: [
            comment('/* a comment */'),
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([
                paren(decl({
                  name: 'max-width',
                  value: dimension([900, 'px'])
                }))
              ]),
              rules: [
                ruleset({
                  selector: el('.body'),
                  rules: [
                    decl({
                      name: 'font-size',
                      value: dimension([11, 'px'])
                    })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.nav-justified'),
          rules: [
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([
                paren(decl({
                  name: 'min-width',
                  value: dimension([480, 'px'])
                }))
              ]),
              rules: [
                ruleset({
                  selector: el('.nav-justified'),
                  rules: [
                    ruleset({
                      selector: sel([
                        el('.nav-justified'),
                        co('>'),
                        el('li')
                      ]),
                      rules: [
                        decl({
                          name: 'display',
                          value: any('table-cell')
                        })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.menu'),
          rules: [
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([
                paren(decl({
                  name: 'min-width',
                  value: dimension([768, 'px'])
                }))
              ]),
              rules: [
                ruleset({
                  selector: el('.menu'),
                  rules: [
                    atrule({
                      name: any('@media', { role: 'atkeyword' }),
                      prelude: seq([
                        paren(decl({
                          name: 'min-width',
                          value: dimension([480, 'px'])
                        }))
                      ]),
                      rules: [
                        ruleset({
                          selector: el('.menu'),
                          rules: [
                            ruleset({
                              selector: sel([
                                el('.menu'),
                                co('>'),
                                el('li')
                              ]),
                              rules: [
                                decl({
                                  name: 'display',
                                  value: any('table-cell')
                                })
                              ]
                            })
                          ]
                        })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        vardecl({
          name: any('all', { role: 'ident' }),
          value: quoted(any('all', { role: 'any' }))
        }),
        vardecl({
          name: any('tv', { role: 'ident' }),
          value: quoted(any('(tv)', { role: 'any' }))
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('all', { role: 'any' }),
            any('and', { role: 'keyword' }),
            any('(tv)', { role: 'any' })
          ]),
          rules: [
            ruleset({
              selector: el('.all-and-tv-variables'),
              rules: [
                decl({
                  name: 'var',
                  value: any('all-and-tv')
                })
              ]
            })
          ]
        }),
        vardecl({
          name: any('some-var', { role: 'ident' }),
          value: dimension([60, 'px'])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('screen', { role: 'keyword' }),
            any('and', { role: 'keyword' }),
            paren(decl({
              name: 'min-width',
              value: dimension([61, 'px'])
            }))
          ]),
          rules: [
            ruleset({
              selector: el('.selector'),
              rules: [
                decl({
                  name: 'foo',
                  value: any('bar')
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: list([
            seq([
              any('screen', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              seq([
                paren(any('color', { role: 'keyword' }))
              ])
            ]),
            seq([
              any('projection', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              seq([
                paren(any('color', { role: 'keyword' }))
              ])
            ])
          ]),
          rules: [
            ruleset({
              selector: el('.selector'),
              rules: [
                decl({
                  name: 'color',
                  value: color({ node: '#eee', format: 0 })
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('not', { role: 'keyword' }),
            paren(seq([
              any('width', { role: 'ident' }),
              any('<=', { role: 'keyword' }),
              dimension([-100, 'px'])
            ]))
          ]),
          rules: [
            ruleset({
              selector: el('body'),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            paren(seq([
              any('height', { role: 'ident' }),
              any('>', { role: 'keyword' }),
              dimension([-100, 'px'])
            ]))
          ]),
          rules: [
            ruleset({
              selector: el('body'),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('not', { role: 'keyword' }),
            paren(decl({
              name: 'resolution',
              value: dimension([-300, 'dpi'])
            }))
          ]),
          rules: [
            ruleset({
              selector: el('body'),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            paren(decl({
              name: 'min-orientation',
              value: any('portrait')
            }))
          ]),
          rules: [
            ruleset({
              selector: el('body'),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('print', { role: 'keyword' }),
            any('and', { role: 'keyword' }),
            seq([
              paren(decl({
                name: 'min-resolution',
                value: dimension([118, 'dpcm'])
              }))
            ])
          ]),
          rules: [
            ruleset({
              selector: el('body'),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            paren(seq([
              dimension([200, 'px']),
              any('<=', { role: 'keyword' }),
              any('width', { role: 'ident' }),
              any('<=', { role: 'keyword' }),
              dimension([500, 'px'])
            ]))
          ]),
          rules: [
            ruleset({
              selector: el('.test-range-syntax'),
              rules: [
                decl({
                  name: 'padding',
                  value: num(0)
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.selector'),
          rules: [
            decl({
              name: 'color',
              value: color({ node: '#eee', format: 0 })
            }),
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([
                paren(seq([
                  dimension([200, 'px']),
                  any('<=', { role: 'keyword' }),
                  any('width', { role: 'ident' }),
                  any('<=', { role: 'keyword' }),
                  dimension([500, 'px'])
                ]))
              ]),
              rules: [
                ruleset({
                  selector: el('.selector'),
                  rules: [
                    ruleset({
                      selector: sel([
                        el('.selector'),
                        co(' '),
                        el('.test-range-syntax')
                      ]),
                      rules: [
                        decl({
                          name: 'padding',
                          value: num(0)
                        })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: list([
            seq([any('print', { role: 'keyword' })]),
            seq([
              paren(decl({
                name: 'max-width',
                value: dimension([992, 'px'])
              }))
            ])
          ]),
          rules: [
            ruleset({
              selector: el('body'),
              rules: [
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ]
            })
          ]
        })
      ]);

      const serialized = await renderNodeToString(node, context, { context });

      // The serialized output should match the structure
      expect(serialized).toBeString(`
        @media print {
          .class {
            color: blue;
          }
          .class .sub {
            width: 42;
          }
          .top,
          header > h1 {
            color: #444444;
          }
        }
        @media screen {
          .body {
            max-width: 480;
          }
        }
        @media all and (device-aspect-ratio: 16 / 9) {
          .body {
            max-width: 800px;
          }
        }
        @media all and (orientation: portrait) {
          aside {
            float: none;
          }
        }
        @media handheld and (min-width: 42), screen and (min-width: 20em) {
          .body {
            max-width: 480px;
          }
        }
        @media print {
          .body {
            padding: 20px;
          }
          .body header {
            background-color: red;
          }
          @media (orientation: landscape) {
            .body {
              margin-left: 20px;
            }
          }
        }
        @media screen {
          .sidebar {
            width: 300px;
          }
          @media (orientation: landscape) {
            .sidebar {
              width: 500px;
            }
          }
        }
        @media a {
          @media (b) {
            .first .second .third {
              width: 300px;
            }
            @media (c) {
              .first .second .third {
                width: 500px;
              }
            }
            .first .second .fourth {
              width: 3;
            }
          }
        }
        @media a, (b) and (c) {
          .body {
            width: 95%;
          }
          @media (x), (y) {
            .body {
              width: 100%;
            }
          }
        }
        .a {
          background: black;
        }
        @media handheld {
          .a {
            background: white;
          }
          @media (max-width: 100px) {
            .a {
              background: red;
            }
          }
        }
        .b {
          background: black;
        }
        @media handheld {
          .b {
            background: white;
          }
          @media (max-width: 200px) {
            .b {
              background: red;
            }
          }
        }
        @media only screen and (max-width: 200px) {
          .body {
            width: 480px;
          }
        }
        @media print {
          @page :left {
            margin: 0.5cm;
          }
          @page :right {
            margin: 0.5cm;
          }
          @page Test:first {
            margin: 1cm;
          }
          @page :first {
            margin: 0.5cm;
            size: 8.5in 11in;
            @top-left {
              margin: 1cm;
            }
            @top-left-corner {
              margin: 1cm;
            }
            @top-center {
              margin: 1cm;
            }
            @top-right {
              margin: 1cm;
            }
            @top-right-corner {
              margin: 1cm;
            }
            @bottom-left {
              margin: 1cm;
            }
            @bottom-left-corner {
              margin: 1cm;
            }
            @bottom-center {
              margin: 1cm;
            }
            @bottom-right {
              margin: 1cm;
            }
            @bottom-right-corner {
              margin: 1cm;
            }
            @left-top {
              margin: 1cm;
            }
            @left-middle {
              margin: 1cm;
            }
            @left-bottom {
              margin: 1cm;
            }
            @right-top {
              margin: 1cm;
            }
            @right-middle {
              content: "Page " counter(page);
            }
            @right-bottom {
              margin: 1cm;
            }
          }
        }
        @media (-webkit-min-device-pixel-ratio: 2), (min--moz-device-pixel-ratio: 2), (-o-min-device-pixel-ratio: "2/1"), (min-resolution: 2dppx), (min-resolution: 128dpcm) {
          .b {
            background: red;
          }
        }
        .body {
          background: red;
        }
        @media (max-width: 500px) {
          .body {
            background: green;
          }
        }
        @media (max-width: 1000px) {
          .body {
            background: red;
          }
          @media (max-width: 500px) {
            .body {
              background: green;
            }
          }
          .body {
            background: blue;
          }
        }
        @media (max-width: 1200px) {
          /* a comment */
          @media (max-width: 900px) {
            .body {
              font-size: 11px;
            }
          }
        }
        @media (min-width: 480px) {
          .nav-justified .nav-justified .nav-justified > li {
            display: table-cell;
          }
        }
        @media (min-width: 768px) {
          @media (min-width: 480px) {
            .menu .menu .menu .menu > li {
              display: table-cell;
            }
          }
        }
        @media all and (tv) {
          .all-and-tv-variables {
            var: all-and-tv;
          }
        }
        @media screen and (min-width: 61px) {
          .selector {
            foo: bar;
          }
        }
        @media screen and (color), projection and (color) {
          .selector {
            color: #eee;
          }
        }
        @media not (width <= -100px) {
          body {
            background: green;
          }
        }
        @media (height > -100px) {
          body {
            background: green;
          }
        }
        @media not (resolution: -300dpi) {
          body {
            background: green;
          }
        }
        @media (min-orientation: portrait) {
          body {
            background: green;
          }
        }
        @media print and (min-resolution: 118dpcm) {
          body {
            background: green;
          }
        }
        @media (200px <= width <= 500px) {
          .test-range-syntax {
            padding: 0;
          }
        }
        .selector {
          color: #eee;
        }
        @media (200px <= width <= 500px) {
          .selector .selector .selector .test-range-syntax {
            padding: 0;
          }
        }
        @media print, (max-width: 992px) {
          body {
            background: green;
          }
        }
      `);
    });
  });
});
