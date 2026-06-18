import { rules, sellist, sel, el, decl, ruleset, spaced, any, interpolated, F_MAY_ASYNC, BasicSelector, Nil, atrule, vardecl, Rules as RulesClass, Condition, condition, bool, comment, ref } from '../index.js';
import { Context } from '../../context.js';
import { F_EXTENDED, F_EXTEND_TARGET, F_VISIBLE } from '../node.js';
import { getPrintOptions, OutputWriter } from '../util/print.js';
import { serializeRulesContainer } from '../util/serialize-helper.js';
import { INTERPOLATION_PLACEHOLDER } from '../interpolated.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

let context: Context;

class CountingWriter extends OutputWriter {
  captures = 0;
  marks = 0;
  previews = 0;
  reads = 0;
  restores = 0;
  trimEnds = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override preview(fn: () => string | void, preserveSegments?: boolean): string;
  override preview(fn: () => Promise<string | void>, preserveSegments?: boolean): Promise<string>;
  override preview(fn: () => MaybePromise<string | void>, preserveSegments?: boolean): MaybePromise<string> {
    this.previews++;
    return super.preview(fn, preserveSegments);
  }

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }

  override restore(mark: number): void {
    this.restores++;
    super.restore(mark);
  }

  override trimEndSince(mark: number): void {
    this.trimEnds++;
    return super.trimEndSince(mark);
  }
}

describe('Rule', () => {
  beforeEach(() => {
    context = new Context();
  });
  it('should serialize to CSS', async () => {
    let node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'border', value: spaced([any('1px'), any('solid'), any('black')]) }),
        decl({ name: 'color', value: any('#eee') })
      ])
    });
    let nodes = rules([node, node]);
    expect(nodes.toTrimmedString()).toBeString(`
      foo {
        border: 1px solid black;
        color: #eee;
        border: 1px solid black;
        color: #eee;
      }
    `);
  });

  it('renders unique declarations at emission time without duplicate-cache pre-render or public string transport', () => {
    const writer = new CountingWriter();
    const colorDecl = decl({ name: 'color', value: any('red') });
    const sizeDecl = decl({ name: 'font-size', value: any('12px') });
    colorDecl.toTrimmedString = () => {
      throw new Error('Unique declaration emission should write syntax directly');
    };
    const node = ruleset({
      selector: sel([el('.box')]),
      rules: rules([
        colorDecl,
        sizeDecl
      ])
    });

    try {
      expect(node.toTrimmedString({ writer })).toBeString(`
        .box {
          color: red;
          font-size: 12px;
        }
      `);
    } finally {
      delete colorDecl.toTrimmedString;
    }
  });

  it('renders duplicate declarations without public string transport during duplicate comparison', () => {
    const firstDecl = decl({ name: 'color', value: any('red') });
    const secondDecl = decl({ name: 'color', value: any('blue') });
    const originalFirstToTrimmedString = firstDecl.toTrimmedString;
    const originalSecondToTrimmedString = secondDecl.toTrimmedString;
    let publicStringCalls = 0;
    firstDecl.toTrimmedString = function countPublicStringCalls(
      ...args: Parameters<typeof originalFirstToTrimmedString>
    ): ReturnType<typeof originalFirstToTrimmedString> {
      publicStringCalls++;
      return originalFirstToTrimmedString.apply(this, args);
    };
    secondDecl.toTrimmedString = function countPublicStringCalls(
      ...args: Parameters<typeof originalSecondToTrimmedString>
    ): ReturnType<typeof originalSecondToTrimmedString> {
      publicStringCalls++;
      return originalSecondToTrimmedString.apply(this, args);
    };
    const node = ruleset({
      selector: sel([el('.box')]),
      rules: rules([
        firstDecl,
        secondDecl
      ])
    });

    try {
      expect(node.toTrimmedString()).toBeString(`
        .box {
          color: red;
          color: blue;
        }
      `);
      expect(publicStringCalls).toBe(0);
    } finally {
      firstDecl.toTrimmedString = originalFirstToTrimmedString;
      secondDecl.toTrimmedString = originalSecondToTrimmedString;
    }
  });

  it('keeps authored literal and interpolated sibling rulesets separate without collapse', async () => {
    const node = rules([
      ruleset({
        selector: sellist([sel([el('.foo')])]),
        rules: rules([
          decl({ name: 'a', value: any('1') })
        ])
      }),
      ruleset({
        selector: sellist([
          sel([
            interpolated({
              source: INTERPOLATION_PLACEHOLDER,
              replacements: [any('.foo')]
            })
          ])
        ]),
        rules: rules([
          decl({ name: 'a', value: any('2') })
        ])
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      .foo {
        a: 1;
      }
      .foo {
        a: 2;
      }
    `);
  });

  it('renders a ruleset through render(context)', () => {
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'border', value: spaced([any('1px'), any('solid'), any('black')]) }),
        decl({ name: 'color', value: any('#eee') })
      ])
    });

    expect(node.render(context)).toBeString(`
      foo {
        border: 1px solid black;
        color: #eee;
      }
    `);
  });

  it('writes ruleset syntax without public string wrapper transport', () => {
    const writer = new CountingWriter();
    const node = ruleset({
      selector: sellist([sel([el('.box')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    node.toTrimmedString = () => {
      throw new Error('Ruleset.writeSyntax should not call the public string wrapper');
    };

    expect(() => node.writeSyntax(getPrintOptions({ writer }))).not.toThrow();
    expect(writer.toString()).toBeString(`
      .box {
        color: red;
      }
    `);
  });

  it('serializes ruleset source syntax through writeSyntax ownership', () => {
    const node = ruleset({
      selector: sellist([sel([el('.box')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const originalWriteSyntax = node.writeSyntax;
    let writeSyntaxCalls = 0;
    node.writeSyntax = function countWriteSyntax(
      ...args: Parameters<typeof originalWriteSyntax>
    ): ReturnType<typeof originalWriteSyntax> {
      writeSyntaxCalls++;
      return originalWriteSyntax.apply(this, args);
    };

    try {
      expect(node.toTrimmedString()).toBeString(`
        .box {
          color: red;
        }
      `);
      expect(writeSyntaxCalls).toBe(1);
    } finally {
      node.writeSyntax = originalWriteSyntax;
    }
  });

  it('writes finalized ruleset output into segmented buffers', async () => {
    const buffer = createRenderBuffer('segmented');
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
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
      foo {
        color: red;
      }
    `);
    expect(buffer.segments).toHaveLength(1);
    expect(buffer.segments[0]).toBeString(`
      foo {
        color: red;
      }
    `);
    expect(resolveCalls).toBe(0);
  });

  it('renders finalized ruleset output directly without public resolve', async () => {
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    node.resolve = () => {
      throw new Error('Ruleset direct render should evaluate natively');
    };

    await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
      foo {
        color: red;
      }
    `);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders plain static rulesets from source without preparing an owned body surface', async () => {
    const selector = sellist([sel([el('foo')])]);
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const node = ruleset({
      selector,
      rules: body
    });
    node.prepareRegistration = () => {
      throw new Error('Static ruleset direct render should not prepare registration');
    };
    node.eval = () => {
      throw new Error('Static ruleset direct render should not evaluate a ruleset surface');
    };
    const buffer = createRenderBuffer('segmented');

    await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
      foo {
        color: red;
      }
    `);
    await expect(Promise.resolve(node.render(context, buffer))).resolves.toBeString(`
      foo {
        color: red;
      }
    `);
    expect(buffer.segments[0]).toBeString(`
      foo {
        color: red;
      }
    `);
    expect(selector.parent).toBe(node);
    expect(body.parent).toBe(node);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders static rulesets with leaf at-rules from source without preparing output', async () => {
    const selector = sellist([sel([el('foo')])]);
    const leaf = atrule({
      name: any('@custom-media', { role: 'atkeyword' }),
      prelude: spaced([any('--narrow'), any('(max-width: 30em)')])
    });
    const body = rules([
      leaf,
      decl({ name: 'color', value: any('red') })
    ]);
    const node = ruleset({
      selector,
      rules: body
    });
    node.prepareRegistration = () => {
      throw new Error('Static ruleset with leaf at-rule should not prepare registration');
    };
    node.eval = () => {
      throw new Error('Static ruleset with leaf at-rule should not evaluate a ruleset surface');
    };
    leaf.eval = () => {
      throw new Error('Static leaf at-rule should not evaluate during source-direct ruleset render');
    };
    const buffer = createRenderBuffer('segmented');

    await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
      foo {
        @custom-media --narrow (max-width: 30em);
        color: red;
      }
    `);
    await expect(Promise.resolve(node.render(context, buffer))).resolves.toBeString(`
      foo {
        @custom-media --narrow (max-width: 30em);
        color: red;
      }
    `);
    expect(selector.parent).toBe(node);
    expect(body.parent).toBe(node);
    expect(leaf.parent).toBe(body);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders ruleset leaf at-rules without public string preview transport', () => {
    const writer = new CountingWriter();
    const leaf = atrule({
      name: any('@property', { role: 'atkeyword' }),
      prelude: any('--brand-color')
    });
    leaf.toTrimmedString = () => {
      throw new Error('ruleset leaf serialization should write at-rule syntax directly');
    };
    leaf.getHeaderString = () => {
      throw new Error('ruleset leaf serialization should not use at-rule header string transport');
    };
    const node = ruleset({
      selector: sellist([sel([el('.box')])]),
      rules: rules([leaf])
    });

    try {
      expect(node.toTrimmedString({ writer })).toBeString(`
        .box {
          @property --brand-color;
        }
      `);
      expect(writer.previews).toBe(0);
    } finally {
      delete leaf.toTrimmedString;
      delete leaf.getHeaderString;
    }
  });

  it('source-direct renders static rulesets with invisible variable declarations from source', async () => {
    const selector = sellist([sel([el('foo')])]);
    const variable = vardecl({ name: 'brand', value: any('red') });
    const body = rules([
      variable,
      decl({ name: 'color', value: any('red') })
    ]);
    const node = ruleset({
      selector,
      rules: body
    });
    node.prepareRegistration = () => {
      throw new Error('Static ruleset with invisible variable should not prepare registration');
    };
    node.eval = () => {
      throw new Error('Static ruleset with invisible variable should not evaluate a ruleset surface');
    };
    variable.eval = () => {
      throw new Error('Static invisible variable should not evaluate during source-direct ruleset render');
    };
    const buffer = createRenderBuffer('segmented');

    await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
      foo {
        color: red;
      }
    `);
    await expect(Promise.resolve(node.render(context, buffer))).resolves.toBeString(`
      foo {
        color: red;
      }
    `);
    expect(buffer.segments[0]).toBeString(`
      foo {
        color: red;
      }
    `);
    expect(selector.parent).toBe(node);
    expect(body.parent).toBe(node);
    expect(variable.parent).toBe(body);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('source-direct renders static rulesets with root-only body at-rules when hoist is inactive', async () => {
    const selector = sellist([sel([el('foo')])]);
    const bodyAtRule = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: rules([
        decl({ name: 'font-family', value: any('Body') })
      ])
    });
    const node = ruleset({
      selector,
      rules: rules([
        bodyAtRule,
        decl({ name: 'color', value: any('red') })
      ])
    });
    node.prepareRegistration = () => {
      throw new Error('Static ruleset with root-only body at-rule should not prepare registration');
    };
    node.eval = () => {
      throw new Error('Static ruleset with root-only body at-rule should not evaluate a ruleset surface');
    };
    bodyAtRule.eval = () => {
      throw new Error('Static root-only body at-rule should not evaluate during source-direct ruleset render');
    };

    await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
      foo {
        @font-face {
          font-family: Body;
        }
        color: red;
      }
    `);
    expect(selector.parent).toBe(node);
    expect(bodyAtRule.parent).toBe(node.rules);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('does not source-direct render static rulesets with root-only body at-rules when hoist is active', async () => {
    context = new Context({ bubbleRootAtRules: true });
    const parentFrame = ruleset({
      selector: el('.parent'),
      rules: rules([])
    });
    context.frames = [parentFrame];
    const selector = sellist([sel([el('foo')])]);
    const bodyAtRule = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: rules([
        decl({ name: 'font-family', value: any('Body') })
      ])
    });
    const node = ruleset({
      selector,
      rules: rules([
        bodyAtRule,
        decl({ name: 'color', value: any('red') })
      ])
    });
    await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
      @font-face {
        font-family: Body;
      }
      foo {
        color: red;
      }
    `);
    expect(selector.parent).toBe(node);
    expect(bodyAtRule.parent).toBe(node.rules);
  });

  it('hoists root-only body at-rules in sibling order when hoist is active', async () => {
    context = new Context({ bubbleRootAtRules: true });
    const bodyAtRule = atrule({
      name: any('@font-face', { role: 'atkeyword' }),
      rules: rules([
        decl({ name: 'font-family', value: any('Body') })
      ])
    });
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') }),
        bodyAtRule
      ])
    });

    await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
      foo {
        color: red;
      }
      @font-face {
        font-family: Body;
      }
    `);
    expect(bodyAtRule.parent).toBe(node.rules);
  });

  it('keeps source selector and body parentage canonical during direct render', async () => {
    const root = rules([
      decl({ name: 'tone', value: any('red') })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;
    const selector = sellist([sel([el('.foo')])]);
    const body = rules([
      decl({ name: 'color', value: interpolated({
        source: INTERPOLATION_PLACEHOLDER,
        replacements: [any('blue')]
      }) })
    ]);
    const node = ruleset({
      selector,
      rules: body
    });
    const originalPrepareRegistration = RulesClass.prototype.prepareRegistration;
    let ownedBodyPrepCalls = 0;
    RulesClass.prototype.prepareRegistration = function countDynamicBodyPrep(
      this: RulesClass,
      ...args: Parameters<typeof originalPrepareRegistration>
    ): ReturnType<typeof originalPrepareRegistration> {
      if (this === body) {
        throw new Error('Dynamic ruleset direct render must not prepare the source body');
      }
      if (this.sourceNode === body) {
        ownedBodyPrepCalls++;
      }
      return originalPrepareRegistration.apply(this, args);
    };

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
        .foo {
          color: blue;
        }
      `);
    } finally {
      RulesClass.prototype.prepareRegistration = originalPrepareRegistration;
    }

    expect(ownedBodyPrepCalls).toBe(0);
    expect(selector.parent).toBe(node);
    expect(body.parent).toBe(node);
    expect(body.value[0]?.parent).toBe(body);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders already evaluated rulesets without re-entering eval', async () => {
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const evald = await node.eval(context);
    const originalEval = evald.eval;
    let evalCalls = 0;
    evald.eval = function countEvalCalls(
      this: typeof evald,
      ...args: Parameters<typeof originalEval>
    ): ReturnType<typeof originalEval> {
      evalCalls++;
      return originalEval.apply(this, args);
    };

    await expect(Promise.resolve(evald.render(context))).resolves.toBeString(`
      foo {
        color: red;
      }
    `);
    expect(evalCalls).toBe(0);
  });

  it('renders registration-prepared rulesets without deriving another prep surface', async () => {
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const prepared = await node.prepareRegistration(context);
    const originalPrepareRegistration = prepared.prepareRegistration;
    let prepareCalls = 0;
    prepared.prepareRegistration = function countPrepareCalls(
      this: typeof prepared,
      ...args: Parameters<typeof originalPrepareRegistration>
    ): ReturnType<typeof originalPrepareRegistration> {
      prepareCalls++;
      return originalPrepareRegistration.apply(this, args);
    };

    await expect(Promise.resolve(prepared.render(context))).resolves.toBeString(`
      foo {
        color: red;
      }
    `);
    expect(prepareCalls).toBe(0);
  });

  it('streams unguarded static nil-selector ruleset bodies directly from source', async () => {
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const originalRender = body.render;
    let bodyRenderCalls = 0;
    body.render = function countBodyRender(
      this: typeof body,
      ...args: Parameters<typeof originalRender>
    ): ReturnType<typeof originalRender> {
      bodyRenderCalls++;
      return originalRender.apply(this, args);
    };
    const node = ruleset({
      selector: new Nil(),
      rules: body
    });
    node.resolve = () => {
      throw new Error('Ruleset nil-selector render should evaluate natively');
    };
    const originalPrepareRegistration = RulesClass.prototype.prepareRegistration;
    let prepareCalls = 0;
    RulesClass.prototype.prepareRegistration = function countRulesPrep(
      this: RulesClass,
      ...args: Parameters<typeof originalPrepareRegistration>
    ): ReturnType<typeof originalPrepareRegistration> {
      prepareCalls++;
      return originalPrepareRegistration.apply(this, args);
    };

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red;\n');
      const buffer = createRenderBuffer('flat');
      await expect(Promise.resolve(node.render(context, buffer))).resolves.toBe('color: red;\n');
      expect(buffer.parts).toEqual(['color: red;\n']);
      expect(bodyRenderCalls).toBe(2);
      expect(prepareCalls).toBe(0);
      expect(body.parent).toBe(node);
      expect(node.evaluated).toBe(false);
      expect(node.registrationPrepared).toBe(false);
    } finally {
      RulesClass.prototype.prepareRegistration = originalPrepareRegistration;
    }
  });

  it('streams static nil-selector comments and invisible vars directly from source', async () => {
    const body = rules([
      comment('/* keep */'),
      vardecl({ name: any('private'), value: any('red') }),
      decl({ name: 'color', value: any('red') }),
      new Nil()
    ]);
    const originalRender = body.render;
    let bodyRenderCalls = 0;
    body.render = function countBodyRender(
      this: typeof body,
      ...args: Parameters<typeof originalRender>
    ): ReturnType<typeof originalRender> {
      bodyRenderCalls++;
      return originalRender.apply(this, args);
    };
    const node = ruleset({
      selector: new Nil(),
      rules: body
    });
    const originalPrepareRegistration = RulesClass.prototype.prepareRegistration;
    let prepareCalls = 0;
    RulesClass.prototype.prepareRegistration = function countRulesPrep(
      this: RulesClass,
      ...args: Parameters<typeof originalPrepareRegistration>
    ): ReturnType<typeof originalPrepareRegistration> {
      prepareCalls++;
      return originalPrepareRegistration.apply(this, args);
    };

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
        /* keep */
        color: red;
      `);
      const buffer = createRenderBuffer('flat');
      await expect(Promise.resolve(node.render(context, buffer))).resolves.toBeString(`
        /* keep */
        color: red;
      `);
      expect(bodyRenderCalls).toBe(2);
      expect(prepareCalls).toBe(0);
      expect(body.parent).toBe(node);
      expect(node.evaluated).toBe(false);
      expect(node.registrationPrepared).toBe(false);
    } finally {
      RulesClass.prototype.prepareRegistration = originalPrepareRegistration;
    }
  });

  it('keeps nested nil-selector rulesets on the owned body path', async () => {
    const nestedBody = rules([
      ruleset({
        selector: sellist([sel([el('.child')])]),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      })
    ]);
    const node = ruleset({
      selector: new Nil(),
      rules: nestedBody
    });
    const originalRender = nestedBody.render;
    let sourceBodyRenderCalls = 0;
    nestedBody.render = function countSourceBodyRender(
      this: typeof nestedBody,
      ...args: Parameters<typeof originalRender>
    ): ReturnType<typeof originalRender> {
      sourceBodyRenderCalls++;
      return originalRender.apply(this, args);
    };

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
        .child {
          color: red;
        }
      `);
    } finally {
      nestedBody.render = originalRender;
    }

    expect(sourceBodyRenderCalls).toBe(0);
    expect(nestedBody.parent).toBe(node);
    expect(nestedBody.value[0]?.parent).toBe(nestedBody);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('keeps dynamic nil-selector bodies on an owned body path', async () => {
    const dynamicBody = rules([
      vardecl({ name: any('shade'), value: any('red') }),
      decl({ name: 'color', value: ref({ key: 'shade' }, { type: 'variable' }) })
    ]);
    const node = ruleset({
      selector: new Nil(),
      rules: dynamicBody
    });
    const originalRender = dynamicBody.render;
    let sourceBodyRenderCalls = 0;
    dynamicBody.render = function countSourceBodyRender(
      this: typeof dynamicBody,
      ...args: Parameters<typeof originalRender>
    ): ReturnType<typeof originalRender> {
      sourceBodyRenderCalls++;
      return originalRender.apply(this, args);
    };

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red;\n');
      const buffer = createRenderBuffer('flat');
      await expect(Promise.resolve(node.render(context, buffer))).resolves.toBe('color: red;\n');
      expect(buffer.parts).toEqual(['color: red;\n']);
    } finally {
      dynamicBody.render = originalRender;
    }

    expect(sourceBodyRenderCalls).toBe(0);
    expect(dynamicBody.parent).toBe(node);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders guarded nil-selector rulesets without preparing source guard or body output', async () => {
    const guard = condition([bool(true)]);
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const node = ruleset({
      selector: new Nil(),
      guard,
      rules: body
    });
    const originalPrepareRegistration = RulesClass.prototype.prepareRegistration;
    let prepareCalls = 0;
    RulesClass.prototype.prepareRegistration = function countRulesPrep(
      this: RulesClass,
      ...args: Parameters<typeof originalPrepareRegistration>
    ): ReturnType<typeof originalPrepareRegistration> {
      prepareCalls++;
      return originalPrepareRegistration.apply(this, args);
    };

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red;\n');
      expect(prepareCalls).toBe(0);
      expect(guard.parent).toBe(node);
      expect(body.parent).toBe(node);
      expect(guard.evaluated).toBe(false);
      expect(body.evaluated).toBe(false);
      expect(node.evaluated).toBe(false);
      expect(node.registrationPrepared).toBe(false);
    } finally {
      RulesClass.prototype.prepareRegistration = originalPrepareRegistration;
    }
  });

  it('renders guarded nil-selector rulesets without calling the public Bool-result condition eval wrapper', async () => {
    const originalConditionEval = Condition.prototype.eval;
    Condition.prototype.eval = function evalForCounting(): never {
      throw new Error('nil-selector guard should evaluate condition booleans directly');
    };
    const node = ruleset({
      selector: new Nil(),
      guard: condition([bool(true)]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red;\n');
    } finally {
      Condition.prototype.eval = originalConditionEval;
    }
  });

  it('skips failed guarded nil-selector rulesets without mutating source state', async () => {
    const guard = condition([bool(false)]);
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const node = ruleset({
      selector: new Nil(),
      guard,
      rules: body
    });

    await expect(Promise.resolve(node.render(context))).resolves.toBe('');
    expect(guard.parent).toBe(node);
    expect(body.parent).toBe(node);
    expect(guard.evaluated).toBe(false);
    expect(body.evaluated).toBe(false);
    expect(node.guard).toBe(guard);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('keeps guarded nested rulesets on an owned body path while preserving source parentage', async () => {
    const selector = sellist([sel([el('.parent')])]);
    const child = ruleset({
      selector: sellist([sel([el('.child')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const body = rules([child]);
    const node = ruleset({
      selector,
      guard: condition([bool(true)]),
      rules: body
    });
    const originalPrepareRegistration = RulesClass.prototype.prepareRegistration;
    let sourceBodyPrepCalls = 0;
    RulesClass.prototype.prepareRegistration = function countRulesPrep(
      this: RulesClass,
      ...args: Parameters<typeof originalPrepareRegistration>
    ): ReturnType<typeof originalPrepareRegistration> {
      if (this === body) {
        sourceBodyPrepCalls++;
      }
      return originalPrepareRegistration.apply(this, args);
    };

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
        .parent {
          .child {
            color: red;
          }
        }
      `);
    } finally {
      RulesClass.prototype.prepareRegistration = originalPrepareRegistration;
    }

    expect(sourceBodyPrepCalls).toBe(0);
    expect(selector.parent).toBe(node);
    expect(body.parent).toBe(node);
    expect(child.parent).toBe(body);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('keeps failed guarded rulesets off source-direct render while preserving source body parentage', async () => {
    const selector = sellist([sel([el('.parent')])]);
    const child = ruleset({
      selector: sellist([sel([el('.child')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const body = rules([child]);
    const node = ruleset({
      selector,
      guard: condition([bool(false)]),
      rules: body
    });
    const originalPrepareRegistration = RulesClass.prototype.prepareRegistration;
    let sourceBodyPrepCalls = 0;
    RulesClass.prototype.prepareRegistration = function countRulesPrep(
      this: RulesClass,
      ...args: Parameters<typeof originalPrepareRegistration>
    ): ReturnType<typeof originalPrepareRegistration> {
      if (this === body) {
        sourceBodyPrepCalls++;
      }
      return originalPrepareRegistration.apply(this, args);
    };

    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBe('');
    } finally {
      RulesClass.prototype.prepareRegistration = originalPrepareRegistration;
    }

    expect(sourceBodyPrepCalls).toBe(0);
    expect(selector.parent).toBe(node);
    expect(body.parent).toBe(node);
    expect(child.parent).toBe(body);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('restores parent ruleset frame when child registration prep throws', () => {
    const savedFrame = ruleset({
      selector: el('.saved'),
      rules: rules([])
    });
    const throwingChild = ruleset({
      selector: el('.child'),
      rules: rules([])
    });
    throwingChild.prepareRegistration = () => {
      throw new Error('child registration prep failed');
    };
    const node = ruleset({
      selector: el('.parent'),
      rules: rules([throwingChild])
    });
    context.rulesetFrames = [savedFrame];

    expect(() => node.prepareRegistration(context)).toThrow('child registration prep failed');
    expect(context.rulesetFrames).toEqual([savedFrame]);
  });

  it('restores parent ruleset frame when child registration prep rejects', async () => {
    const savedFrame = ruleset({
      selector: el('.saved'),
      rules: rules([])
    });
    const throwingChild = ruleset({
      selector: el('.child'),
      rules: rules([])
    });
    throwingChild.prepareRegistration = () => Promise.reject(new Error('child registration prep failed'));
    const node = ruleset({
      selector: el('.parent'),
      rules: rules([throwingChild])
    });
    context.rulesetFrames = [savedFrame];

    await expect(node.prepareRegistration(context)).rejects.toThrow('child registration prep failed');
    expect(context.rulesetFrames).toEqual([savedFrame]);
  });

  it('keeps source selector canonical after ruleset registration prep', async () => {
    const selector = sellist([sel([el('.foo')])]);
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const node = ruleset({
      selector,
      rules: body
    });

    const prepared = await node.prepareRegistration(context);

    expect(prepared).not.toBe(node);
    expect(selector.parent).toBe(node);
    expect(prepared.rules).toBe(body);
  });

  it('renders comment-free ruleset headers without cloning source-free selector leaves', () => {
    const selectorLeaf = el('.foo');
    const originalClone = selectorLeaf.clone;
    let selectorLeafClones = 0;
    selectorLeaf.clone = function cloneForCounting(
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      selectorLeafClones++;
      return originalClone.apply(this, args);
    };
    const selector = sellist([sel([selectorLeaf])]);
    const sourceLeafParent = selectorLeaf.parent;
    const node = ruleset({
      selector,
      rules: rules([])
    });

    try {
      expect(node.getHeaderString(getPrintOptions(), true)).toBe('.foo {\n');
      expect(selectorLeafClones).toBe(0);
      expect(selectorLeaf.parent).toBe(sourceLeafParent);
    } finally {
      selectorLeaf.clone = originalClone;
    }
  });

  it('restores eval frames when body eval throws', () => {
    const savedRulesetFrame = ruleset({
      selector: el('.saved'),
      rules: rules([])
    });
    const savedFrame = ruleset({
      selector: el('.frame'),
      rules: rules([])
    });
    const body = rules([]);
    body.eval = () => {
      throw new Error('body eval failed');
    };
    const node = ruleset({
      selector: el('.parent'),
      rules: body
    });
    context.rulesetFrames = [savedRulesetFrame];
    context.frames = [savedFrame];

    expect(() => node.eval(context)).toThrow('body eval failed');
    expect(context.rulesetFrames).toEqual([savedRulesetFrame]);
    expect(context.frames).toEqual([savedFrame]);
  });

  it('restores eval frames when body eval rejects', async () => {
    const savedRulesetFrame = ruleset({
      selector: el('.saved'),
      rules: rules([])
    });
    const savedFrame = ruleset({
      selector: el('.frame'),
      rules: rules([])
    });
    const body = rules([]);
    body.eval = () => Promise.reject(new Error('body eval failed'));
    body.addFlag(F_MAY_ASYNC);
    const node = ruleset({
      selector: el('.parent'),
      rules: body
    });
    context.rulesetFrames = [savedRulesetFrame];
    context.frames = [savedFrame];

    await expect(node.eval(context)).rejects.toThrow('body eval failed');
    expect(context.rulesetFrames).toEqual([savedRulesetFrame]);
    expect(context.frames).toEqual([savedFrame]);
  });

  it('resolves a ruleset without touching render state', async () => {
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'border', value: spaced([any('1px'), any('solid'), any('black')]) }),
        decl({ name: 'color', value: any('#eee') })
      ])
    });

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBeString(`
      foo {
        border: 1px solid black;
        color: #eee;
      }
    `);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source selector and body canonical after resolve(context)', async () => {
    const selector = sellist([sel([el('.foo')])]);
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const node = ruleset({
      selector,
      rules: body
    });

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBeString(`
      .foo {
        color: red;
      }
    `);
    expect(selector.parent).toBe(node);
    expect(body.parent).toBe(node);
    expect(resolved.rules).not.toBe(body);
  });

  it('getHeaderString keeps reference target filtering render-local', () => {
    const node = ruleset({
      selector: sellist([sel([el('.foo')])]),
      rules: rules([])
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      referenceMode: true,
      referenceRenderEnabled: true,
      referenceFilterTargets: false
    });

    const header = node.getHeaderString(options);

    expect(header).toContain('.foo');
    expect(options.referenceFilterTargets).toBe(false);
  });

  it('filters reference-mode extended headers without cloning source-free selector leaves', () => {
    const targetLeaf = el('.target');
    const addedLeaf = el('.added');
    const originalClone = addedLeaf.clone;
    let addedLeafClones = 0;
    addedLeaf.clone = function cloneForCounting(
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      addedLeafClones++;
      return originalClone.apply(this, args);
    };
    const target = sel([targetLeaf]);
    target.addFlag(F_EXTEND_TARGET);
    const added = sel([addedLeaf]);
    added.addFlag(F_EXTENDED);
    const addedLeafParent = addedLeaf.parent;
    const node = ruleset({
      selector: sellist([target, added]),
      rules: rules([])
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      referenceMode: true,
      referenceRenderEnabled: true
    });

    try {
      expect(node.getHeaderString(options)).toBe('.added {\n');
      expect(addedLeafClones).toBe(0);
      expect(addedLeaf.parent).toBe(addedLeafParent);
    } finally {
      addedLeaf.clone = originalClone;
    }
  });

  it('streams header selectors without capture scaffolding', () => {
    const writer = new CountingWriter();
    const selector = sellist([sel([el('.foo')])]);
    const node = ruleset({
      selector,
      rules: rules([])
    });
    const options = getPrintOptions({ writer });
    const originalSelectorToString = selector.toString;
    const originalWriteSyntax = selector.writeSyntax;
    let selectorToStringCalls = 0;
    let selectorUsedActiveWriter = false;
    let selectorUsedDetachedWriter = false;
    selector.toString = function toStringWithWriterCheck(
      this: typeof selector,
      nextOptions?: Parameters<typeof originalSelectorToString>[0]
    ): string {
      selectorToStringCalls++;
      return originalSelectorToString.call(this, nextOptions);
    };
    selector.writeSyntax = function writeSyntaxWithWriterCheck(
      this: typeof selector,
      nextOptions: Parameters<typeof originalWriteSyntax>[0]
    ): void {
      selectorUsedActiveWriter = nextOptions.writer === writer;
      selectorUsedDetachedWriter = nextOptions.writer !== writer;
      originalWriteSyntax.call(this, nextOptions);
      nextOptions.writer.add('   ');
    };

    try {
      expect(node.getHeaderString(options)).toBe('.foo {\n');
      expect(writer.toString()).toBe('');
      expect(writer.captures).toBe(0);
      expect(writer.marks).toBe(0);
      expect(writer.previews).toBe(0);
      expect(writer.reads).toBe(0);
      expect(writer.restores).toBe(0);
      expect(writer.trimEnds).toBe(0);
      expect(selectorToStringCalls).toBe(0);
      expect(selectorUsedActiveWriter).toBe(false);
      expect(selectorUsedDetachedWriter).toBe(true);
    } finally {
      selector.toString = originalSelectorToString;
      selector.writeSyntax = originalWriteSyntax;
    }
  });

  it('does not spend a detached mark to trim header selector trailing whitespace', () => {
    const writer = new CountingWriter();
    const selector = sellist([sel([el('.foo')])]);
    const node = ruleset({
      selector,
      rules: rules([])
    });
    const options = getPrintOptions({ writer });
    const originalMark = OutputWriter.prototype.mark;
    let detachedMarks = 0;
    OutputWriter.prototype.mark = function countDetachedMarks(this: OutputWriter): number {
      if (this !== writer) {
        detachedMarks++;
      }
      return originalMark.call(this);
    };
    const originalWriteSyntax = selector.writeSyntax;
    selector.writeSyntax = function writeSyntaxWithTrailingWhitespace(
      this: typeof selector,
      nextOptions: Parameters<typeof originalWriteSyntax>[0]
    ): void {
      originalWriteSyntax.call(this, nextOptions);
      nextOptions.writer.add('   ');
    };

    try {
      expect(node.getHeaderString(options)).toBe('.foo {\n');
      expect(detachedMarks).toBe(0);
    } finally {
      OutputWriter.prototype.mark = originalMark;
      selector.writeSyntax = originalWriteSyntax;
    }
  });

  it('getComparableHeaderString keeps selector capture off the caller writer', () => {
    const writer = new CountingWriter();
    const selector = sellist([sel([el('.foo')])]);
    const node = ruleset({
      selector,
      rules: rules([])
    });
    const options = getPrintOptions({ writer });
    const selectorPrototypeCandidate = Object.getPrototypeOf(selector);
    if (
      !selectorPrototypeCandidate
      || typeof selectorPrototypeCandidate !== 'object'
      || !('writeSyntax' in selectorPrototypeCandidate)
      || typeof selectorPrototypeCandidate.writeSyntax !== 'function'
    ) {
      throw new TypeError('Expected selector prototype with writeSyntax');
    }
    const selectorPrototype: { writeSyntax: typeof selector.writeSyntax } = selectorPrototypeCandidate;
    const originalWriteSyntax = selectorPrototype.writeSyntax;
    let selectorUsedDetachedWriter = false;
    selectorPrototype.writeSyntax = function writeSyntaxWithWriterCheck(
      this: typeof selector,
      nextOptions: Parameters<typeof originalWriteSyntax>[0]
    ): void {
      selectorUsedDetachedWriter = nextOptions.writer !== writer;
      originalWriteSyntax.call(this, nextOptions);
      nextOptions.writer.add('   ');
    };

    try {
      expect(node.getComparableHeaderString(options)).toBe('.foo');
      expect(writer.toString()).toBe('');
      expect(selectorUsedDetachedWriter).toBe(true);
    } finally {
      selectorPrototype.writeSyntax = originalWriteSyntax;
    }
  });

  it('getHeaderString keeps selector visibility forcing render-local', () => {
    const selector = el('.foo');
    selector.removeFlag(F_VISIBLE);
    const node = ruleset({
      selector,
      rules: rules([])
    });
    const options = getPrintOptions({
      writer: new OutputWriter()
    });
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
      const header = node.getHeaderString(options);

      expect(header).toContain('.foo');
      expect(basicSelectorCloneCalls).toBe(0);
      expect(selector.hasFlag(F_VISIBLE)).toBe(false);
    } finally {
      BasicSelector.prototype.clone = originalClone;
    }
  });

  it('serializeRulesContainer keeps reference render flags render-local', () => {
    const node = ruleset({
      selector: sellist([sel([el('.foo')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    }, {
      referenceMode: true
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      referenceMode: false,
      referenceRenderEnabled: true
    });

    const out = serializeRulesContainer(node, options);

    expect(out).toBe('');
    expect(options.referenceMode).toBe(false);
    expect(options.referenceRenderEnabled).toBe(true);
  });

  it('serializeRulesContainer keeps composed selector stack render-local', () => {
    const parentSelector = sel([el('.parent')]);
    const composedSelectorStack = [parentSelector];
    const node = ruleset({
      selector: sel([el('.child')]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      collapseNesting: true,
      composedSelectorStack
    });

    const out = serializeRulesContainer(node, options);

    expect(out).toContain('.parent .child');
    expect(options.composedSelectorStack).toBe(composedSelectorStack);
    expect(options.composedSelectorStack).toEqual([parentSelector]);
  });

  it('serializeRulesContainer uses the ruleset header composition path', () => {
    const parentSelector = sel([el('.parent')]);
    const node = ruleset({
      selector: sel([el('.child')]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const originalComposeHeaderSelector = node.composeHeaderSelector;
    let composeHeaderSelectorCalls = 0;
    node.composeHeaderSelector = function countHeaderComposition(
      this: typeof node,
      ...args: Parameters<typeof originalComposeHeaderSelector>
    ): ReturnType<typeof originalComposeHeaderSelector> {
      composeHeaderSelectorCalls++;
      return originalComposeHeaderSelector.apply(this, args);
    };
    const options = getPrintOptions({
      writer: new OutputWriter(),
      collapseNesting: true,
      composedSelectorStack: [parentSelector]
    });

    try {
      const out = serializeRulesContainer(node, options);

      expect(out).toContain('.parent .child');
      expect(composeHeaderSelectorCalls).toBeGreaterThan(0);
    } finally {
      node.composeHeaderSelector = originalComposeHeaderSelector;
    }
  });

  it('serializeRulesContainer writes no-trivia ruleset headers without header string transport', () => {
    const node = ruleset({
      selector: sel([el('.child')]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
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
      const out = serializeRulesContainer(node, options);

      expect(out).toContain('.child');
      expect(headerStringCalls).toBe(0);
    } finally {
      node.getHeaderString = originalGetHeaderString;
    }
  });

  it('serializeRulesContainer compares repeated ruleset headers through comparable header keys', async () => {
    const first = ruleset({
      selector: sel([el('.same')]),
      rules: rules([
        decl({ name: 'case', value: any('1') })
      ])
    });
    const second = ruleset({
      selector: sel([el('.same')]),
      rules: rules([
        decl({ name: 'case', value: any('2') })
      ])
    });
    const node = rules([first, second]);
    let withoutCommentsHeaderCalls = 0;
    let comparableHeaderCalls = 0;
    const rulesetPrototypeCandidate = Object.getPrototypeOf(first);
    if (
      !rulesetPrototypeCandidate
      || typeof rulesetPrototypeCandidate !== 'object'
      || !('getHeaderString' in rulesetPrototypeCandidate)
      || typeof rulesetPrototypeCandidate.getHeaderString !== 'function'
      || !('getComparableHeaderString' in rulesetPrototypeCandidate)
      || typeof rulesetPrototypeCandidate.getComparableHeaderString !== 'function'
    ) {
      throw new TypeError('Expected ruleset prototype with header helpers');
    }
    const rulesetPrototype: {
      getHeaderString: typeof first.getHeaderString;
      getComparableHeaderString: typeof first.getComparableHeaderString;
    } = rulesetPrototypeCandidate;
    const originalGetHeaderString = rulesetPrototype.getHeaderString;
    const originalGetComparableHeaderString = rulesetPrototype.getComparableHeaderString;
    rulesetPrototype.getHeaderString = function countWithoutCommentsCalls(
      this: typeof first,
      ...args: Parameters<typeof originalGetHeaderString>
    ): ReturnType<typeof originalGetHeaderString> {
      if (args[1] === true) {
        withoutCommentsHeaderCalls++;
      }
      return originalGetHeaderString.apply(this, args);
    };
    rulesetPrototype.getComparableHeaderString = function countComparableCalls(
      this: typeof first,
      ...args: Parameters<typeof originalGetComparableHeaderString>
    ): ReturnType<typeof originalGetComparableHeaderString> {
      comparableHeaderCalls++;
      return originalGetComparableHeaderString.apply(this, args);
    };

    try {
      const out = await renderNodeToString(node, context, { collapseNesting: true });

      expect(out).toBeString(`
        .same {
          case: 1;
        }
        .same {
          case: 2;
        }`
      );
      expect(withoutCommentsHeaderCalls).toBe(0);
      expect(comparableHeaderCalls).toBeGreaterThan(0);
    } finally {
      rulesetPrototype.getHeaderString = originalGetHeaderString;
      rulesetPrototype.getComparableHeaderString = originalGetComparableHeaderString;
    }
  });

  it('serializeRulesContainer keeps child Rules body transport off the caller writer', () => {
    const writer = new CountingWriter();
    const childRules = rules([
      decl({ name: 'color', value: any('red') })
    ], {
      referenceMode: true
    });
    const originalWriteSyntax = childRules.writeSyntax;
    const originalToTrimmedString = childRules.toTrimmedString;
    let childSawDetachedWriter = false;
    childRules.writeSyntax = function countDetachedWriter(
      this: typeof childRules,
      nextOptions: Parameters<typeof originalWriteSyntax>[0]
    ): void {
      childSawDetachedWriter = nextOptions.writer !== writer;
      originalWriteSyntax.call(this, nextOptions);
    };
    childRules.toTrimmedString = () => {
      throw new Error('child Rules body transport should not use public string wrappers');
    };
    const node = ruleset({
      selector: sel([el('.box')]),
      rules: rules([
        childRules
      ])
    });
    const options = getPrintOptions({ writer });

    try {
      void serializeRulesContainer(node, options);
      expect(childSawDetachedWriter).toBe(true);
    } finally {
      childRules.writeSyntax = originalWriteSyntax;
      childRules.toTrimmedString = originalToTrimmedString;
    }
  });

  it('serializeRulesContainer keeps declaration fallback transport off the caller writer', () => {
    const writer = new CountingWriter();
    const colorDecl = decl({ name: 'color', value: any('red') });
    const originalWriteSyntax = colorDecl.writeSyntax;
    const originalToTrimmedString = colorDecl.toTrimmedString;
    let declarationSawDetachedWriter = false;
    colorDecl.writeSyntax = function countDetachedWriter(
      this: typeof colorDecl,
      nextOptions: Parameters<typeof originalWriteSyntax>[0]
    ): void {
      declarationSawDetachedWriter = nextOptions.writer !== writer;
      originalWriteSyntax.call(this, nextOptions);
    };
    colorDecl.toTrimmedString = () => {
      throw new Error('declaration fallback transport should not use public string wrappers');
    };
    const node = ruleset({
      selector: sel([el('.box')]),
      rules: rules([
        colorDecl
      ])
    });
    const options = getPrintOptions({ writer });

    try {
      const out = serializeRulesContainer(node, options);

      expect(out).toBeString(`
        .box {
          color: red;
        }
      `);
      expect(declarationSawDetachedWriter).toBe(true);
    } finally {
      colorDecl.writeSyntax = originalWriteSyntax;
      colorDecl.toTrimmedString = originalToTrimmedString;
    }
  });

  it('getHeaderString does not cache uncomposed selectors onto the ruleset', () => {
    const node = ruleset({
      selector: sel([el('.foo')]),
      rules: rules([])
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      collapseNesting: true,
      context
    });

    const header = node.getHeaderString(options);

    expect(header).toContain('.foo');
    expect(node._composedSelector).toBeUndefined();
  });

  it('getHeaderString keeps composed selector cache off the ruleset node', () => {
    const node = ruleset({
      selector: sel([el('.child')]),
      rules: rules([])
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      context,
      collapseNesting: true,
      composedSelectorStack: [sel([el('.parent')])]
    });

    const header = node.getHeaderString(options);

    expect(header).toContain('.parent .child');
    expect(node._composedSelector).toBeUndefined();
  });
  // it('should serialize to a module', () => {
  //   let node = rule({
  //     selector: list([sel([el('foo')])]),
  //     value: [
  //       set(keyval({ name: 'brandColor', value: js('area(5)') })),
  //       decl({ name: 'color', value: js('brandColor') })
  //     ]
  //   })
  //   node.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.rule({\n  selector: $J.list([\n    $J.sel([$J.el($J.any("foo"))])\n  ]),\n  value: $J.ruleset(\n    (() => {\n      const $OUT = []\n      let brandColor = area(5)\n      $OUT.push($J.decl({\n        name: $J.any("color"),\n        value: brandColor\n      }))\n      return $OUT\n    })()\n  )},[])'
  //   )
  // })
});
