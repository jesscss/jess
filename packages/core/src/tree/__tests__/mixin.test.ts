import { mixin, rules, el, decl, any, condition, expr, ref, list, vardecl, Node, call, ruleset, rest, sel, co, compound, sellist, interpolated, interpolatedSelector, INTERPOLATION_PLACEHOLDER, amp, pseudo, paren, dimension, op, quoted, seq, atrule, defaultguard, Rules as RulesClass, comment, Any, Bool, bool, JsFunction, style, Mixin, nil, type AnyRole } from '../index.js';
import type { Declaration } from '../declaration.js';
import type { MixinOutputChildSegment } from '../util/mixin-output-slot.js';
import type { Condition } from '../condition.js';
import type { Ruleset } from '../ruleset.js';
import { Context, TreeContext } from '../../context.js';
import { OutputWriter } from '../util/print.js';
import { lookupScopeFrameCallable, resolveFrameCell } from '../scope-frame.js';
import { getRulesEntryTraversalState } from '../util/lookup-utils.js';
import { renderNodeToString } from '../util/render-buffer.js';
import {
  attachMixinOutputSlot,
  canEnterMixinOutputForLookup,
  canEnterRulesEntryForLookup,
  getMixinOutputChildForSource,
  getMixinOutputPlacementChildren,
  getMixinOutputReferenceMode,
  getMixinOutputRulesVisibility,
  getMixinOutputScopeFrame,
  getMixinOutputSourceChild,
  getMixinOutputSourceChildren,
  getMixinOutputSourceIndex,
  getMixinOutputChildPlacementState,
  getMixinOutputPlacementRecord,
  getMixinOutputLookupState,
  getMixinOutputRuleIndex,
  getRulesetMixinPlacementSourceIndex,
  isFromRestrictedMixinOutput,
  isPublicRulesEntry,
  keepsDuplicateMixinOutputDeclaration
} from '../util/mixin-output-slot.js';
import { createCallableOuterRules, createMixinOutputRulesWrapper } from '../util/callable-surface.js';

let context: Context;

class CountingWriter extends OutputWriter {
  reads = 0;

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

// Helper to check for errors without serializing the resolved value
async function expectRejects<T>(
  promiseOrValue: Promise<T> | T,
  ErrorType?: new (...args: any[]) => Error,
  messagePattern?: RegExp
): Promise<void> {
  let error: unknown;
  try {
    await Promise.resolve(promiseOrValue);
    // Create error that will point to the call site
    const err = new Error('Expected promise to reject, but it resolved');
    // Remove this function from the stack trace so it points to the call site
    if (Error.captureStackTrace) {
      Error.captureStackTrace(err, expectRejects);
    } else {
      // Fallback: remove the first line (this function) from stack
      const stack = err.stack?.split('\n');
      if (stack && stack.length > 1) {
        err.stack = stack.slice(1).join('\n');
      }
    }
    throw err;
  } catch (e) {
    if (e instanceof Error && e.message === 'Expected promise to reject, but it resolved') {
      throw e;
    }
    error = e;
  }
  if (!error) {
    const err = new Error('Expected promise to reject, but it resolved');
    if (Error.captureStackTrace) {
      Error.captureStackTrace(err, expectRejects);
    }
    throw err;
  }
  if (ErrorType && !(error instanceof ErrorType)) {
    const errorName = error instanceof Error ? error.constructor.name : 'unknown';
    const errorMsg = error instanceof Error ? error.message : String(error);
    const err = new Error(`Expected error to be instance of ${ErrorType.name}, but got ${errorName}: ${errorMsg}`);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(err, expectRejects);
    }
    throw err;
  }
  if (messagePattern) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (!messagePattern.test(errorMsg)) {
      const err = new Error(`Expected error message to match ${messagePattern}, but got: ${errorMsg}`);
      if (Error.captureStackTrace) {
        Error.captureStackTrace(err, expectRejects);
      }
      throw err;
    }
  }
}

describe('Mixin', () => {
  afterAll(() => {
    Node.prototype.fullRender = false;
  });
  beforeEach(() => {
    Node.prototype.fullRender = true;
    context = new Context({
      /** This is the default Less behavior */
      leakyRules: true
    });
    context.depth = 2;
  });

  it('resolves mixin definitions without touching render state', async () => {
    const node = mixin({
      name: '.button',
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBeString(`
      .button() {
        color: red;
      }
    `);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes mixin syntax through direct child writers', () => {
    const params = list([vardecl({ name: 'tone', value: nil() }, { paramVar: true })]);
    const guard = condition([ref({ key: 'enabled' }, { type: 'variable' })]);
    const node = mixin({
      name: '.button',
      params,
      guard,
      rules: [
        decl({ name: 'color', value: ref({ key: 'tone' }, { type: 'variable' }) })
      ]
    });
    params.toString = () => {
      throw new Error('Mixin.writeSyntax should not stringify params publicly');
    };
    guard.toString = () => {
      throw new Error('Mixin.writeSyntax should not stringify guard publicly');
    };
    const writer = new CountingWriter();

    expect(node.toTrimmedString({ writer })).toBeString(`
      .button($tone) when $enabled {
        color: $tone;
      }
    `);
    expect(writer.toString()).toBeString(`
      .button($tone) when $enabled {
        color: $tone;
      }
    `);
  });

  it('writes mixin bodies through direct braced rules syntax', () => {
    const body = rules([]);
    body.toBraced = () => {
      throw new Error('Mixin.writeSyntax should write braced rules directly');
    };
    const node = mixin({
      name: '.button',
      rules: body.rules
    });

    expect(node.toTrimmedString()).toBe('.button() {\n\n}');
  });

  it('prepares mixin identity without pre-evaluating the body', async () => {
    const bodyDecl = decl({ name: 'color', value: any('red') });
    const body = rules([bodyDecl]);
    const node = mixin({
      name: '.button',
      rules: body.rules
    });

    const prepared = await node.prepareRegistration(context);

    expect(prepared.registrationPrepared).toBe(true);
    expect(body.registrationPrepared).toBe(false);
    expect(bodyDecl.registrationPrepared).toBe(false);
  });

  it('creates generated mixin output wrappers through a named helper', () => {
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);

    const output = createMixinOutputRulesWrapper(body, true);

    expect(output).not.toBe(body);
    expect(output.options.mixinOutputSlot?.sourceRules).toBe(body);
    expect(output.options.mixinOutputSlot?.ambientLookup).toBe(false);
    expect(output.rules).toEqual([]);
  });

  it('creates callable outer rules wrappers through a named helper', () => {
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const output = createCallableOuterRules(body, {
      rulesVisibility: {
        Declaration: 'public'
      }
    });

    expect(output).not.toBe(body);
    expect(output.options.rulesVisibility?.Declaration).toBe('public');
    expect(output.rules).toEqual([]);
    expect(body.rules).toHaveLength(1);
  });

  describe('calling', () => {
    it('should call a simple mixin', async () => {
      // Create a mixin definition: .my-mixin() { color: red; }
      const mixinDef = mixin({
        name: '.my-mixin',
        rules: [
          decl({ name: 'color', value: any('red') })
        ]
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ]
      });

      // Create root rules containing both
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          color: red;
        }
      `);
    });

    it('emits direct comment children for each mixin output placement', async () => {
      const mixinDef = mixin({
        name: '.commented',
        rules: [
          comment('/**/'),
          decl({ name: 'color', value: any('red') })
        ]
      });
      const firstRuleset = ruleset({
        selector: el('.first'),
        rules: [
          call({ name: ref({ key: '.commented' }, { type: 'mixin' }) })
        ]
      });
      const secondRuleset = ruleset({
        selector: el('.second'),
        rules: [
          call({ name: ref({ key: '.commented' }, { type: 'mixin' }) })
        ]
      });
      const root = rules([mixinDef, firstRuleset, secondRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context, { context });
      expect(css).toBeString(`
        .first {
          /**/
          color: red;
        }
        .second {
          /**/
          color: red;
        }
      `);
    });

    it('emits repeated direct declarations for each mixin output placement', async () => {
      const mixinDef = mixin({
        name: '.repeat',
        rules: [
          decl({ name: 'color', value: any('red') })
        ]
      });
      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.use'),
          rules: [
            call({ name: ref({ key: '.repeat' }, { type: 'mixin' }) }),
            call({ name: ref({ key: '.repeat' }, { type: 'mixin' }) })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .use {
          color: red;
          color: red;
        }
      `);
    });

    it('keeps static direct mixin output placements source-backed without moving source children', async () => {
      const sourceValue = any('red');
      const sourceDecl = decl({ name: 'color', value: sourceValue });
      // The Mixin node IS the body container: it owns the source children directly.
      const mixinDef = mixin({
        name: '.static-direct',
        rules: [sourceDecl]
      });
      const mixinBody = mixinDef;
      // The caller scope must be the Ruleset itself (it owns the body array); a
      // separate rules([]) wrapper is discarded and never chains to root.
      const callerRules = ruleset({
        selector: el('.use'),
        rules: []
      });
      const root = rules([
        mixinDef,
        callerRules
      ]);
      context.root = root;
      context.rulesContext = callerRules;

      const firstCall = call({ name: ref({ key: '.static-direct' }, { type: 'mixin' }) });
      callerRules.adopt(firstCall);
      const firstResult = await firstCall.eval(context);
      const secondCall = call({ name: ref({ key: '.static-direct' }, { type: 'mixin' }) });
      callerRules.adopt(secondCall);
      const secondResult = await secondCall.eval(context);

      expect(firstResult).toBeInstanceOf(RulesClass);
      expect(secondResult).toBeInstanceOf(RulesClass);
      if (!(firstResult instanceof RulesClass) || !(secondResult instanceof RulesClass)) {
        throw new Error('Expected Rules results');
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const firstDecl = firstResult.rules[0] as Declaration | undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const secondDecl = secondResult.rules[0] as Declaration | undefined;
      expect(firstDecl).toBeDefined();
      expect(secondDecl).toBeDefined();
      expect(firstDecl).toBe(sourceDecl);
      expect(secondDecl).toBe(sourceDecl);
      expect(getMixinOutputSourceChild(firstResult, firstDecl!)).toBe(sourceDecl);
      expect(getMixinOutputSourceChild(secondResult, secondDecl!)).toBe(sourceDecl);
      expect(getMixinOutputChildForSource(firstResult, sourceDecl)).toBe(firstDecl);
      expect(getMixinOutputChildForSource(secondResult, sourceDecl)).toBe(secondDecl);
      expect(firstDecl?.parent).toBe(mixinBody);
      expect(secondDecl?.parent).toBe(mixinBody);
      expect(sourceDecl.parent).toBe(mixinBody);
      expect(sourceValue.parent).toBe(sourceDecl);
      expect(firstDecl?.type).toBe('Declaration');
      expect(secondDecl?.type).toBe('Declaration');
      expect(firstDecl!.value).toBe(sourceValue);
      expect(secondDecl!.value).toBe(sourceValue);
    });

    it('derives ordinary mixin output wrappers without cloning the source Rules root', async () => {
      const originalClone = RulesClass.prototype.clone;
      let clonedMixinRoots = 0;
      const mixinBody = rules([
        comment('/**/'),
        decl({ name: 'color', value: ref({ key: 'accent' }, { type: 'variable' }) })
      ]);
      RulesClass.prototype.clone = function cloneForCounting(
        this: RulesClass,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this === mixinBody) {
          clonedMixinRoots++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const root = rules([
          vardecl({ name: 'accent', value: any('red') }),
          mixin({
            name: '.commented',
            rules: mixinBody.rules
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({ name: ref({ key: '.commented' }, { type: 'mixin' }) })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context, { context });

        expect(css).toContain('/**/');
        expect(css).toContain('color: red;');
        expect(clonedMixinRoots).toBe(0);
      } finally {
        RulesClass.prototype.clone = originalClone;
      }
    });

    it('should call a ruleset as a mixin (no parens)', async () => {
      // Create a ruleset that can be used as a mixin: .my-mixin { color: red; }
      const mixinRuleset = ruleset({
        selector: el('.my-mixin'),
        rules: [
          decl({ name: 'color', value: any('red') })
        ]
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin-ruleset' }) }) // Use 'mixin-ruleset' to find both Mixins and Rulesets
        ]
      });

      // Create root rules containing both
      const root = rules([mixinRuleset, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .my-mixin {
          color: red;
        }
        .test {
          color: red;
        }
      `);
    });

    it('does not clone childless source-free scalar leaves when calling a ruleset as a mixin', async () => {
      const originalClone = Any.prototype.clone;
      let scalarClones = 0;

      Any.prototype.clone = function cloneForCounting(
        this: Any,
        deep?: boolean,
        cloneFn?: (n: Node) => Node
      ) {
        if (this.valueOf() === 'red') {
          scalarClones++;
        }
        return originalClone.call(this, deep, cloneFn);
      };

      try {
        // The caller scope is the `.test` Ruleset directly (it owns its body array);
        // a separate rules([]) wrapper is discarded and never chains to root.
        const callerRules = ruleset({
          selector: el('.test'),
          rules: []
        });
        const root = rules([
          ruleset({
            selector: el('.my-mixin'),
            rules: [
              decl({ name: 'color', value: any('red') })
            ]
          }),
          callerRules
        ]);
        context.root = root;
        context.rulesContext = callerRules;

        const mixinCall = call({ name: ref({ key: '.my-mixin' }, { type: 'mixin-ruleset' }) });
        callerRules.adopt(mixinCall);
        const css = await renderNodeToString(root, context, { context });

        expect(css).toContain('color: red;');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('keeps ruleset-as-mixin placement children owned while reusing reusable leaves', async () => {
      // New model: the Ruleset IS its own body (no `_passedRulesWrapper`), so the
      // callable source rules and the source children's parent are the Ruleset
      // itself, not a separate `sourceBody` wrapper. The caller scope is likewise
      // the `.test` ruleset directly (the passed wrapper is unwrapped + discarded).
      const sourceValue = any('red');
      const sourceDecl = decl({ name: 'color', value: sourceValue });
      const sourceRuleset = ruleset({
        selector: el('.my-mixin'),
        rules: [sourceDecl]
      });
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: []
      });
      const root = rules([
        sourceRuleset,
        testRuleset
      ]);
      context.root = root;
      context.rulesContext = testRuleset;

      const mixinCall = call({ name: ref({ key: '.my-mixin' }, { type: 'mixin-ruleset' }) });
      testRuleset.adopt(mixinCall);
      const result = await mixinCall.eval(context);

      expect(result).toBeInstanceOf(RulesClass);
      if (!(result instanceof RulesClass)) {
        throw new Error('Expected Rules result');
      }
      const outputDecl = result.rules[0];
      expect(outputDecl).toBe(sourceDecl);
      expect(getMixinOutputSourceChild(result, outputDecl!)).toBe(sourceDecl);
      expect(getMixinOutputChildForSource(result, sourceDecl)).toBe(outputDecl);
      expect(result.options.mixinOutputSlot?.rulesetPlacement?.sourceRules).toBe(sourceRuleset);
      expect(result.options.mixinOutputSlot?.rulesetPlacement?.outputRules).toBe(result);
      expect(outputDecl?.parent).toBe(sourceRuleset);
      expect(sourceDecl.parent).toBe(sourceRuleset);
      expect(sourceValue.parent).toBe(sourceDecl);
    });

    it('keeps ruleset-as-mixin nested placement order mapped through the slot', async () => {
      const sourceComment = comment('/* placement */');
      const sourceNested = ruleset({
        selector: el('.nested'),
        rules: [
          decl({ name: 'color', value: any('red') })
        ]
      });
      // The Ruleset IS its own body container (no separate `sourceBody` wrapper);
      // it owns the source children and the caller scope is the `.test` ruleset.
      const sourceRuleset = ruleset({
        selector: el('.my-mixin'),
        rules: [sourceComment, sourceNested]
      });
      const callerRules = ruleset({
        selector: el('.test'),
        rules: []
      });
      const root = rules([
        sourceRuleset,
        callerRules
      ]);
      context.root = root;
      context.rulesContext = callerRules;

      const mixinCall = call({ name: ref({ key: '.my-mixin' }, { type: 'mixin-ruleset' }) });
      callerRules.adopt(mixinCall);
      const result = await mixinCall.eval(context);

      expect(result).toBeInstanceOf(RulesClass);
      if (!(result instanceof RulesClass)) {
        throw new Error('Expected Rules result');
      }
      expect(getMixinOutputSourceChildren(result)).toEqual(sourceRuleset.rules);
      expect(result.rules.map(child => getMixinOutputSourceChild(result, child))).toEqual(sourceRuleset.rules);
      expect(sourceRuleset.rules.map(source => getMixinOutputChildForSource(result, source))).toEqual(result.rules);
      expect(result.options.mixinOutputSlot?.rulesetPlacement?.childSegments.map((segment: MixinOutputChildSegment) => segment.source)).toEqual(sourceRuleset.rules);
      expect(result.options.mixinOutputSlot?.rulesetPlacement?.childSegments.map((segment: MixinOutputChildSegment) => segment.output)).toEqual(result.rules);
      expect(result.rules.map(child => getRulesetMixinPlacementSourceIndex(result, child))).toEqual([0, 1]);
      expect(result.rules.map(child => result.options.mixinOutputSlot?.rulesetPlacement?.sourceIndexByOutput.get(child))).toEqual([0, 1]);
      expect(result.rules[0]).not.toBe(sourceComment);
      expect(result.rules[1]).not.toBe(sourceNested);
      expect(sourceComment.parent).toBe(sourceRuleset);
      expect(sourceNested.parent).toBe(sourceRuleset);
      expect(result.rules.map(child => child.parent)).toEqual([result, result]);
    });

    it('should call a mixin with parameters', async () => {
      // Create a mixin with a parameter: .my-mixin(@color) { color: @color; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('color', { role: 'property' }) // Parameter without default is Any with role: 'property' (like variable names)
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      // Create root rules containing both
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          color: blue;
        }
      `);
    });

    it('should call a mixin with default parameter values', async () => {
      // Create a mixin with a default parameter: .my-mixin(@color: red) { color: @color; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          vardecl({ name: 'color', value: any('red') }, { paramVar: true })
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin without args: .test { .my-mixin(); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: [
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ]
      });

      // Create a ruleset that calls the mixin with args: .test2 { .my-mixin(blue); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      const root = rules([mixinDef, testRuleset1, testRuleset2]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test1 {
          color: red;
        }
        .test2 {
          color: blue;
        }
      `);
    });

    it('keeps nested callable buckets visible on live parameter scope frames', async () => {
      const mixinDef = mixin({
        name: '.outer',
        params: list([
          vardecl({ name: 'value', value: any('blue') }, { paramVar: true })
        ]),
        rules: [
          mixin({
            name: '.inner',
            params: list([
              vardecl({ name: 'tone', value: ref({ key: 'value' }, { type: 'variable' }) }, { paramVar: true })
            ]),
            rules: [
              mixin({
                name: '.leaf',
                rules: [
                  decl({ name: 'color', value: ref({ key: 'tone' }, { type: 'variable' }) })
                ]
              }),
              call({ name: ref({ key: '.leaf' }, { type: 'mixin' }) })
            ]
          }),
          call({ name: ref({ key: '.inner' }, { type: 'mixin' }) })
        ]
      });
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({ name: ref({ key: '.outer' }, { type: 'mixin' }) })
        ]
      });
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          color: blue;
        }
      `);
    });

    it('evaluates default params against earlier parameter bindings', async () => {
      const mixinDef = mixin({
        name: '.button-variant',
        params: list([
          any('bg', { role: 'property' }),
          vardecl({
            name: 'border',
            value: call({
              name: ref({ key: 'derive-border' }, { type: 'function' }),
              args: list([ref({ key: 'bg' }, { type: 'variable' })])
            })
          }, { paramVar: true })
        ]),
        rules: [
          decl({ name: 'background', value: ref({ key: 'bg' }, { type: 'variable' }) }),
          decl({ name: 'border-color', value: ref({ key: 'border' }, { type: 'variable' }) })
        ]
      });

      const component = ruleset({
        selector: el('.btn-primary'),
        rules: [
          call({
            name: ref({ key: '.button-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      const root = rules([mixinDef, component]);
      root.setFunctionBinding('derive-border', new JsFunction({
        name: 'derive-border',
        fn: (value: Node) => value
      }));
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .btn-primary {
          background: blue;
          border-color: blue;
        }
      `);
    });

    it('resolves local mixin body variable inside a detached ruleset passed to another mixin (closure)', async () => {
      // Reproduces: Bootstrap's #table-row-variant / #hover pattern
      //   #hover(@content) { &:hover { @content(); } }
      //   #table-row-variant(@background) {
      //     @hover-background: darken(@background, 5%);  <-- local var
      //     #hover({ background-color: @hover-background; });  <-- closure!
      //   }
      //
      // @hover-background is a body-level VarDeclaration in the mixin scope.
      // When the detached ruleset { background-color: @hover-background; } is evaluated
      // inside #hover (as @content()), it must still find @hover-background.

      // Build #hover(@content) { &:hover { @content(); } }
      const hoverMixin = mixin({
        name: '.hover',
        params: list([any('content', { role: 'property' })]),
        rules: [
          ruleset({
            selector: compound([amp(), el(':hover')]),
            rules: [
              call({ name: ref({ key: 'content' }, { type: 'variable' }) })
            ]
          })
        ]
      });

      // Build #table-row-variant(@background) {
      //   @hover-background: darken(@background, 5%);
      //   .hover({ background-color: @hover-background; });
      // }
      // Simplified: use a literal value for @hover-background default
      const tableRowVariantMixin = mixin({
        name: '.table-row-variant',
        params: list([any('background', { role: 'property' })]),
        rules: [
          // @hover-background: @background (local body var, not a param)
          vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
          // .hover({ background-color: @hover-background; })
          call({
            name: ref({ key: '.hover' }, { type: 'mixin' }),
            args: list([
              // detached ruleset that references the local var
              rules([
                decl({ name: 'background-color', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
              ])
            ])
          })
        ]
      });

      const component = ruleset({
        selector: el('.table-primary'),
        rules: [
          call({
            name: ref({ key: '.table-row-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      const root = rules([hoverMixin, tableRowVariantMixin, component]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      // @hover-background = @background = blue
      // Jess preserves CSS nesting: &:hover stays nested, not compiled to .table-primary:hover
      expect(css).toContain('.table-primary');
      expect(css).toContain('&:hover');
      expect(css).toContain('background-color: blue');
    });

    it('resolves local mixin body variable inside a detached ruleset when call is nested in a child ruleset', async () => {
      // Reproduces the jess test structure where #hover() is called INSIDE a nested ruleset,
      // not at the top level of the mixin body. @hover-background is declared at the OUTER
      // mixin body level, but the call is inside .table-hover { #hover({...}); }.

      const hoverMixin = mixin({
        name: '.hover',
        params: list([any('content', { role: 'property' })]),
        rules: [
          ruleset({
            selector: compound([amp(), el(':hover')]),
            rules: [
              call({ name: ref({ key: 'content' }, { type: 'variable' }) })
            ]
          })
        ]
      });

      const tableRowVariantMixin = mixin({
        name: '.table-row-variant',
        params: list([any('background', { role: 'property' })]),
        rules: [
          // @hover-background: @background (local body var, at outer mixin level)
          vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
          // .table-hover { .hover({ background-color: @hover-background; }); }
          ruleset({
            selector: el('.table-hover'),
            rules: [
              call({
                name: ref({ key: '.hover' }, { type: 'mixin' }),
                args: list([
                  rules([
                    decl({ name: 'background-color', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
                  ])
                ])
              })
            ]
          })
        ]
      });

      const component = ruleset({
        selector: el('.table-primary'),
        rules: [
          call({
            name: ref({ key: '.table-row-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      const root = rules([hoverMixin, tableRowVariantMixin, component]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.table-hover');
      expect(css).toContain('&:hover');
      expect(css).toContain('background-color: blue');
    });

    it('resolves local mixin body vars when a detached ruleset is stored in a variable and called directly', async () => {
      const tableRowVariantMixin = mixin({
        name: '.table-row-variant',
        params: list([any('background', { role: 'property' })]),
        rules: [
          vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
          vardecl({
            name: 'hover-content',
            value: rules([
              decl({ name: 'background-color', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
            ])
          }),
          call({ name: ref({ key: 'hover-content' }, { type: 'variable' }) })
        ]
      });

      const component = ruleset({
        selector: el('.table-primary'),
        rules: [
          call({
            name: ref({ key: '.table-row-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      const root = rules([tableRowVariantMixin, component]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.table-primary');
      expect(css).toContain('background-color: blue');
    });

    it('unlocks detached rulesets without deep-cloning their body leaves first', async () => {
      const originalClone = Any.prototype.clone;
      let scalarClones = 0;

      Any.prototype.clone = function cloneForCounting(
        this: Any,
        deep?: boolean,
        cloneFn?: (n: Node) => Node
      ) {
        if (this.valueOf() === 'red') {
          scalarClones++;
        }
        return originalClone.call(this, deep, cloneFn);
      };

      try {
        // New model: the Ruleset IS its own body (no `_passedRulesWrapper`), so use
        // the ruleset itself as the caller scope — it is parented to root and its
        // children resolve `content` up the chain. (Formerly a separate `callerRules`
        // wrapper was passed as `rules:` and used as the live caller handle; that
        // wrapper is now unwrapped + discarded, so it would be orphaned.)
        const testRuleset = ruleset({
          selector: el('.test'),
          rules: []
        });
        const root = rules([
          vardecl({
            name: 'content',
            value: rules([
              decl({ name: 'color', value: any('red') })
            ])
          }),
          testRuleset
        ]);
        context.root = root;
        context.rulesContext = testRuleset;

        const detachedCall = call({ name: ref({ key: 'content' }, { type: 'variable' }) });
        testRuleset.adopt(detachedCall);
        const result = await detachedCall.eval(context);
        const css = await result.render(context);

        expect(css).toContain('color: red;');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('unlocks detached rulesets without shallow-cloning the rules wrapper', async () => {
      const originalClone = RulesClass.prototype.clone;
      let detachedRuleClones = 0;

      RulesClass.prototype.clone = function cloneForCounting(
        this: RulesClass,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        const [deep] = args;
        if (
          deep === false
          && this.rules.some(node => (
            node.type === 'Declaration'
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            && (node as Declaration).name?.valueOf?.() === 'color'
          ))
        ) {
          detachedRuleClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        // New model: use the ruleset directly as the caller scope (see the
        // deep-clone test above) — the passed `rules:` wrapper is unwrapped + gone.
        const testRuleset = ruleset({
          selector: el('.test'),
          rules: []
        });
        const root = rules([
          vardecl({
            name: 'content',
            value: rules([
              decl({ name: 'color', value: any('red') })
            ])
          }),
          testRuleset
        ]);
        context.root = root;
        context.rulesContext = testRuleset;

        const detachedCall = call({ name: ref({ key: 'content' }, { type: 'variable' }) });
        testRuleset.adopt(detachedCall);
        const result = await detachedCall.eval(context);
        const css = await result.render(context);

        expect(css).toContain('color: red;');
        expect(detachedRuleClones).toBe(0);
      } finally {
        RulesClass.prototype.clone = originalClone;
      }
    });

    it('resolves local mixin body vars when a detached ruleset variable is called inside a child ruleset', async () => {
      const tableRowVariantMixin = mixin({
        name: '.table-row-variant',
        params: list([any('background', { role: 'property' })]),
        rules: [
          vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
          vardecl({
            name: 'hover-content',
            value: rules([
              decl({ name: 'background-color', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.table-hover'),
            rules: [
              call({ name: ref({ key: 'hover-content' }, { type: 'variable' }) })
            ]
          })
        ]
      });

      const component = ruleset({
        selector: el('.table-primary'),
        rules: [
          call({
            name: ref({ key: '.table-row-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      const root = rules([tableRowVariantMixin, component]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.table-primary');
      expect(css).toContain('.table-hover');
      expect(css).toContain('background-color: blue');
    });

    it('prefers local mixin body vars over same-named globals when detached ruleset vars are called directly', async () => {
      const tableRowVariantMixin = mixin({
        name: '.table-row-variant',
        params: list([any('background', { role: 'property' })]),
        rules: [
          vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
          vardecl({
            name: 'hover-content',
            value: rules([
              decl({ name: 'background-color', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
            ])
          }),
          call({ name: ref({ key: 'hover-content' }, { type: 'variable' }) })
        ]
      });

      const component = ruleset({
        selector: el('.table-primary'),
        rules: [
          call({
            name: ref({ key: '.table-row-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      const root = rules([
        vardecl({ name: 'hover-background', value: any('red') }),
        tableRowVariantMixin,
        component
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.table-primary');
      expect(css).toContain('background-color: blue');
      expect(css).not.toContain('background-color: red');
    });

    it('resolves default params when mixin body lives in a separate (imported) rules context', async () => {
      // Simulates: @import "mixins.less" where mixins.less defines:
      //   .responsive-mixin(@size: 14px, @weight: normal) { font-size: @size; font-weight: @weight; }
      // and the main file calls: .component { .responsive-mixin(); }
      //
      // The mixin body's parent chain points into the "imported" tree, not the main tree.
      // outerRules.scopeFrame must still carry the default bindings.

      const mixinBody = rules([
        decl({ name: 'font-size', value: ref({ key: 'size' }, { type: 'variable' }) }),
        decl({ name: 'font-weight', value: ref({ key: 'weight' }, { type: 'variable' }) })
      ]);

      // Build an "imported" root — mixin lives here
      const importedMixinDef = mixin({
        name: '.responsive-mixin',
        params: list([
          vardecl({ name: 'size', value: any('14px') }, { paramVar: true }),
          vardecl({ name: 'weight', value: any('normal') }, { paramVar: true })
        ]),
        rules: mixinBody.rules
      });
      const importedRoot = rules([importedMixinDef]);

      // The main file calls the mixin inside a ruleset
      const component = ruleset({
        selector: el('.component'),
        rules: [
          call({ name: ref({ key: '.responsive-mixin' }, { type: 'mixin' }) })
        ]
      });

      // Wire the imported root into the main root via push so lookup can find the mixin.
      const mainRoot = rules([importedRoot, component]);
      context.root = mainRoot;

      const css = await renderNodeToString(mainRoot, context);

      expect(css).toBeString(`
        .component {
          font-size: 14px;
          font-weight: normal;
        }
      `);
    });

    it('resolves default params when mixin is nested inside a namespace (Less import pattern)', async () => {
      // Simulates a multi-default-param mixin nested inside a namespace ruleset
      // equivalent to Bootstrap's .button-variant(@background, @border, @hover-background)
      // where the mixin params should remain accessible throughout the body

      const mixinDef = mixin({
        name: '.button-variant',
        params: list([
          any('background', { role: 'property' }),
          any('border', { role: 'property' }),
          vardecl({ name: 'hover-background', value: any('darken') }, { paramVar: true })
        ]),
        rules: [
          decl({ name: 'background-color', value: ref({ key: 'background' }, { type: 'variable' }) }),
          decl({ name: 'border-color', value: ref({ key: 'border' }, { type: 'variable' }) }),
          decl({ name: 'background-hover', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
        ]
      });

      const component = ruleset({
        selector: el('.btn-primary'),
        rules: [
          call({
            name: ref({ key: '.button-variant' }, { type: 'mixin' }),
            args: list([any('blue'), any('darkblue')])
          })
        ]
      });

      const root = rules([mixinDef, component]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .btn-primary {
          background-color: blue;
          border-color: darkblue;
          background-hover: darken;
        }
      `);
    });

    it('leaks non-param vars from mixin output in leaky Less mode', async () => {
      const setHeight = mixin({
        name: '.setHeight',
        params: list([
          any('h', { role: 'property' })
        ]),
        rules: [
          vardecl({ name: 'height', value: any('1024px') })
        ]
      });

      const useHeight = mixin({
        name: '.useHeightInMixinCall',
        params: list([
          any('h', { role: 'property' })
        ]),
        rules: [
          ruleset({
            selector: el('.useHeightInMixinCall'),
            rules: [
              decl({ name: 'mixin-height', value: ref({ key: 'h' }, { type: 'variable' }) })
            ]
          })
        ]
      });

      const root = rules([
        setHeight,
        useHeight,
        vardecl({ name: 'mainHeight', value: any('50%') }),
        call({
          name: ref({ key: '.setHeight' }, { type: 'mixin' }),
          args: list([ref({ key: 'mainHeight' }, { type: 'variable' })])
        }),
        ruleset({
          selector: el('.heightIsSet'),
          rules: [
            decl({ name: 'height', value: ref({ key: 'height' }, { type: 'variable' }) })
          ]
        }),
        call({
          name: ref({ key: '.useHeightInMixinCall' }, { type: 'mixin' }),
          args: list([ref({ key: 'height' }, { type: 'variable' })])
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.heightIsSet');
      expect(css).toContain('height: 1024px;');
      expect(css).toContain('.useHeightInMixinCall');
      expect(css).toContain('mixin-height: 1024px;');
    });

    it('does not let earlier sibling declarations see later mixin output in leaky Less mode', async () => {
      const setMix = mixin({
        name: '.mixin',
        rules: [
          vardecl({ name: 'mix', value: any('#989') })
        ]
      });

      const root = rules([
        setMix,
        vardecl({ name: 'mix', value: any('blue') }),
        ruleset({
          selector: el('.tiny-scope'),
          rules: [
            decl({ name: 'color', value: ref({ key: 'mix' }, { type: 'variable' }) }),
            call({ name: ref({ key: '.mixin' }, { type: 'mixin' }) })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.tiny-scope');
      expect(css).toContain('color: blue;');
      expect(css).not.toContain('color: #989;');
    });

    it('falls back to caller scope for unresolved body vars while keeping default param scope lexical', async () => {
      const mixinNoParam = mixin({
        name: '.mixinNoParam',
        params: list([
          vardecl({ name: 'parameter', value: ref({ key: 'parameterDefault' }, { type: 'variable' }) }, { paramVar: true })
        ]),
        guard: condition([
          ref({ key: 'parameter' }, { type: 'variable' }),
          '=',
          any('top level')
        ]),
        rules: [
          decl({ name: 'default', value: ref({ key: 'parameter' }, { type: 'variable' }) }),
          comment('/* source order */'),
          decl({ name: 'scope', value: ref({ key: 'anotherVariable' }, { type: 'variable' }) }),
          decl({ name: 'sub-scope-only', value: ref({ key: 'subScopeOnly' }, { type: 'variable' }) })
        ]
      });

      const root = rules([
        vardecl({ name: 'parameterDefault', value: any('top level') }),
        vardecl({ name: 'anotherVariable', value: any('top level') }),
        mixinNoParam,
        ruleset({
          selector: el('#allAreUsedHere'),
          rules: [
            vardecl({ name: 'parameterDefault', value: any('inside') }),
            vardecl({ name: 'anotherVariable', value: any('inside') }),
            vardecl({ name: 'subScopeOnly', value: any('inside') }),
            call({ name: ref({ key: '.mixinNoParam' }, { type: 'mixin' }) })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('default: top level;');
      expect(css).toContain('scope: top level;');
      expect(css).toContain('sub-scope-only: inside;');
    });

    it('keeps ordinary mixin output as a runtime wrapper without stamping source body parents', async () => {
      const mixinNoParam = mixin({
        name: '.mixinNoParam',
        params: list([
          vardecl({ name: 'parameter', value: ref({ key: 'parameterDefault' }, { type: 'variable' }) }, { paramVar: true })
        ]),
        guard: condition([
          ref({ key: 'parameter' }, { type: 'variable' }),
          '=',
          any('top level')
        ]),
        rules: [
          decl({ name: 'default', value: ref({ key: 'parameter' }, { type: 'variable' }) }),
          decl({ name: 'scope', value: ref({ key: 'anotherVariable' }, { type: 'variable' }) }),
          decl({ name: 'sub-scope-only', value: ref({ key: 'subScopeOnly' }, { type: 'variable' }) })
        ]
      });
      // mixinNoParam.rules is Node[] but at runtime the mixin itself is the rules container
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const mixinBody = mixinNoParam as unknown as RulesClass;

      // The caller scope is the `#allAreUsedHere` Ruleset directly (it owns its body
      // and chains to root); a detached rules([]) wrapper never resolves up to root.
      const callerRules = ruleset({
        selector: el('#allAreUsedHere'),
        rules: [
          vardecl({ name: 'parameterDefault', value: any('inside') }),
          vardecl({ name: 'anotherVariable', value: any('inside') }),
          vardecl({ name: 'subScopeOnly', value: any('inside') })
        ]
      });

      const root = rules([
        vardecl({ name: 'parameterDefault', value: any('top level') }),
        vardecl({ name: 'anotherVariable', value: any('top level') }),
        mixinNoParam,
        callerRules
      ]);
      context.root = root;
      context.rulesContext = callerRules;

      const mixinCall = call({ name: ref({ key: '.mixinNoParam' }, { type: 'mixin' }) });
      callerRules.adopt(mixinCall);

      const result = await mixinCall.eval(context);

      expect(result).toBeInstanceOf(RulesClass);
      if (!(result instanceof RulesClass)) {
        throw new Error('Expected Rules result');
      }
      expect(Reflect.has(result, 'sourceParent')).toBe(false);
      expect(result).not.toBe(mixinBody);
      expect(result.sourceNode).toBe(mixinBody);
      expect(result.options.referenceMode).toBe(false);
      expect(result.options.mixinOutputSlot?.ambientLookup).toBe(true);
      expect(canEnterMixinOutputForLookup({ node: result }, { type: 'Mixin', hasTarget: false })).toBe(true);
      expect(canEnterRulesEntryForLookup({ node: result }, { type: 'Mixin', hasTarget: false })).toBe(true);
      expect(result.options.mixinOutputSlot?.sourceRules).toBe(mixinBody);
      expect(result.options.mixinOutputSlot?.outputRules).toBe(result);
      expect(result.options.mixinOutputSlot?.childSegments.map((segment: MixinOutputChildSegment) => ({
        kind: segment.kind,
        source: segment.source,
        output: segment.output,
        index: segment.index
      }))).toEqual(mixinBody.rules.map((source, index) => ({
        kind: 'source-child',
        source,
        output: result.rules[index],
        index
      })));
      expect(result.rules.map(child => getMixinOutputSourceChild(result, child))).toEqual(mixinBody.rules);
      expect(getMixinOutputSourceChildren(result)).toEqual(mixinBody.rules);
      expect(getMixinOutputPlacementChildren(result)).toEqual(result.rules);
      expect(getMixinOutputChildPlacementState(result, result.rules[0]!)).toEqual({
        outputChild: result.rules[0],
        outputRules: result,
        sourceChild: mixinBody.rules[0],
        sourceIndex: 0
      });
      expect(getMixinOutputPlacementRecord(result)?.source).toBe(mixinBody);
      expect(getMixinOutputPlacementRecord(result)?.output).toBe(result);
      expect(getMixinOutputScopeFrame(result)).toBe(result.getScopeFrame());
      expect(mixinBody.rules.map(source => getMixinOutputChildForSource(result, source))).toEqual(result.rules);
      expect(result.rules.map(child => result.options.mixinOutputSlot?.sourceIndexByOutput.get(child))).toEqual([0, 1, 2]);
      expect(result.rules.map(child => getMixinOutputSourceIndex(result, child))).toEqual([0, 1, 2]);
      expect(result.rules.map(child => getMixinOutputRuleIndex(result, child, 99))).toEqual([0, 1, 2]);
      expect(result.options.mixinOutputSlot?.rulesetPlacement).toBeUndefined();
      expect(result.getScopeFrame().fallbackFrame?.rulesNode).toBe(callerRules);
      expect(mixinBody.parent).toBe(mixinNoParam);
      const css = await result.render(context);
      expect(css).toContain('default: top level;');
      expect(css).toContain('scope: top level;');
      expect(css).toContain('sub-scope-only: inside;');

      const secondMixinCall = call({ name: ref({ key: '.mixinNoParam' }, { type: 'mixin' }) });
      callerRules.adopt(secondMixinCall);
      const secondResult = await secondMixinCall.eval(context);
      expect(secondResult).toBeInstanceOf(RulesClass);
      if (!(secondResult instanceof RulesClass)) {
        throw new Error('Expected Rules result');
      }
      expect(secondResult).not.toBe(result);
      expect(secondResult.rules).not.toBe(result.rules);
      expect(secondResult.options.referenceMode).toBe(false);
      expect(secondResult.options.mixinOutputSlot?.ambientLookup).toBe(true);
      expect(secondResult.rules.map(child => getMixinOutputSourceChild(secondResult, child))).toEqual(mixinBody.rules);
      expect(getMixinOutputSourceChildren(secondResult)).toEqual(mixinBody.rules);
      expect(getMixinOutputPlacementChildren(secondResult)).toEqual(secondResult.rules);
      expect(getMixinOutputScopeFrame(secondResult)).toBe(secondResult.getScopeFrame());
      expect(mixinBody.rules.map(source => getMixinOutputChildForSource(secondResult, source))).toEqual(secondResult.rules);
      expect(secondResult.rules.map(child => secondResult.options.mixinOutputSlot?.sourceIndexByOutput.get(child))).toEqual([0, 1, 2]);
      expect(secondResult.rules.map(child => getMixinOutputSourceIndex(secondResult, child))).toEqual([0, 1, 2]);
      expect(secondResult.rules.map(child => getMixinOutputRuleIndex(secondResult, child, 99))).toEqual([0, 1, 2]);
      expect(secondResult.options.mixinOutputSlot?.rulesetPlacement).toBeUndefined();
      expect(secondResult.rules).toEqual(result.rules);
    });

    it('keeps mixin-output entry traversal lookup-owned and type-specific', () => {
      const source = rules([
        decl({ name: 'color', value: any('red') })
      ]);
      const fallbackRules = rules([]);
      const fallbackFrame = fallbackRules.getScopeFrame();
      const output = rules([
        decl({ name: 'color', value: any('red') })
      ], {
        rulesVisibility: {
          Declaration: 'public',
          Mixin: 'public',
          Ruleset: 'public',
          VarDeclaration: 'private'
        }
      });
      attachMixinOutputSlot(output, source, true, { fallbackFrame });
      const entry = { node: output };

      expect(output.options.referenceMode).toBe(false);
      expect(getMixinOutputReferenceMode(output)).toBe(false);
      expect(output.options.mixinOutputSlot?.fallbackFrame).toBe(fallbackFrame);
      expect(getMixinOutputRulesVisibility(output)).toBe(output.options.rulesVisibility);
      expect(getMixinOutputPlacementChildren(output)).toEqual(output.rules);
      expect(getMixinOutputScopeFrame(output)).toBe(output.getScopeFrame());
      expect(output.getScopeFrame().fallbackFrame).toBe(fallbackFrame);
      expect(canEnterMixinOutputForLookup(entry, { type: 'VarDeclaration', hasTarget: false })).toBe(false);
      expect(canEnterMixinOutputForLookup(entry, { type: 'VarDeclaration', hasTarget: true })).toBe(true);
      expect(getMixinOutputLookupState(entry, { type: 'Mixin', hasTarget: true })).toEqual({
        ambientLookup: false,
        canEnter: true,
        hasTarget: true,
        referenceMode: false,
        visibility: 'public'
      });
      expect(getRulesEntryTraversalState(entry, { type: 'Mixin', hasTarget: true })?.mixinOutput).toEqual({
        ambientLookup: false,
        canEnter: true,
        hasTarget: true,
        referenceMode: false,
        visibility: 'public'
      });
      expect(canEnterRulesEntryForLookup(entry, { type: 'VarDeclaration', hasTarget: true })).toBe(false);
      expect(canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: true })).toBe(true);

      output.options.rulesVisibility.VarDeclaration = 'public';
      expect(canEnterRulesEntryForLookup(entry, { type: 'VarDeclaration', hasTarget: true })).toBe(true);

      const slotVisibility = output.options.rulesVisibility;
      delete (output.options as Partial<typeof output.options>).referenceMode;
      delete (output.options as Partial<typeof output.options>).rulesVisibility;
      expect(getMixinOutputRulesVisibility(output)).toBe(slotVisibility);
      expect(getMixinOutputReferenceMode(output)).toBe(false);
      expect(canEnterRulesEntryForLookup(entry, { type: 'Declaration', hasTarget: true })).toBe(true);
      expect(isPublicRulesEntry(entry, 'Declaration')).toBe(true);
    });

    it('detects restricted mixin-output ancestry through the slot helper', () => {
      const source = rules([
        decl({ name: 'color', value: any('red') })
      ]);
      const restrictedOutput = rules([
        decl({ name: 'color', value: any('red') })
      ]);
      attachMixinOutputSlot(restrictedOutput, source, true);

      const ambientOutput = rules([
        decl({ name: 'color', value: any('blue') })
      ]);
      attachMixinOutputSlot(ambientOutput, source, false);

      expect(isFromRestrictedMixinOutput(restrictedOutput.rules[0])).toBe(true);
      expect(isFromRestrictedMixinOutput(ambientOutput.rules[0])).toBe(false);
      expect(keepsDuplicateMixinOutputDeclaration(restrictedOutput.rules[0])).toBe(true);
      expect(keepsDuplicateMixinOutputDeclaration(ambientOutput.rules[0])).toBe(false);
    });

    it('does not shallow-clone mixin body children to create param guard wrappers', async () => {
      const originalClone = RulesClass.prototype.clone;
      let shallowMarkerBodyClones = 0;
      RulesClass.prototype.clone = function cloneForCounting(
        this: RulesClass,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        const [deep] = args;
        if (
          deep === false
          && this.rules.some(node => (
            node.type === 'Declaration'
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            && (node as Declaration).name?.valueOf?.() === 'marker'
          ))
        ) {
          shallowMarkerBodyClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.guarded',
            params: list([any('color', { role: 'property' })]),
            guard: condition([
              ref({ key: 'color' }, { type: 'variable' }),
              '=',
              any('red')
            ]),
            rules: [
              decl({ name: 'marker', value: ref({ key: 'color' }, { type: 'variable' }) })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.guarded' }, { type: 'mixin' }),
                args: list([any('red')])
              })
            ]
          })
        ]);
        context.root = root;
        root.getScopeFrame();

        const css = await renderNodeToString(root, context);
        expect(css).toContain('marker: red;');
        expect(shallowMarkerBodyClones).toBe(0);
      } finally {
        RulesClass.prototype.clone = originalClone;
      }
    });

    it('does not copy childless evaluated scalar args just to bind mixin params', async () => {
      const originalCopy = Any.prototype.cloneForPlacement;
      let scalarCopies = 0;
      Any.prototype.cloneForPlacement = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'red') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.noop',
            params: list([any('color', { role: 'property' })]),
            rules: []
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.noop' }, { type: 'mixin' }),
                args: list([any('red')])
              })
            ]
          })
        ]);
        context.root = root;
        root.getScopeFrame();

        const css = await renderNodeToString(root, context);
        expect(css).toBe('');
        expect(scalarCopies).toBe(0);
      } finally {
        Any.prototype.cloneForPlacement = originalCopy;
      }
    });

    it('does not clone childless source-free scalar leaves when calling a dynamic mixin body', async () => {
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
        const root = rules([
          vardecl({ name: 'borderColor', value: any('blue') }),
          mixin({
            name: '.paint',
            rules: [
              decl({ name: 'color', value: any('red') }),
              decl({ name: 'border-color', value: ref({ key: 'borderColor' }, { type: 'variable' }) })
            ]
          }),
          ruleset({
            selector: el('.test'),
            rules: [
              call({ name: ref({ key: '.paint' }, { type: 'mixin' }) })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);

        expect(css).toContain('color: red;');
        expect(css).toContain('border-color: blue;');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('does not copy childless scalar params again when resolving live slots', async () => {
      const originalCopy = Any.prototype.cloneForPlacement;
      let scalarCopies = 0;
      Any.prototype.cloneForPlacement = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'red') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.use-color',
            params: list([any('color', { role: 'property' })]),
            rules: [
              decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.use-color' }, { type: 'mixin' }),
                args: list([any('red')])
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('color: red;');
        expect(scalarCopies).toBe(0);
      } finally {
        Any.prototype.cloneForPlacement = originalCopy;
      }
    });

    it('does not copy childless static default params just to bind mixin params', async () => {
      const originalCopy = Any.prototype.cloneForPlacement;
      let scalarCopies = 0;
      Any.prototype.cloneForPlacement = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'red') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.noop',
            params: list([
              vardecl({ name: 'color', value: any('red') }, { paramVar: true })
            ]),
            rules: []
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.noop' }, { type: 'mixin' })
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toBe('');
        expect(scalarCopies).toBe(0);
      } finally {
        Any.prototype.cloneForPlacement = originalCopy;
      }
    });

    it('should call a mixin with multiple parameters', async () => {
      // Create a mixin with multiple parameters: .my-mixin(@color, @size) { color: @color; font-size: @size; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('color', { role: 'property' }),
          any('size', { role: 'property' })
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          decl({ name: 'font-size', value: ref({ key: 'size' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(blue, 16px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue'), any('16px')])
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          color: blue;
          font-size: 16px;
        }
      `);
    });

    it('should call a mixin with @arguments', async () => {
      // Create a mixin that uses @arguments: .my-mixin(@a, @b) { margin: @arguments; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' })
        ]),
        rules: [
          decl({ name: 'margin', value: ref({ key: 'arguments' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(10px, 20px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px')])
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /'arguments' is not defined/);
    });

    it('does not copy childless scalar param values through @arguments children', async () => {
      context.treeContext = new TreeContext({
        file: {
          name: 'test.less',
          path: '/virtual',
          fullPath: '/virtual/test.less'
        }
      });

      const originalCopy = Any.prototype.cloneForPlacement;
      let scalarCopies = 0;
      Any.prototype.cloneForPlacement = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'red') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.args',
            params: list([
              any('color', { role: 'property' }),
              any('size', { role: 'property' })
            ]),
            rules: [
              decl({ name: 'margin', value: ref({ key: 'arguments' }, { type: 'variable' }) })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.args' }, { type: 'mixin' }),
                args: list([any('red'), any('10px')])
              })
            ]
          })
        ]);
        context.root = root;

        const evald = await root.eval(context);
        const css = await evald.render(context);

        expect(css).toContain('margin: red 10px;');
        expect(scalarCopies).toBe(0);
      } finally {
        Any.prototype.cloneForPlacement = originalCopy;
      }
    });

    it('does not copy childless scalar rest param values when resolving rest slots', async () => {
      const originalCopy = Any.prototype.cloneForPlacement;
      let scalarCopies = 0;
      Any.prototype.cloneForPlacement = function copyForCounting(
        this: Any,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        if (this.valueOf() === 'red') {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.resty',
            params: list([
              any('first', { role: 'property' }),
              rest('rest')
            ]),
            rules: [
              decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.resty' }, { type: 'mixin' }),
                args: list([any('0'), any('red'), any('10px')])
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('margin: red 10px;');
        expect(scalarCopies).toBe(0);
      } finally {
        Any.prototype.cloneForPlacement = originalCopy;
      }
    });

    it('keeps default param containers owned without reparenting the source container', async () => {
      const defaultValue = seq([any('red'), any('10px')]);
      const param = vardecl({ name: 'space', value: defaultValue }, { paramVar: true });
      const root = rules([
        mixin({
          name: '.container-default',
          params: list([param]),
          rules: []
        }),
        ruleset({
          selector: el('.use'),
          rules: [
            call({
              name: ref({ key: '.container-default' }, { type: 'mixin' })
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);
      expect(css).toBe('');
      expect(defaultValue.parent).toBe(param);
      expect(param.parent?.parent).toBe(root.rules[0]);
    });

    it('does not clone source-free scalar leaves inside copied positional param containers', async () => {
      const originalClone = Any.prototype.clone;
      let scalarClones = 0;
      Any.prototype.clone = function cloneForCounting(
        this: Any,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.valueOf() === 'red' || this.valueOf() === '10px') {
          scalarClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.container-param',
            params: list([any('space', { role: 'property' })]),
            rules: [
              decl({ name: 'margin', value: ref({ key: 'space' }, { type: 'variable' }) })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.container-param' }, { type: 'mixin' }),
                args: list([seq([any('red'), any('10px')])])
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);

        expect(css).toContain('margin: red 10px;');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('does not clone source-free scalar leaves inside copied named arg containers', async () => {
      const originalClone = Any.prototype.clone;
      let scalarClones = 0;
      Any.prototype.clone = function cloneForCounting(
        this: Any,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.valueOf() === 'red' || this.valueOf() === '10px') {
          scalarClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.container-param',
            params: list([any('space', { role: 'property' })]),
            rules: [
              decl({ name: 'margin', value: ref({ key: 'space' }, { type: 'variable' }) })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.container-param' }, { type: 'mixin' }),
                args: list([
                  vardecl({ name: 'space', value: seq([any('red'), any('10px')]) }, { paramVar: true })
                ])
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('margin: red 10px;');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('does not clone source-free scalar leaves inside copied default param containers', async () => {
      const originalClone = Any.prototype.clone;
      let scalarClones = 0;
      Any.prototype.clone = function cloneForCounting(
        this: Any,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.valueOf() === 'red' || this.valueOf() === '10px') {
          scalarClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.container-default',
            params: list([
              vardecl({ name: 'space', value: seq([any('red'), any('10px')]) }, { paramVar: true })
            ]),
            rules: [
              decl({ name: 'margin', value: ref({ key: 'space' }, { type: 'variable' }) })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.container-default' }, { type: 'mixin' })
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('margin: red 10px;');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('does not clone source-free scalar leaves inside copied rest containers', async () => {
      const originalClone = Any.prototype.clone;
      let scalarClones = 0;
      Any.prototype.clone = function cloneForCounting(
        this: Any,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.valueOf() === 'red' || this.valueOf() === '10px') {
          scalarClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.resty',
            params: list([
              any('first', { role: 'property' }),
              rest('rest')
            ]),
            rules: [
              decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.resty' }, { type: 'mixin' }),
                args: list([any('0'), seq([any('red'), any('10px')])])
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('margin: red 10px;');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('does not clone source-free scalar leaves inside copied @arguments containers', async () => {
      context.treeContext = new TreeContext({
        file: {
          name: 'test.less',
          path: '/virtual',
          fullPath: '/virtual/test.less'
        }
      });
      const originalClone = Any.prototype.clone;
      let scalarClones = 0;
      Any.prototype.clone = function cloneForCounting(
        this: Any,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.valueOf() === 'red' || this.valueOf() === '10px') {
          scalarClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.args',
            params: list([
              any('space', { role: 'property' })
            ]),
            rules: [
              decl({ name: 'margin', value: ref({ key: 'arguments' }, { type: 'variable' }) })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.args' }, { type: 'mixin' }),
                args: list([seq([any('red'), any('10px')])])
              })
            ]
          })
        ]);
        context.root = root;

        const evald = await root.eval(context);
        const css = await evald.render(context);

        expect(css).toContain('margin: red 10px;');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('resolves param/default/rest/@arguments bindings without declaration lookup', async () => {
      context.treeContext = new TreeContext({
        file: {
          name: 'test.less',
          path: '/virtual',
          fullPath: '/virtual/test.less'
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFind = (RulesClass.prototype as any).find;
      const declarationHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).find = function(...args: Parameters<typeof originalFind>) {
        const [type, key] = args;
        if (type === 'declaration' && typeof key === 'string' && ['color', 'size', 'rest', 'arguments'].includes(key)) {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const mixinDef = mixin({
          name: '.my-mixin',
          params: list([
            any('color', { role: 'property' }),
            vardecl({ name: 'size', value: any('16px') }, { paramVar: true }),
            rest('rest')
          ]),
          rules: [
            decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
            decl({ name: 'font-size', value: ref({ key: 'size' }, { type: 'variable' }) }),
            decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) }),
            decl({ name: 'margin', value: ref({ key: 'arguments' }, { type: 'variable' }) })
          ]
        });

        const testRuleset = ruleset({
          selector: el('.test'),
          rules: [
            call({
              name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
              args: list([any('blue'), any('1px'), any('2px'), any('3px')])
            })
          ]
        });

        const root = rules([mixinDef, testRuleset]);
        context.root = root;

        const evald = await root.eval(context);
        const css = await evald.render(context);

        expect(css).toBeString(`
          .test {
            color: blue;
            font-size: 1px;
            padding: 2px 3px;
            margin: blue 1px 2px 3px;
          }
        `);
        expect(declarationHits).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).find = originalFind;
      }
    });

    it('resolves lexical variable bindings from scope frames', async () => {
      context.treeContext = new TreeContext({
        file: {
          name: 'test.less',
          path: '/virtual',
          fullPath: '/virtual/test.less'
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFind = (RulesClass.prototype as any).find;
      const declarationHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).find = function(...args: Parameters<typeof originalFind>) {
        const [type, key] = args;
        if (type === 'declaration' && typeof key === 'string' && key === 'base-color') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        // Lexical global: @base-color defined once at root, referenced inside mixin body
        const mixinDef = mixin({
          name: '.my-mixin',
          rules: [
            decl({ name: 'color', value: ref({ key: 'base-color' }, { type: 'variable' }) }),
            decl({ name: 'border-color', value: ref({ key: 'base-color' }, { type: 'variable' }) }),
            decl({ name: 'outline-color', value: ref({ key: 'base-color' }, { type: 'variable' }) })
          ]
        });

        const root = rules([
          vardecl({ name: 'base-color', value: any('steelblue') }),
          mixinDef,
          ruleset({
            selector: el('.test'),
            rules: [
              call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);

        expect(css).toBeString(`
          .test {
            color: steelblue;
            border-color: steelblue;
            outline-color: steelblue;
          }
        `);
        // Lexical contextual lookups should now resolve from ScopeFrame buckets
        // without touching broad declaration lookup at all.
        expect(declarationHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).find = originalFind;
      }
    });

    it('ScopeFrame declarationBucketsByName preserves declaration order after eval', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const root = rules([
        vardecl({ name: 'brand', value: any('blue') }),
        vardecl({ name: 'size', value: any('16px') }),
        vardecl({ name: 'brand', value: any('navy') })  // shadows first — last wins
      ]);
      context.root = root;

      await root.eval(context);

      // ScopeFrame buckets are populated after eval and preserve source order.
      const frame = root.getScopeFrame();

      // Frame should have both declared names
      expect(frame.declarationBucketsByName.has('brand')).toBe(true);
      expect(frame.declarationBucketsByName.has('size')).toBe(true);

      // Last-definition-wins: 'brand' bucket has two entries; last wins
      const brandBucket = frame.declarationBucketsByName.get('brand')!;
      expect(brandBucket).toHaveLength(2);
      expect(brandBucket[brandBucket.length - 1]!.cell.value!.valueOf()).toBe('navy');

      // resolveFrameCell should return the last declaration in source order.
      const frameResult = resolveFrameCell('brand', frame);
      expect(frameResult).toBeDefined();
      expect(frameResult!.cell.value!.valueOf()).toBe('navy');

      const sizeResult = resolveFrameCell('size', frame);
      expect(sizeResult).toBeDefined();
      expect(sizeResult!.cell.value!.valueOf()).toBe('16px');

      // A name not in the scope resolves to undefined
      expect(resolveFrameCell('unknown', frame)).toBeUndefined();
    });

    it('callable cache fast path: type=mixin static-name lookup', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const mixinDef = mixin({
        name: '.fast-mixin',
        rules: [decl({ name: 'color', value: any('purple') })]
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.a'),
          rules: [call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin' }) })]
        }),
        ruleset({
          selector: el('.b'),
          rules: [call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin' }) })]
        }),
        ruleset({
          selector: el('.c'),
          rules: [call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin' }) })]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);
      expect(css).toBeString(`
        .a {
          color: purple;
        }
        .b {
          color: purple;
        }
        .c {
          color: purple;
        }
      `);
    });

    it('direct callable fast path: one-segment array lookup', () => {
      const mixinDef = mixin({
        name: '.array-mixin',
        rules: [decl({ name: 'color', value: any('purple') })]
      });
      const root = rules([mixinDef]);

      expect(root.findMixin(['.array-mixin'], 'Mixin')).toEqual([mixinDef]);
    });

    it('direct callable fast path: empty array lookup misses', () => {
      const root = rules([
        mixin({
          name: '.array-mixin',
          rules: [decl({ name: 'color', value: any('purple') })]
        })
      ]);

      expect(root.findMixin([], 'Mixin')).toBeUndefined();
    });

    it('ScopeFrame callable buckets: static Mixin hit skips Rules.findMixinsFast', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.frame-mixin') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      let root: RulesClass | undefined;
      try {
        const mixinDef = mixin({
          name: '.frame-mixin',
          rules: [decl({ name: 'color', value: any('rebeccapurple') })]
        });
        root = rules([
          mixinDef,
          ruleset({
            selector: el('.a'),
            rules: [call({ name: ref({ key: '.frame-mixin' }, { type: 'mixin' }) })]
          }),
          ruleset({
            selector: el('.b'),
            rules: [call({ name: ref({ key: '.frame-mixin' }, { type: 'mixin' }) })]
          })
        ]);
        context.root = root;
        root.getScopeFrame();

        expect(root.findMixin('.frame-mixin', 'Mixin')).toEqual([mixinDef]);
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }

      const css = await renderNodeToString(root!, context);
      expect(css).toBeString(`
        .a {
          color: rebeccapurple;
        }
        .b {
          color: rebeccapurple;
        }
      `);
    });

    it('ScopeFrame callable buckets: current frame hit does not prepare parent callable buckets', () => {
      const mixinDef = mixin({
        name: '.child-frame-hit',
        rules: [decl({ name: 'color', value: any('green') })]
      });
      const childRules = rules([mixinDef]);
      const root = rules([
        mixin({
          name: '.parent-other',
          rules: [decl({ name: 'color', value: any('blue') })]
        }),
        childRules
      ]);
      root.getScopeFrame();
      childRules.getScopeFrame();

      expect(childRules.findMixin('.child-frame-hit', 'Mixin')).toEqual([mixinDef]);
      expect(root.callableLookupCache?.has('.child-frame-hit')).not.toBe(true);
    });

    it('ScopeFrame callable buckets: parent miss reaches fallback frame before direct bridge', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.fallback-frame-hit') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const fallbackMixin = mixin({
          name: '.fallback-frame-hit',
          rules: [decl({ name: 'color', value: any('green') })]
        });
        const parentRules = rules([]);
        const fallbackRules = rules([fallbackMixin]);
        const childRules = rules([]);
        const childFrame = childRules.getScopeFrame(parentRules.getScopeFrame());
        childFrame.fallbackFrame = fallbackRules.getScopeFrame();

        expect(childRules.findMixin('.fallback-frame-hit', 'Mixin')).toEqual([fallbackMixin]);
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: unprepared parent retry frame hit stays off direct bridge', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.parent-retry-frame-hit') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const parentMixin = mixin({
          name: '.parent-retry-frame-hit',
          rules: [decl({ name: 'color', value: any('blue') })]
        });
        const parentRules = rules([parentMixin]);
        const childRules = rules([]);
        const parentFrame = parentRules.getScopeFrame();
        childRules.getScopeFrame(parentFrame);
        expect(lookupScopeFrameCallable(parentFrame, '.parent-retry-frame-hit', {
          includeRulesets: false,
          searchParents: false
        })).toEqual({
          kind: 'uncovered',
          reason: 'frame'
        });

        expect(childRules.findMixin('.parent-retry-frame-hit', 'Mixin')).toEqual([parentMixin]);
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: parent and fallback covered miss skips direct bridge', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.fallback-frame-missing') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const parentRules = rules([
          mixin({
            name: '.parent-other',
            rules: [decl({ name: 'color', value: any('blue') })]
          })
        ]);
        const fallbackRules = rules([
          mixin({
            name: '.fallback-other',
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]);
        const childRules = rules([]);
        const childFrame = childRules.getScopeFrame(parentRules.getScopeFrame());
        childFrame.fallbackFrame = fallbackRules.getScopeFrame();

        expect(childRules.findMixin('.fallback-frame-missing', 'Mixin')).toBeUndefined();
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: namespace descendant fallback-frame covered miss skips nested lookup', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const nestedLookups: string[] = [];
      const fastPathHits: string[] = [];

      try {
        const fallbackRules = rules([
          mixin({
            name: '.other-leaf',
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]);
        // The `#namespace` mixin IS the namespace scope identity: it adopts the body
        // array but owns its own scope frame, so the fallback frame (and the nested
        // lookup spy) must target the mixin, not the throwaway body-builder rules.
        const namespaceMixin = mixin({
          name: '#namespace',
          rules: []
        });
        const root = rules([namespaceMixin]);
        const namespaceFrame = namespaceMixin.getScopeFrame(root.getScopeFrame());
        namespaceFrame.fallbackFrame = fallbackRules.getScopeFrame();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
          if (this === namespaceMixin) {
            nestedLookups.push(String(args[0]));
          }
          return originalFindMixin.apply(this, args);
        };
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
          const [key] = args;
          if (key === '.missing-leaf') {
            fastPathHits.push(key);
          }
          return originalFindMixinsFast.apply(this, args);
        };

        expect(root.findMixin(['#namespace', '.missing-leaf'], 'Mixin')).toBeUndefined();
        expect(nestedLookups).toEqual([]);
        expect(fastPathHits).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: namespace descendant fallback-frame hit skips nested lookup', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const nestedLookups: string[] = [];
      const fastPathHits: string[] = [];

      try {
        const fallbackMixin = mixin({
          name: '.fallback-leaf',
          rules: [decl({ name: 'color', value: any('green') })]
        });
        const fallbackRules = rules([fallbackMixin]);
        // The `#namespace` mixin IS the namespace scope identity (see sibling test):
        // attach the fallback frame + nested lookup spy to the mixin, not the body rules.
        const namespaceMixin = mixin({
          name: '#namespace',
          rules: []
        });
        const root = rules([namespaceMixin]);
        const namespaceFrame = namespaceMixin.getScopeFrame(root.getScopeFrame());
        namespaceFrame.fallbackFrame = fallbackRules.getScopeFrame();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
          if (this === namespaceMixin) {
            nestedLookups.push(String(args[0]));
          }
          return originalFindMixin.apply(this, args);
        };
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
          const [key] = args;
          if (key === '.fallback-leaf') {
            fastPathHits.push(key);
          }
          return originalFindMixinsFast.apply(this, args);
        };

        expect(root.findMixin(['#namespace', '.fallback-leaf'], 'Mixin')).toEqual([fallbackMixin]);
        expect(nestedLookups).toEqual([]);
        expect(fastPathHits).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: searchParents false stops retry frames after current candidate', () => {
      const parentMixin = mixin({
        name: '.retry-local-only',
        rules: [decl({ name: 'color', value: any('blue') })]
      });
      const fallbackMixin = mixin({
        name: '.retry-local-only',
        rules: [decl({ name: 'color', value: any('green') })]
      });
      const parentRules = rules([parentMixin]);
      const fallbackRules = rules([fallbackMixin]);
      const childRules = rules([
        ruleset({
          selector: compound([el('.retry-local-only'), el('.candidate')]),
          rules: [decl({ name: 'color', value: any('red') })]
        })
      ]);
      const childFrame = childRules.getScopeFrame(parentRules.getScopeFrame());
      childFrame.fallbackFrame = fallbackRules.getScopeFrame();

      expect(childRules.findMixin('.retry-local-only', undefined, { searchParents: false })).toBeUndefined();
      expect(lookupScopeFrameCallable(childRules._scopeFrame, '.retry-local-only', {
        includeRulesets: true,
        searchParents: false
      })).toEqual({
        kind: 'uncovered',
        reason: 'candidate'
      });
    });

    it('ScopeFrame callable buckets: uncovered fallback reference-import miss skips empty direct bridge', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      const parentRules = rules([]);
      const fallbackRules = rules([
        style({
          path: quoted(any('reference-import.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ]);
      const childRules = rules([]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.fallback-reference-missing') {
          fastPathHits.push(`${this === fallbackRules ? 'fallback' : 'other'}:${key}`);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      try {
        const childFrame = childRules.getScopeFrame(parentRules.getScopeFrame());
        childFrame.fallbackFrame = fallbackRules.getScopeFrame();

        expect(childRules.findMixin('.fallback-reference-missing', 'Mixin')).toBeUndefined();
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: static Ruleset-as-mixin hit skips Rules.findMixinsFast', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.frame-ruleset') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      let root: RulesClass | undefined;
      try {
        const frameRuleset = ruleset({
          selector: el('.frame-ruleset'),
          rules: [decl({ name: 'color', value: any('teal') })]
        });
        root = rules([
          frameRuleset,
          ruleset({
            selector: el('.a'),
            rules: [call({ name: ref({ key: '.frame-ruleset' }, { type: 'mixin-ruleset' }) })]
          })
        ]);
        context.root = root;
        root.getScopeFrame();

        expect(root.findMixin('.frame-ruleset', undefined)).toEqual([frameRuleset]);
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }

      const css = await renderNodeToString(root!, context);
      expect(css).toBeString(`
        .frame-ruleset {
          color: teal;
        }
        .a {
          color: teal;
        }
      `);
    });

    it('ScopeFrame callable buckets: static miss skips Rules.findMixinsFast when no child surfaces exist', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      let rediscoveredChildSurface = false;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.frame-missing') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.other-frame-mixin',
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]);
        root.getScopeFrame();
        Object.defineProperty(root, 'hasDirectLookupChildSurface', {
          configurable: true,
          value() {
            rediscoveredChildSurface = true;
            return false;
          }
        });

        expect(root.findMixin('.frame-missing', 'Mixin')).toBeUndefined();
        expect(rediscoveredChildSurface).toBe(false);
        expect(fastPathHits).toHaveLength(0);
        expect(root.callableLookupCache?.get('.frame-missing')).toBeNull();
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: namespace miss skips Rules.findMixinsFast when frame miss is covered', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '#missing-namespace') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '#other-namespace',
            rules: [
              mixin({
                name: '.leaf',
                rules: [decl({ name: 'color', value: any('green') })]
              })
            ]
          })
        ]);
        root.getScopeFrame();

        expect(root.findMixin(['#missing-namespace', '.leaf'], 'Mixin')).toBeUndefined();
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: ruleset namespace miss skips mixin ambiguity crawl when frame miss is covered', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '#missing-ruleset-namespace') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const root = rules([
          ruleset({
            selector: el('#other-ruleset-namespace'),
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]);
        root.getScopeFrame();

        expect(root.findMixin(['#missing-ruleset-namespace', '.leaf'], undefined)).toBeUndefined();
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: guarded namespace mixin start skips direct crawl when frame hit is covered', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '#guarded-frame-namespace') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const leaf = mixin({
          name: '.leaf',
          rules: [decl({ name: 'color', value: any('green') })]
        });
        const namespace = mixin({
          name: '#guarded-frame-namespace',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          guard: bool(true) as unknown as Condition,
          rules: [leaf]
        });
        const root = rules([namespace]);
        root.getScopeFrame();

        expect(root.findMixin(['#guarded-frame-namespace', '.leaf'], undefined)).toEqual([leaf]);
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: recursive namespace miss skips child direct crawl when child frame miss is covered', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '#missing-child-namespace') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const childRules = rules([
          mixin({
            name: '#other-child-namespace',
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]);
        // New model (Mixin.sourceNode wrapper eliminated): the `rules([...])`
        // passed as `rules:` is discarded — the parent Mixin owns the body
        // directly, so the body scope frame is the Mixin's own, not the
        // discarded `childRules` wrapper's.
        const parentMixin = mixin({
          name: '#parent-namespace',
          rules: childRules.rules
        });
        const root = rules([parentMixin]);
        root.getScopeFrame();
        parentMixin.getScopeFrame();

        expect(root.findMixin(['#parent-namespace', '#missing-child-namespace', '.leaf'], 'Mixin')).toBeUndefined();
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: recursive namespace miss skips child findMixin when first remainder miss is covered', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      let childFindMixinCount = 0;
      let childRules: RulesClass;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this === childRules) {
          childFindMixinCount++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        childRules = rules([
          mixin({
            name: '#other-child-namespace',
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]);
        const root = rules([
          mixin({
            name: '#parent-namespace',
            rules: childRules.rules
          })
        ]);
        root.getScopeFrame();
        childRules.getScopeFrame();

        expect(root.findMixin(['#parent-namespace', '#missing-child-namespace', '.leaf'], undefined)).toBeUndefined();
        expect(childFindMixinCount).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('ScopeFrame callable buckets: callable namespace child-surface covered miss skips nested findMixin', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      let namespaceRulesFindMixinCount = 0;
      let namespaceRules: RulesClass;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this === namespaceRules) {
          namespaceRulesFindMixinCount++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        const childSurface = rules([
          mixin({
            name: '.other-child-mixin',
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]);
        namespaceRules = rules([childSurface]);
        const root = rules([
          mixin({
            name: '#parent-namespace',
            rules: namespaceRules.rules
          })
        ]);
        root.getScopeFrame();
        namespaceRules.getScopeFrame();
        childSurface.getScopeFrame();

        expect(root.findMixin(['#parent-namespace', '.missing-child-mixin'], undefined)).toBeUndefined();
        expect(namespaceRulesFindMixinCount).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('ScopeFrame callable buckets: callable namespace reference-import modeled miss skips nested findMixin', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const missingKey = '.missing-reference-child';
      let namespaceRulesFindMixinCount = 0;
      const broadFastHits: string[] = [];
      let namespaceRules: RulesClass;
      let root: RulesClass;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this === namespaceRules) {
          namespaceRulesFindMixinCount++;
        }
        return originalFindMixin.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if ((this === namespaceRules || this === root) && key === missingKey) {
          broadFastHits.push(this === namespaceRules ? 'namespace' : 'root');
        }
        return originalFindMixinsFast.apply(this, args);
      };

      const referenceChild = rules([
        style({
          path: quoted(any('reference-import.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ]);
      namespaceRules = rules([referenceChild]);
      root = rules([
        mixin({
          name: '#parent-namespace',
          rules: namespaceRules.rules
        })
      ]);

      try {
        root.getScopeFrame();
        namespaceRules.getScopeFrame();
        referenceChild.getScopeFrame();
        namespaceRules.collectDirectChildRulesEntries();
        expect(namespaceRules.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true
        });

        expect(root.findMixin(['#parent-namespace', missingKey], undefined)).toBeUndefined();
        expect(namespaceRulesFindMixinCount).toBe(0);
        expect(broadFastHits).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: callable namespace reference-import modeled hit skips nested findMixin', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const leaf = mixin({
        name: '.reference-leaf',
        rules: [decl({ name: 'color', value: any('green') })]
      });
      const referenceChild = rules([leaf], { referenceMode: true });
      let namespaceRules: RulesClass;
      let root: RulesClass;
      const broadFastHits: string[] = [];
      let namespaceRulesFindMixinCount = 0;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this === namespaceRules) {
          namespaceRulesFindMixinCount++;
        }
        return originalFindMixin.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if ((this === namespaceRules || this === root) && key === '.reference-leaf') {
          broadFastHits.push(this === namespaceRules ? 'namespace' : 'root');
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        namespaceRules = rules([referenceChild]);
        root = rules([
          mixin({
            name: '#parent-namespace',
            rules: namespaceRules.rules
          })
        ]);
        root.getScopeFrame();
        namespaceRules.getScopeFrame();
        referenceChild.getScopeFrame();
        namespaceRules.collectDirectChildRulesEntries();
        expect(namespaceRules.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true
        });

        expect(root.findMixin(['#parent-namespace', '.reference-leaf'], undefined)).toEqual([leaf]);
        expect(namespaceRulesFindMixinCount).toBe(0);
        expect(broadFastHits).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: callable namespace reference-import offset path skips broad start crawl', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const leaf = mixin({
        name: '.leaf',
        rules: [decl({ name: 'color', value: any('green') })]
      });
      const referenceChild = rules([
        mixin({
          name: '#imported',
          rules: [leaf]
        })
      ], { referenceMode: true });
      let namespaceRules: RulesClass;
      let root: RulesClass;
      const broadFastHits: string[] = [];
      let nestedArrayFallbacks = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if ((this === namespaceRules || this === root) && key === '#imported') {
          broadFastHits.push(this === namespaceRules ? 'namespace' : 'root');
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        namespaceRules = rules([referenceChild]);
        root = rules([
          mixin({
            name: '#parent-namespace',
            rules: namespaceRules.rules
          })
        ]);
        root.getScopeFrame();
        namespaceRules.getScopeFrame();
        referenceChild.getScopeFrame();
        namespaceRules.collectDirectChildRulesEntries();
        expect(namespaceRules.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactMixinSurface: true
        });

        expect(root.findMixin(['#parent-namespace', '#imported', '.leaf'], undefined)).toEqual([leaf]);
        expect(broadFastHits).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: recursive namespace hit reaches fallback frame before child direct crawl', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '#fallback-child-namespace') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const leaf = mixin({
          name: '.leaf',
          rules: [decl({ name: 'color', value: any('green') })]
        });
        const fallbackChildNamespace = mixin({
          name: '#fallback-child-namespace',
          rules: [leaf]
        });
        const fallbackRules = rules([fallbackChildNamespace]);
        // New model: the parent Mixin owns its (empty) body directly; the body scope
        // frame is the Mixin's own, not the discarded `childRules` wrapper's.
        const parentMixin = mixin({
          name: '#parent-with-fallback-namespace',
          rules: []
        });
        const root = rules([parentMixin]);
        root.getScopeFrame();
        parentMixin.getScopeFrame().fallbackFrame = fallbackRules.getScopeFrame();

        expect(root.findMixin([
          '#parent-with-fallback-namespace',
          '#fallback-child-namespace',
          '.leaf'
        ], 'Mixin')).toEqual([leaf]);
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: recursive namespace fallback covered miss skips direct bridge', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '#fallback-missing-namespace') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const fallbackRules = rules([
          mixin({
            name: '#fallback-other-namespace',
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]);
        const childRules = rules([]);
        // New model: the parent Mixin owns its (empty) body directly; the body
        // scope frame is the Mixin's own, not the discarded `childRules` wrapper's.
        const parentMixin = mixin({
          name: '#parent-with-covered-fallback',
          rules: childRules.rules
        });
        const root = rules([parentMixin]);
        root.getScopeFrame();
        parentMixin.getScopeFrame().fallbackFrame = fallbackRules.getScopeFrame();

        expect(root.findMixin([
          '#parent-with-covered-fallback',
          '#fallback-missing-namespace',
          '.leaf'
        ], 'Mixin')).toBeUndefined();
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: fallback namespace reference-import offset hit skips broad start crawl', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const leaf = mixin({
        name: '.leaf',
        rules: [decl({ name: 'color', value: any('green') })]
      });
      const referenceChild = rules([
        mixin({
          name: '#imported',
          rules: [leaf]
        })
      ], { referenceMode: true });
      const fallbackRules = rules([referenceChild]);
      // New model: the parent Mixin owns its (empty) body directly; attach the fallback
      // to the Mixin's own scope frame, not the discarded `childRules` wrapper's.
      const parentMixin = mixin({
        name: '#parent-with-fallback-import',
        rules: []
      });
      const root = rules([parentMixin]);
      const broadFastHits: string[] = [];
      let nestedArrayFallbacks = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if ((this === fallbackRules || this === root) && key === '#imported') {
          broadFastHits.push(this === fallbackRules ? 'fallback' : 'root');
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        parentMixin.getScopeFrame().fallbackFrame = fallbackRules.getScopeFrame();
        referenceChild.getScopeFrame();
        fallbackRules.collectDirectChildRulesEntries();
        expect(fallbackRules.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactMixinSurface: true
        });

        expect(root.findMixin([
          '#parent-with-fallback-import',
          '#imported',
          '.leaf'
        ], 'Mixin')).toEqual([leaf]);
        expect(broadFastHits).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: fallback namespace reference-import offset miss skips broad start crawl', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const referenceChild = rules([
        mixin({
          name: '#imported',
          rules: [
            mixin({
              name: '.other-leaf',
              rules: [decl({ name: 'color', value: any('green') })]
            })
          ]
        })
      ], { referenceMode: true });
      const fallbackRules = rules([referenceChild]);
      // New model: the parent Mixin owns its (empty) body directly; attach the fallback
      // to the Mixin's own scope frame, not the discarded `childRules` wrapper's.
      const parentMixin = mixin({
        name: '#parent-with-fallback-import',
        rules: []
      });
      const root = rules([parentMixin]);
      const broadFastHits: string[] = [];
      let nestedArrayFallbacks = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if ((this === fallbackRules || this === root) && key === '#imported') {
          broadFastHits.push(this === fallbackRules ? 'fallback' : 'root');
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        parentMixin.getScopeFrame().fallbackFrame = fallbackRules.getScopeFrame();
        referenceChild.getScopeFrame();
        fallbackRules.collectDirectChildRulesEntries();
        expect(fallbackRules.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactMixinSurface: true
        });

        expect(root.findMixin([
          '#parent-with-fallback-import',
          '#imported',
          '.missing-leaf'
        ], 'Mixin')).toBeUndefined();
        expect(broadFastHits).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: fallback ruleset namespace reference-import offset hit skips broad start crawl', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const leaf = mixin({
        name: '.leaf',
        rules: [decl({ name: 'color', value: any('green') })]
      });
      const referenceChild = rules([
        ruleset({
          selector: el('#imported'),
          rules: [leaf]
        })
      ], { referenceMode: true });
      const fallbackRules = rules([referenceChild]);
      const childRules = rules([]);
      const root = rules([
        mixin({
          name: '#parent-with-fallback-ruleset-import',
          rules: childRules.rules
        })
      ]);
      const broadFastHits: string[] = [];
      let nestedArrayFallbacks = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if ((this === fallbackRules || this === root) && key === '#imported') {
          broadFastHits.push(this === fallbackRules ? 'fallback' : 'root');
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        // New model: fallback attaches to the parent Mixin's own frame (it owns the body).
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (root.rules[0] as RulesClass).getScopeFrame().fallbackFrame = fallbackRules.getScopeFrame();
        referenceChild.getScopeFrame();
        fallbackRules.collectDirectChildRulesEntries();
        expect(fallbackRules.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactRulesetSurface: true
        });

        expect(root.findMixin([
          '#parent-with-fallback-ruleset-import',
          '#imported',
          '.leaf'
        ], undefined)).toEqual([leaf]);
        expect(broadFastHits).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: fallback ruleset namespace reference-import offset miss skips broad start crawl', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const referenceChild = rules([
        ruleset({
          selector: el('#imported'),
          rules: [
            mixin({
              name: '.other-leaf',
              rules: [decl({ name: 'color', value: any('green') })]
            })
          ]
        })
      ], { referenceMode: true });
      const fallbackRules = rules([referenceChild]);
      const childRules = rules([]);
      const root = rules([
        mixin({
          name: '#parent-with-fallback-ruleset-import',
          rules: childRules.rules
        })
      ]);
      const broadFastHits: string[] = [];
      let nestedArrayFallbacks = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if ((this === fallbackRules || this === root) && key === '#imported') {
          broadFastHits.push(this === fallbackRules ? 'fallback' : 'root');
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        // New model: fallback attaches to the parent Mixin's own frame (it owns the body).
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (root.rules[0] as RulesClass).getScopeFrame().fallbackFrame = fallbackRules.getScopeFrame();
        referenceChild.getScopeFrame();
        fallbackRules.collectDirectChildRulesEntries();
        expect(fallbackRules.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactRulesetSurface: true
        });

        expect(root.findMixin([
          '#parent-with-fallback-ruleset-import',
          '#imported',
          '.missing-leaf'
        ], undefined)).toBeUndefined();
        expect(broadFastHits).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: fallback mixin namespace terminal filters fallback ruleset namespace prefixes', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const mixinLeaf = mixin({
        name: '.leaf',
        rules: [decl({ name: 'color', value: any('mixin') })]
      });
      const rulesetLeaf = ruleset({
        selector: el('.leaf'),
        rules: [decl({ name: 'color', value: any('ruleset') })]
      });
      const referenceChild = rules([
        ruleset({
          selector: el('#imported'),
          rules: [rulesetLeaf]
        }),
        mixin({
          name: '#imported',
          rules: [mixinLeaf]
        })
      ], { referenceMode: true });
      const fallbackRules = rules([referenceChild]);
      const childRules = rules([]);
      const root = rules([
        mixin({
          name: '#parent-with-fallback-ambiguous-import',
          rules: childRules.rules
        })
      ]);
      const broadFastHits: string[] = [];
      let nestedArrayFallbacks = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if ((this === fallbackRules || this === root) && key === '#imported') {
          broadFastHits.push(this === fallbackRules ? 'fallback' : 'root');
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        // New model: fallback attaches to the parent Mixin's own frame (it owns the body).
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (root.rules[0] as RulesClass).getScopeFrame().fallbackFrame = fallbackRules.getScopeFrame();
        referenceChild.getScopeFrame();
        fallbackRules.collectDirectChildRulesEntries();
        expect(fallbackRules.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactMixinSurface: true,
          hasExactRulesetSurface: true
        });

        const allTerminals = root.findMixin([
          '#parent-with-fallback-ambiguous-import',
          '#imported',
          '.leaf'
        ], undefined);
        expect(allTerminals).toContain(mixinLeaf);
        expect(allTerminals).toContain(rulesetLeaf);
        expect(root.findMixin([
          '#parent-with-fallback-ambiguous-import',
          '#imported',
          '.leaf'
        ], undefined, {
          terminalMixinOnly: true
        })).toEqual([mixinLeaf]);
        expect(broadFastHits).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: static miss coverage stays false for reference imports', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.reference-import-missing') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const root = rules([
          style({
            path: quoted(any('reference-import.jess'))
          }, {
            type: 'import',
            importOptions: { reference: true }
          })
        ]);
        root.getScopeFrame();

        expect(root.findMixin('.reference-import-missing', 'Mixin')).toBeUndefined();
        const frameHit = lookupScopeFrameCallable(root._scopeFrame, '.reference-import-missing', {
          includeRulesets: false,
          searchParents: false
        });
        expect(frameHit).toEqual({
          kind: 'uncovered',
          reason: 'reference-import'
        });
        expect(root._scopeFrame?.mixinCallableMissesCovered).toBe(false);
        expect(root._scopeFrame?.mixinCallableMissCoverageKnown).toBe(true);
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: uncovered reference imports do not reopen covered sibling child surfaces', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const missingKey = '.mixed-reference-missing';
      const broadParentCrawls: string[] = [];
      const coveredChild = rules([
        mixin({
          name: '.covered-sibling',
          rules: [decl({ name: 'color', value: any('green') })]
        })
      ]);
      const referenceChild = rules([
        style({
          path: quoted(any('reference-import.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ]);
      const root = rules([coveredChild, referenceChild]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: any[]) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const [key, options] = args as [string, { skipCurrentSurface?: boolean } | undefined];
        if (this === root && key === missingKey && options?.skipCurrentSurface === true) {
          broadParentCrawls.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      root.getScopeFrame();
      coveredChild.getScopeFrame();
      expect(coveredChild.findMixin(missingKey, 'Mixin', { searchParents: false })).toBeUndefined();

      try {
        expect(root.findMixin(missingKey, 'Mixin')).toBeUndefined();
        expect(broadParentCrawls).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: reference-import namespace start miss skips broad array fallback', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const namespaceKey = '#missing-imported-namespace';
      const rootBroadStarts: string[] = [];
      let nestedArrayFallbacks = 0;
      const referenceChild = rules([
        style({
          path: quoted(any('reference-import.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ]);
      const root = rules([referenceChild]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && key === namespaceKey) {
          rootBroadStarts.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        root.getScopeFrame();
        referenceChild.getScopeFrame();
        root.collectDirectChildRulesEntries();
        expect(root.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactCallableSurface: false
        });

        expect(root.findMixin([namespaceKey, '.leaf'], undefined)).toBeUndefined();
        expect(rootBroadStarts).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('ScopeFrame callable buckets: reference-import compound prefix hit skips generated array fallback', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const importedLeaf = mixin({
        name: '.leaf',
        rules: [decl({ name: 'color', value: any('green') })]
      });
      const referenceChild = rules([
        ruleset({
          selector: compound([el('#imported'), el('.branch')]),
          rules: [importedLeaf]
        })
      ], { referenceMode: true });
      const root = rules([referenceChild]);
      const broadFastStarts: string[] = [];
      let nestedArrayFallbacks = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && key === '#imported') {
          broadFastStarts.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        root.getScopeFrame();
        referenceChild.getScopeFrame();
        root.collectDirectChildRulesEntries();
        expect(root.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactRulesetSurface: true
        });

        expect(root.findMixin(['#imported', '.branch', '.leaf'], undefined, {
          searchParents: false
        })).toEqual([importedLeaf]);
        expect(broadFastStarts).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('ScopeFrame callable buckets: reference-import compound prefix miss skips generated array fallback', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const referenceChild = rules([
        ruleset({
          selector: compound([el('#imported'), el('.branch')]),
          rules: [
            mixin({
              name: '.other-leaf',
              rules: [decl({ name: 'color', value: any('green') })]
            })
          ]
        })
      ], { referenceMode: true });
      const root = rules([referenceChild]);
      const broadFastStarts: string[] = [];
      let nestedArrayFallbacks = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && key === '#imported') {
          broadFastStarts.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        root.getScopeFrame();
        referenceChild.getScopeFrame();
        root.collectDirectChildRulesEntries();
        expect(root.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactRulesetSurface: true
        });

        expect(root.findMixin(['#imported', '.branch', '.missing-leaf'], undefined, {
          searchParents: false
        })).toBeUndefined();
        expect(broadFastStarts).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('ScopeFrame callable buckets: reference-import selector-list prefix hit skips generated array fallback', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const importedLeaf = mixin({
        name: '.leaf',
        rules: [decl({ name: 'color', value: any('green') })]
      });
      const referenceChild = rules([
        ruleset({
          selector: sellist([
            compound([el('#imported'), el('.branch')]),
            compound([el('#other'), el('.branch')])
          ]),
          rules: [importedLeaf]
        })
      ], { referenceMode: true });
      const root = rules([referenceChild]);
      const broadFastStarts: string[] = [];
      let nestedArrayFallbacks = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && key === '#imported') {
          broadFastStarts.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        root.getScopeFrame();
        referenceChild.getScopeFrame();
        root.collectDirectChildRulesEntries();
        expect(root.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactRulesetSurface: true
        });

        expect(root.findMixin(['#imported', '.branch', '.leaf'], undefined, {
          searchParents: false
        })).toEqual([importedLeaf]);
        expect(broadFastStarts).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('ScopeFrame callable buckets: reference-import selector-list prefix miss skips generated array fallback', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const referenceChild = rules([
        ruleset({
          selector: sellist([
            compound([el('#imported'), el('.branch')]),
            compound([el('#other'), el('.branch')])
          ]),
          rules: [
            mixin({
              name: '.other-leaf',
              rules: [decl({ name: 'color', value: any('green') })]
            })
          ]
        })
      ], { referenceMode: true });
      const root = rules([referenceChild]);
      const broadFastStarts: string[] = [];
      let nestedArrayFallbacks = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && key === '#imported') {
          broadFastStarts.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayFallbacks++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        root.getScopeFrame();
        referenceChild.getScopeFrame();
        root.collectDirectChildRulesEntries();
        expect(root.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactRulesetSurface: true
        });

        expect(root.findMixin(['#imported', '.branch', '.missing-leaf'], undefined, {
          searchParents: false
        })).toBeUndefined();
        expect(broadFastStarts).toEqual([]);
        expect(nestedArrayFallbacks).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('ScopeFrame callable buckets: selector-list prefix hit and miss avoid recursive prefix crawl when frames cover rulesets', () => {
      const importedLeaf = mixin({
        name: '.leaf',
        rules: [decl({ name: 'color', value: any('green') })]
      });
      const referenceChild = rules([
        ruleset({
          selector: sellist([
            compound([el('#imported'), el('.branch')]),
            compound([el('#other'), el('.branch')])
          ]),
          rules: [importedLeaf]
        })
      ], { referenceMode: true });
      const root = rules([referenceChild]);

      const proto = Object.getPrototypeOf(root) as any;
      const originalPrefixSearch = proto.findVisibleCallableRulesetPrefixMatches;
      let recursivePrefixCrawls = 0;

      proto.findVisibleCallableRulesetPrefixMatches = function(path: string[], options: unknown) {
        recursivePrefixCrawls++;
        return originalPrefixSearch.call(this, path, options);
      };

      try {
        root.getScopeFrame();
        referenceChild.getScopeFrame();
        root.collectDirectChildRulesEntries();
        expect(root.findMixin(['#imported', '.branch', '.leaf'], undefined, {
          searchParents: false
        })).toEqual([importedLeaf]);
        expect(root.findMixin(['#imported', '.branch', '.missing'], undefined, {
          searchParents: false
        })).toBeUndefined();
        expect(recursivePrefixCrawls).toBe(0);
      } finally {
        proto.findVisibleCallableRulesetPrefixMatches = originalPrefixSearch;
      }
    });

    it('ScopeFrame callable buckets: local namespace-start misses do not reopen broad direct crawl', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const localChild = rules([
        mixin({
          name: '#local',
          rules: [
            mixin({
              name: '.leaf',
              rules: [decl({ name: 'color', value: any('red') })]
            })
          ]
        })
      ], { local: true });
      const root = rules([localChild]);
      const broadFastStarts: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && (key === '#local' || key === '.leaf')) {
          broadFastStarts.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        localChild.getScopeFrame();
        root.collectDirectChildRulesEntries();

        expect(root.findMixin(['#local', '.leaf'], undefined, {
          local: true,
          searchParents: false
        })).toBeUndefined();
        expect(broadFastStarts).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: local namespace-start hits stay on narrow child frames', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const leaf = mixin({
        name: '.leaf',
        rules: [decl({ name: 'color', value: any('blue') })]
      });
      const child = rules([
        mixin({
          name: '#visible',
          rules: [leaf]
        })
      ]);
      const root = rules([child]);
      const broadFastStarts: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && (key === '#visible' || key === '.leaf')) {
          broadFastStarts.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        child.getScopeFrame();
        root.collectDirectChildRulesEntries();

        expect(root.findMixin(['#visible', '.leaf'], undefined, {
          local: true,
          searchParents: false
        })).toEqual([leaf]);
        expect(broadFastStarts).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: restricted namespace-start misses stay covered without target', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const source = rules([
        mixin({
          name: '#target',
          rules: [
            mixin({
              name: '.leaf',
              rules: [decl({ name: 'color', value: any('red') })]
            })
          ]
        })
      ]);
      const output = rules([
        mixin({
          name: '#target',
          rules: [
            mixin({
              name: '.leaf',
              rules: [decl({ name: 'color', value: any('red') })]
            })
          ]
        })
      ]);
      attachMixinOutputSlot(output, source, true);
      const root = rules([output]);
      const broadFastStarts: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && (key === '#target' || key === '.leaf')) {
          broadFastStarts.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        output.getScopeFrame();
        root.collectDirectChildRulesEntries();

        expect(root.findMixin(['#target', '.leaf'], undefined, {
          searchParents: false
        })).toBeUndefined();
        expect(broadFastStarts).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: targeted namespace-start hits stay on narrow child frames', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const sourceLeaf = mixin({
        name: '.leaf',
        rules: [decl({ name: 'color', value: any('source') })]
      });
      const outputLeaf = mixin({
        name: '.leaf',
        rules: [decl({ name: 'color', value: any('blue') })]
      });
      const source = rules([
        mixin({
          name: '#target',
          rules: [sourceLeaf]
        })
      ]);
      const output = rules([
        mixin({
          name: '#target',
          rules: [outputLeaf]
        })
      ]);
      attachMixinOutputSlot(output, source, true);
      const root = rules([output]);
      const broadFastStarts: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && (key === '#target' || key === '.leaf')) {
          broadFastStarts.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        output.getScopeFrame();
        root.collectDirectChildRulesEntries();

        expect(root.findMixin(['#target', '.leaf'], undefined, {
          hasTarget: true,
          searchParents: false
        })).toEqual([outputLeaf]);
        expect(broadFastStarts).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: static miss skips Rules.findMixinsFast when child frames cover exact misses', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.frame-child-missing') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const root = rules([
          rules([
            mixin({
              name: '.child-frame-mixin',
              rules: [decl({ name: 'color', value: any('green') })]
            })
          ])
        ]);
        root.getScopeFrame();

        expect(root.findMixin('.frame-child-missing', 'Mixin')).toBeUndefined();
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: uncovered child miss respects searchParents false after narrow bridge', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const parentRetryHits: string[] = [];
      const missingKey = '.parent-only-after-child-miss';
      const parentMixin = mixin({
        name: missingKey,
        rules: [decl({ name: 'color', value: any('red') })]
      });
      const childSurface = rules([
        mixin({
          name: '.child-other',
          rules: [decl({ name: 'color', value: any('green') })]
        })
      ]);
      const childRules = rules([childSurface]);
      const root = rules([parentMixin, childRules]);
      root.getScopeFrame();
      childRules.getScopeFrame(root._scopeFrame);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && key === missingKey) {
          parentRetryHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        expect(childRules.findMixin(missingKey, 'Mixin', { searchParents: false })).toBeUndefined();
        expect(parentRetryHits).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: static miss skips Rules.findMixinsFast when child surfaces cannot contain exact callables', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.frame-child-declaration-missing') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const root = rules([
          rules([
            decl({ name: 'color', value: any('green') })
          ])
        ]);
        root.getScopeFrame();
        root.collectDirectChildRulesEntries();
        expect(root.directChildRuleEntries).toBeNull();

        expect(root.findMixin('.frame-child-declaration-missing', 'Mixin')).toBeUndefined();
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: prepared child entries stop recursive surface rediscovery', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const childRules = rules([
        decl({ name: 'color', value: any('green') })
      ]);
      const root = rules([childRules]);
      root.collectDirectChildRulesEntries();
      expect(root.directChildRuleEntries).toBeNull();
      root.getScopeFrame();

      const originalValue = childRules.rules;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.prepared-child-missing') {
          return [];
        }
        return originalFindMixinsFast.apply(this, args);
      };
      Object.defineProperty(childRules, 'rules', {
        configurable: true,
        get() {
          throw new Error('prepared callable child entries should prevent recursive rediscovery');
        }
      });

      try {
        expect(root.findMixin('.prepared-child-missing', 'Mixin')).toBeUndefined();
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
        Object.defineProperty(childRules, 'rules', {
          configurable: true,
          writable: true,
          value: originalValue
        });
      }
    });

    it('ScopeFrame callable buckets: child reference imports are carried apart from exact callable surfaces', () => {
      const childRules = rules([
        style({
          path: quoted(any('reference-import.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ]);
      const root = rules([childRules]);

      root.collectDirectChildRulesEntries();
      expect(root.hasReferenceImportChildSurface).toBe(true);
      expect(root.directChildRuleEntries).toHaveLength(1);
      expect(root.directChildRuleEntries?.[0]).toMatchObject({
        node: childRules,
        hasReferenceImportSurface: true,
        hasExactCallableSurface: false,
        hasExactMixinSurface: false,
        hasExactRulesetSurface: false
      });

      root.getScopeFrame();
      expect(root._scopeFrame?.callableMissesCovered).toBe(false);
      expect(root._scopeFrame?.mixinCallableMissesCovered).toBe(false);
    });

    it('ScopeFrame callable buckets: late exact callable children update prepared aggregate facts', () => {
      const root = rules([]);
      root.collectDirectChildRulesEntries();
      expect(root.directChildRuleEntries).toBeNull();
      root.getScopeFrame();
      expect(root._scopeFrame?.callableMissesCovered).toBe(true);
      expect(root._scopeFrame?.callableMissCoverageKnown).toBe(true);

      const childRules = rules([
        mixin({
          name: '.late-child-mixin',
          rules: [decl({ name: 'color', value: any('green') })]
        })
      ]);
      root.push(childRules);

      expect(root.directChildRuleEntries).toHaveLength(1);
      expect(root.directChildRuleEntries?.[0]).toMatchObject({
        node: childRules,
        hasExactCallableSurface: true,
        hasExactMixinSurface: true,
        hasExactRulesetSurface: false
      });
      expect(root.hasExactCallableChildSurface).toBe(true);
      expect(root.hasExactMixinChildSurface).toBe(true);
      expect(root._scopeFrame?.callableMissesCovered).toBe(false);
      expect(root._scopeFrame?.callableMissCoverageKnown).toBe(false);
    });

    it('ScopeFrame callable buckets: late reference-import children update prepared aggregate facts', () => {
      const root = rules([]);
      root.collectDirectChildRulesEntries();
      expect(root.directChildRuleEntries).toBeNull();
      root.getScopeFrame();
      expect(root._scopeFrame?.callableMissesCovered).toBe(true);
      expect(root._scopeFrame?.callableMissCoverageKnown).toBe(true);

      const childRules = rules([
        style({
          path: quoted(any('late-reference-import.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ]);
      root.push(childRules);

      expect(root.directChildRuleEntries).toHaveLength(1);
      expect(root.directChildRuleEntries?.[0]).toMatchObject({
        node: childRules,
        hasReferenceImportSurface: true,
        hasExactCallableSurface: false,
        hasExactMixinSurface: false,
        hasExactRulesetSurface: false
      });
      expect(root.hasReferenceImportChildSurface).toBe(true);
      expect(root._scopeFrame?.callableMissesCovered).toBe(false);
      expect(root._scopeFrame?.callableMissCoverageKnown).toBe(false);
    });

    it('ScopeFrame callable buckets: initial and late child aggregate facts stay in parity', () => {
      const makeChildCases = () => [
        {
          label: 'mixin',
          child: rules([
            mixin({
              name: '.child-mixin',
              rules: [decl({ name: 'color', value: any('green') })]
            })
          ])
        },
        {
          label: 'ruleset',
          child: rules([
            ruleset({
              selector: el('.child-ruleset'),
              rules: [decl({ name: 'color', value: any('blue') })]
            })
          ])
        },
        {
          label: 'mixed-callable',
          child: rules([
            mixin({
              name: '.mixed-mixin',
              rules: [decl({ name: 'color', value: any('green') })]
            }),
            ruleset({
              selector: el('.mixed-ruleset'),
              rules: [decl({ name: 'color', value: any('blue') })]
            })
          ])
        },
        {
          label: 'reference-import',
          child: rules([
            style({
              path: quoted(any('reference-import.less'))
            }, {
              type: 'import',
              importOptions: { reference: true }
            })
          ])
        },
        {
          label: 'empty',
          child: rules([])
        }
      ];
      const snapshot = (root: RulesClass) => {
        root.collectDirectChildRulesEntries();
        return {
          hasReferenceImportChildSurface: root.hasReferenceImportChildSurface,
          hasExactCallableChildSurface: root.hasExactCallableChildSurface,
          hasExactMixinChildSurface: root.hasExactMixinChildSurface,
          hasExactRulesetChildSurface: root.hasExactRulesetChildSurface,
          entries: root.directChildRuleEntries?.map(entry => ({
            hasReferenceImportSurface: entry.hasReferenceImportSurface,
            hasExactCallableSurface: entry.hasExactCallableSurface,
            hasExactMixinSurface: entry.hasExactMixinSurface,
            hasExactRulesetSurface: entry.hasExactRulesetSurface
          })) ?? null
        };
      };

      for (const { label, child } of makeChildCases()) {
        const initialRoot = rules([child]);
        const lateRoot = rules([]);
        lateRoot.collectDirectChildRulesEntries();
        lateRoot.push(makeChildCases().find(item => item.label === label)!.child);

        expect(snapshot(lateRoot)).toEqual(snapshot(initialRoot));
      }
    });

    it('ScopeFrame callable buckets: terminal mixin-only miss skips Rules.findMixinsFast for ruleset-only child surfaces', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.ruleset-only-child-missing') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const root = rules([
          rules([
            ruleset({
              selector: el('.ruleset-only-child'),
              rules: [decl({ name: 'color', value: any('green') })]
            })
          ])
        ]);
        root.getScopeFrame();
        root.collectDirectChildRulesEntries();
        expect(root.directChildRuleEntries?.[0]).toMatchObject({
          hasExactCallableSurface: true,
          hasExactMixinSurface: false,
          hasExactRulesetSurface: true
        });

        expect(root.findMixin('.ruleset-only-child-missing', 'Mixin', {
          terminalMixinOnly: true
        })).toBeUndefined();
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: terminal mixin-only miss ignores ruleset-only candidates', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.ruleset-only-prefix') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const root = rules([
          ruleset({
            selector: compound([el('.ruleset-only-prefix'), el('.leaf')]),
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]);
        root.getScopeFrame();

        expect(root.findMixin('.ruleset-only-prefix', 'Mixin', {
          terminalMixinOnly: true
        })).toBeUndefined();
        expect(lookupScopeFrameCallable(root._scopeFrame, '.ruleset-only-prefix', {
          includeRulesets: false,
          searchParents: false
        })).toEqual({ kind: 'miss' });
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: simple misses stop on compound-prefix candidates', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const fastPathHits: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.compound-prefix-only') {
          fastPathHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const root = rules([
          ruleset({
            selector: compound([el('.compound-prefix-only'), el('.leaf')]),
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]);
        root.getScopeFrame();

        expect(root.findMixin('.compound-prefix-only', undefined)).toBeUndefined();
        expect(lookupScopeFrameCallable(root._scopeFrame, '.compound-prefix-only', {
          includeRulesets: true,
          searchParents: false
        })).toEqual({
          kind: 'uncovered',
          reason: 'candidate'
        });
        expect(fastPathHits).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame callable buckets: terminal mixin-only child misses still climb to parent frames', () => {
      const parentMixin = mixin({
        name: '.parent-terminal-mixin',
        params: list([any('color', { role: 'property' })]),
        rules: [decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })]
      });
      // New model: the `.caller` Ruleset IS its own body (no `_passedRulesWrapper`),
      // so query the ruleset directly — its frame climbs to root where the mixin is.
      const callerRuleset = ruleset({
        selector: el('.caller'),
        rules: [
          ruleset({
            selector: el('.ruleset-only-child'),
            rules: [decl({ name: 'color', value: any('green') })]
          })
        ]
      });
      const root = rules([
        parentMixin,
        callerRuleset
      ]);
      root.getScopeFrame();
      callerRuleset.getScopeFrame();

      expect(callerRuleset.findMixin('.parent-terminal-mixin', 'Mixin', {
        terminalMixinOnly: true
      })).toEqual([parentMixin]);
    });

    it('direct mixin-only miss skips ruleset-only child surfaces without a frame', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const childBridgeKeys: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: any[]) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const [key, options] = args as [string, { searchParents?: boolean } | undefined];
        if (key === '.ruleset-only-direct-missing' && options?.searchParents === false) {
          childBridgeKeys.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const root = rules([
          rules([
            ruleset({
              selector: el('.ruleset-only-direct-child'),
              rules: [decl({ name: 'color', value: any('green') })]
            })
          ])
        ]);

        expect(root.findMixin('.ruleset-only-direct-missing', 'Mixin', {
          terminalMixinOnly: true
        })).toBeUndefined();
        expect(childBridgeKeys).toHaveLength(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('direct callable fast path: prepared null child entries skip child entry reads', () => {
      const childRules = rules([
        decl({ name: 'color', value: any('green') })
      ]);
      const root = rules([childRules]);
      root.collectDirectChildRulesEntries();
      expect(root.directChildRuleEntries).toBeNull();

      const originalValue = childRules.rules;
      Object.defineProperty(childRules, 'rules', {
        configurable: true,
        get() {
          throw new Error('mixin-only lookup should trust prepared null child entries');
        }
      });

      try {
        expect(root.findMixin('.prepared-null-direct-missing', 'Mixin')).toBeUndefined();
      } finally {
        Object.defineProperty(childRules, 'rules', {
          configurable: true,
          writable: true,
          value: originalValue
        });
      }
    });

    it('ruleset path misses skip mixin-only child surfaces without a frame', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const childRules = rules([
        mixin({
          name: '.only-mixin-child',
          rules: [decl({ name: 'color', value: any('blue') })]
        })
      ]);
      const root = rules([
        ruleset({
          selector: el('.mixin-only-surface'),
          rules: childRules.rules
        })
      ]);

      await root.eval(context);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.warmup-missing-ruleset-path' || key === '.missing-ruleset-path') {
          return [];
        }
        return originalFindMixinsFast.apply(this, args);
      };

      const descriptor = Object.getOwnPropertyDescriptor(childRules, 'rules');
      try {
        expect(root.findMixin(['.warmup-missing-ruleset-path', '.leaf'], undefined)).toBeUndefined();
        expect(root.hasExactRulesetChildSurface).toBe(false);

        Object.defineProperty(childRules, 'rules', {
          configurable: true,
          get() {
            throw new Error('ruleset path lookup should skip mixin-only child surfaces');
          }
        });
        expect(root.findMixin(['.missing-ruleset-path', '.leaf'], undefined)).toBeUndefined();
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
        if (descriptor) {
          Object.defineProperty(childRules, 'rules', descriptor);
        }
      }
    });

    it('ruleset namespace path lookup uses callable buckets without legacy rule indexing', () => {
      const root = rules([
        ruleset({
          selector: el('#theme'),
          rules: [
            ruleset({
              selector: el('.button'),
              rules: [decl({ name: 'color', value: any('red') })]
            })
          ]
        })
      ]);

      const found = root.findMixin(['#theme', '.button'], undefined, { searchParents: false });

      expect('_indexRules' in RulesClass.prototype).toBe(false);
      expect(found).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((found?.[0] as Ruleset | undefined)?.type).toBe('Ruleset');
    });

    it('compound-prefix ruleset lookup uses callable buckets without legacy rule indexing', () => {
      const root = rules([
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: [
            mixin({
              name: '.colors',
              rules: [decl({ name: 'primary', value: any('red') })]
            })
          ]
        })
      ]);

      const found = root.findMixin(['#theme', '.dark', '.navbar', '.colors'], undefined, { searchParents: false });

      expect('_indexRules' in RulesClass.prototype).toBe(false);
      expect(found).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((found?.[0] as Mixin | undefined)?.type).toBe('Mixin');
    });

    it('mixin namespace path lookup reuses path offsets instead of materializing remainder arrays', () => {
      const leaf = mixin({
        name: '.colors',
        rules: [decl({ name: 'primary', value: any('red') })]
      });
      const root = rules([
        mixin({
          name: '#theme',
          rules: [
            mixin({
              name: '.dark',
              rules: [leaf]
            })
          ]
        })
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const nestedArrayPathCalls: unknown[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayPathCalls.push(args[0]);
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        expect(root.findMixin(['#theme', '.dark', '.colors'], undefined, { searchParents: false })).toEqual([leaf]);
        expect(nestedArrayPathCalls).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('ruleset namespace path lookup reuses path offsets instead of materializing remainder arrays', () => {
      const leaf = mixin({
        name: '.colors',
        rules: [decl({ name: 'primary', value: any('red') })]
      });
      const root = rules([
        ruleset({
          selector: el('#theme'),
          rules: [
            ruleset({
              selector: el('.dark'),
              rules: [leaf]
            })
          ]
        })
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const nestedArrayPathCalls: unknown[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayPathCalls.push(args[0]);
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        expect(root.findMixin(['#theme', '.dark', '.colors'], undefined, { searchParents: false })).toEqual([leaf]);
        expect(nestedArrayPathCalls).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('compound-prefix ruleset lookup reuses path offsets instead of materializing remainder arrays', () => {
      const leaf = mixin({
        name: '.colors',
        rules: [decl({ name: 'primary', value: any('red') })]
      });
      const root = rules([
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: [leaf]
        })
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      let nestedArrayPathCalls = 0;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayPathCalls++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        expect(root.findMixin(['#theme', '.dark', '.navbar', '.colors'], undefined, {
          searchParents: false
        })).toEqual([leaf]);
        expect(nestedArrayPathCalls).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('definite namespace misses avoid legacy remainder-array fallback', () => {
      const root = rules([
        ruleset({
          selector: el('#theme'),
          rules: [
            ruleset({
              selector: el('.dark'),
              rules: [
                mixin({
                  name: '.other',
                  rules: [decl({ name: 'color', value: any('red') })]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: compound([el('#compound'), el('.prefix')]),
          rules: [
            ruleset({
              selector: el('.inner'),
              rules: [
                mixin({
                  name: '.other',
                  rules: [decl({ name: 'color', value: any('blue') })]
                })
              ]
            })
          ]
        }),
        mixin({
          name: '#mixin-ns',
          rules: [
            mixin({
              name: '.dark',
              rules: [
                mixin({
                  name: '.other',
                  rules: [decl({ name: 'color', value: any('green') })]
                })
              ]
            })
          ]
        })
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const nestedArrayPathCalls: unknown[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== root && Array.isArray(args[0])) {
          nestedArrayPathCalls.push(args[0]);
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        expect(root.findMixin(['#theme', '.dark', '.missing'], undefined, {
          searchParents: false
        })).toBeUndefined();
        expect(root.findMixin(['#compound', '.prefix', '.inner', '.missing'], undefined, {
          searchParents: false
        })).toBeUndefined();
        expect(root.findMixin(['#mixin-ns', '.dark', '.missing'], undefined, {
          searchParents: false
        })).toBeUndefined();
        expect(nestedArrayPathCalls).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('callable lookup does not build a scope frame just to try the frame shortcut', () => {
      const mixinDef = mixin({
        name: '.lazy-frame-mixin',
        rules: [decl({ name: 'color', value: any('green') })]
      });
      const root = rules([mixinDef]);

      expect(root._scopeFrame).toBeUndefined();
      expect(root.findMixin('.lazy-frame-mixin', 'Mixin')).toEqual([mixinDef]);
      expect(root._scopeFrame).toBeUndefined();
    });

    it('callable cache fast path: type=mixin-ruleset static Mixin hit', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const mixinDef = mixin({
        name: '.fast-mixin',
        rules: [decl({ name: 'color', value: any('green') })]
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.a'),
          rules: [call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin-ruleset' }) })]
        }),
        ruleset({
          selector: el('.b'),
          rules: [call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin-ruleset' }) })]
        }),
        ruleset({
          selector: el('.c'),
          rules: [call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin-ruleset' }) })]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);
      expect(css).toBeString(`
        .a {
          color: green;
        }
        .b {
          color: green;
        }
        .c {
          color: green;
        }
      `);
    });

    it('callable cache fast path: type=mixin-ruleset simple Ruleset hit', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const root = rules([
        ruleset({
          selector: el('.fast-ruleset'),
          rules: [decl({ name: 'color', value: any('green') })]
        }),
        ruleset({
          selector: el('.a'),
          rules: [call({ name: ref({ key: '.fast-ruleset' }, { type: 'mixin-ruleset' }) })]
        }),
        ruleset({
          selector: el('.b'),
          rules: [call({ name: ref({ key: '.fast-ruleset' }, { type: 'mixin-ruleset' }) })]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);
      expect(css).toBeString(`
        .fast-ruleset {
          color: green;
        }
        .a {
          color: green;
        }
        .b {
          color: green;
        }
      `);
    });

    it('callable cache fast path: type=mixin resolved interpolated name', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const mixinDef = mixin({
        name: interpolated({
          source: '.' + INTERPOLATION_PLACEHOLDER,
          replacements: [any('fast-mixin')]
        }, { role: 'name' }),
        rules: [decl({ name: 'color', value: any('orange') })]
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.a'),
          rules: [call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin' }) })]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);
      expect(css).toBeString(`
        .a {
          color: orange;
        }
      `);
    });

    it('callable cache fast path: type=mixin-ruleset resolved interpolated simple name', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [any('foo')]
      }, { role: 'ident' });
      const root = rules([
        ruleset({
          selector: interpolatedSelector(dynamicClass),
          rules: [
            decl({ name: 'color', value: any('red') })
          ]
        }),
        ruleset({
          selector: el('.out'),
          rules: [
            call({
              name: ref({ key: '.foo' }, { type: 'mixin-ruleset' })
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);
      expect(css).toBeString(`
        .foo {
          color: red;
        }
        .out {
          color: red;
        }
      `);
    });

    it('callable cache fast path: type=mixin static-name miss', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const root = rules([
        mixin({
          name: '.other-mixin',
          rules: [decl({ name: 'color', value: any('green') })]
        }),
        ruleset({
          selector: el('.a'),
          rules: [
            decl({
              name: 'content',
              value: ref({ key: '.missing-mixin' }, { type: 'mixin', fallbackValue: true })
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);
      expect(css).toBeString(`
        .a {
          content: .missing-mixin;
        }
      `);
    });

    it('callable cache fast path: type=mixin-ruleset simple-name miss', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const root = rules([
        mixin({
          name: '.other-mixin',
          rules: [decl({ name: 'color', value: any('green') })]
        }),
        ruleset({
          selector: el('.a'),
          rules: [
            decl({
              name: 'content',
              value: ref({ key: '.missing-ruleset-mixin' }, { type: 'mixin-ruleset', fallbackValue: true })
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);
      expect(css).toBeString(`
        .a {
          content: .missing-ruleset-mixin;
        }
      `);
    });

    it('callable cache fast path: unresolved dynamic simple-name candidates miss directly', () => {
      const root = rules([
        mixin({
          name: interpolated({
            source: '.' + INTERPOLATION_PLACEHOLDER,
            replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
          }, { role: 'name' }),
          rules: [decl({ name: 'color', value: any('orange') })]
        })
      ]);

      const found = root.findMixin('.missing-mixin');
      expect(found).toBeUndefined();
    });

    it('namespace fast path: unresolved dynamic namespace segments miss directly', () => {
      const root = rules([
        mixin({
          name: '#theme',
          rules: [
            mixin({
              name: interpolated({
                source: INTERPOLATION_PLACEHOLDER,
                replacements: [ref({ key: 'segment' }, { type: 'variable' })]
              }, { role: 'name' }),
              rules: [
                mixin({
                  name: '.navbar',
                  rules: [
                    mixin({
                      name: '.colors',
                      rules: [
                        decl({ name: 'primary', value: any('cyan') })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]);

      const found = root.findMixin(['#theme', '.dark', '.navbar', '.colors'], undefined, {
        context
      });
      expect(found).toBeUndefined();
    });

    it('namespace fast path: type=mixin ignores compound-prefix ruleset ambiguity', () => {
      const root = rules([
        mixin({
          name: '#theme',
          rules: [
            mixin({
              name: '.dark',
              rules: [
                mixin({
                  name: '.navbar',
                  rules: [
                    mixin({
                      name: '.colors',
                      rules: [
                        decl({ name: 'primary', value: any('cyan') })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: [
            mixin({
              name: '.colors',
              rules: [
                decl({ name: 'primary', value: any('red') })
              ]
            })
          ]
        })
      ]);
      const found = root.findMixin(['#theme', '.dark', '.navbar', '.colors'], 'Mixin', {
        context
      });
      expect(found).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((found?.[0] as Mixin | undefined)?.type).toBe('Mixin');
      const mixinHit = found?.[0];
      expect(mixinHit instanceof Mixin ? mixinHit.name?.valueOf() : undefined).toBe('.colors');
    });

    it('namespace fast path: type=mixin misses ignore callable ruleset starts', () => {
      const root = rules([
        ruleset({
          selector: el('#theme'),
          rules: [
            ruleset({
              selector: el('.dark'),
              rules: [
                ruleset({
                  selector: el('.navbar'),
                  rules: [
                    mixin({
                      name: '.colors',
                      rules: [
                        decl({ name: 'primary', value: any('red') })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]);

      const found = root.findMixin(['#theme', '.dark', '.navbar', '.colors'], 'Mixin', {
        context
      });
      expect(found).toBeUndefined();
    });

    it('namespace fast path: ruleset namespace path preserves callable namespace unions', async () => {
      const { Parser } = await import('../../../../less-parser/src/index.js');
      const parser = new Parser();
      const tree = parser.parse(`
        @namespaceGuard: 1;

        #guarded when (@namespaceGuard > 0) {
          #deeper {
            .mixin() {
              guarded: namespace;
            }
          }
        }

        #guarded() when (@namespaceGuard > 0) {
          #deeper {
            .mixin() {
              silent: namespace;
            }
          }
        }

        #guarded(@variable: default) when (@namespaceGuard > 0) {
          #deeper {
            .mixin() {
              guarded: with default;
            }
          }
        }

        #guarded-caller {
          #guarded > #deeper > .mixin();
        }
      `).tree;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const typedTree = tree as unknown as RulesClass;
      context.root = typedTree;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const directCrawlHits: string[] = [];
      let nestedArrayPathCalls = 0;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '#guarded' || key === '#deeper' || key === '.mixin') {
          directCrawlHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== typedTree && Array.isArray(args[0])) {
          nestedArrayPathCalls++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        const found = typedTree.findMixin(['#guarded', '#deeper', '.mixin'], undefined, {
          context
        });

        expect(found).toHaveLength(3);

        const css = await renderNodeToString(typedTree, context, { context });

        expect(css).toContain('#guarded-caller {');
        expect(css).toContain('guarded: namespace;');
        expect(css).toContain('silent: namespace;');
        expect(css).toContain('guarded: with default;');
        expect(directCrawlHits).toEqual([]);
        expect(nestedArrayPathCalls).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('namespace fast path: real Less stable namespaces avoid direct-crawl and array fallback', async () => {
      const { Parser } = await import('../../../../less-parser/src/index.js');
      const parser = new Parser();
      const tree = parser.parse(`
        #theme {
          .dark {
            .colors() {
              color: cyan;
            }
          }
        }

        #panel.dark.navbar {
          .colors() {
            background: red;
          }
        }

        #ns() {
          .leaf() {
            width: 1px;
          }
        }

        .parameterized {
          color: ruleset;
        }

        .parameterized(@color) {
          color: @color;
        }

        .a {
          #theme > .dark > .colors();
        }

        .b {
          #panel > .dark > .navbar > .colors();
        }

        .c {
          #ns > .leaf();
        }

        .d {
          .parameterized(blue);
        }
      `).tree;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const typedTree2 = tree as unknown as RulesClass;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const directCrawlHits: string[] = [];
      let nestedArrayPathCalls = 0;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (
          key === '#theme'
          || key === '#panel'
          || key === '.dark'
          || key === '.navbar'
          || key === '.colors'
          || key === '#ns'
          || key === '.leaf'
          || key === '.parameterized'
        ) {
          directCrawlHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== typedTree2 && Array.isArray(args[0])) {
          nestedArrayPathCalls++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        context.root = typedTree2;
        const css = await renderNodeToString(typedTree2, context, { context });

        expect(css).toContain('.a {');
        expect(css).toContain('color: cyan;');
        expect(css).toContain('.b {');
        expect(css).toContain('background: red;');
        expect(css).toContain('.c {');
        expect(css).toContain('width: 1px;');
        expect(css).toContain('.d {');
        expect(css).toContain('color: blue;');
        expect(directCrawlHits).toEqual([]);
        expect(nestedArrayPathCalls).toBe(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('mixin-ruleset calls with args mark terminal lookup mixin-only', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const terminalHints: boolean[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: any[]) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const [key, , options] = args as [string, unknown, { terminalMixinOnly?: boolean } | undefined];
        if (key === '.parameterized') {
          terminalHints.push(options?.terminalMixinOnly === true);
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        const root = rules([
          ruleset({
            selector: el('.parameterized'),
            rules: [decl({ name: 'color', value: any('ruleset') })]
          }),
          mixin({
            name: '.parameterized',
            params: list([any('color', { role: 'property' })]),
            rules: [decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })]
          }),
          ruleset({
            selector: el('.a'),
            rules: [
              call({
                name: ref({ key: '.parameterized' }, { type: 'mixin-ruleset' }),
                args: list([any('red')])
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toBeString(`
          .parameterized {
            color: ruleset;
          }
          .a {
            color: red;
          }
        `);
        expect(terminalHints).toContain(true);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('mixin-ruleset calls with args still use rulesets as namespace containers', async () => {
      const { Parser } = await import('../../../../less-parser/src/index.js');
      const parser = new Parser();
      const tree = parser.parse(`
        #theme {
          .button {
            color: ruleset;
          }
          .button(@color) {
            color: @color;
          }
        }

        .a {
          #theme > .button(red);
        }
      `).tree;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const typedTree3 = tree as unknown as RulesClass;
      context.root = typedTree3;

      const css = await renderNodeToString(typedTree3, context, { context });
      expect(css).toBeString(`
        #theme {
          .button {
            color: ruleset;
          }
        }
        .a {
          color: red;
        }
      `);
    });

    it('mixin-ruleset calls with args keep only the recursive namespace terminal mixin-only', async () => {
      const { Parser } = await import('../../../../less-parser/src/index.js');
      const parser = new Parser();
      const tree = parser.parse(`
        #theme {
          .dark {
            .button {
              color: ruleset;
            }
            .button(@color) {
              color: @color;
            }
          }
        }

        .a {
          #theme > .dark > .button(red);
        }
      `).tree;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const typedTree4 = tree as unknown as RulesClass;
      context.root = typedTree4;

      const css = await renderNodeToString(typedTree4, context, { context });
      expect(css).toBeString(`
        #theme {
          .dark {
            .button {
              color: ruleset;
            }
          }
        }
        .a {
          color: red;
        }
      `);
    });

    it('mixin-ruleset calls with args exclude only the namespaced terminal ruleset', () => {
      const terminalMixin = mixin({
        name: '.button',
        params: list([any('color', { role: 'property' })]),
        rules: [decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })]
      });
      const terminalRuleset = ruleset({
        selector: el('.button'),
        rules: [decl({ name: 'color', value: any('ruleset') })]
      });
      const root = rules([
        ruleset({
          selector: el('#theme'),
          rules: [
            terminalRuleset,
            terminalMixin
          ]
        })
      ]);
      root.getScopeFrame();

      const allTerminals = root.findMixin(['#theme', '.button'], undefined);
      expect(allTerminals).toContain(terminalRuleset);
      expect(allTerminals).toContain(terminalMixin);
      expect(root.findMixin(['#theme', '.button'], undefined, {
        terminalMixinOnly: true
      })).toEqual([terminalMixin]);
    });

    it('mixin-ruleset calls with args reject exact ruleset terminals after namespace resolution', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixin = (RulesClass.prototype as any).findMixin;
      const root = rules([
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.button')]),
          rules: [decl({ name: 'color', value: any('ruleset') })]
        })
      ]);
      const broadFastHits: string[] = [];
      let arrayPathCalls = 0;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && (key === '#theme' || key === '.dark' || key === '.button')) {
          broadFastHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this === root && Array.isArray(args[0])) {
          arrayPathCalls++;
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        expect(root.findMixin(['#theme', '.dark', '.button'], undefined)).toHaveLength(1);
        arrayPathCalls = 0;
        expect(root.findMixin(['#theme', '.dark', '.button'], undefined, {
          terminalMixinOnly: true
        })).toBeUndefined();
        expect(broadFastHits).toEqual([]);
        expect(arrayPathCalls).toBe(1);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixin = originalFindMixin;
      }
    });

    it('mixin-ruleset calls with args keep imported ruleset namespaces but exclude imported terminal rulesets', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const terminalMixin = mixin({
        name: '.button',
        params: list([any('color', { role: 'property' })]),
        rules: [decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })]
      });
      const terminalRuleset = ruleset({
        selector: el('.button'),
        rules: [decl({ name: 'color', value: any('ruleset') })]
      });
      const referenceChild = rules([
        ruleset({
          selector: el('#imported'),
          rules: [
            terminalRuleset,
            terminalMixin
          ]
        })
      ], { referenceMode: true });
      const root = rules([referenceChild]);
      const broadFastHits: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && (key === '#imported' || key === '.button')) {
          broadFastHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        referenceChild.getScopeFrame();
        root.collectDirectChildRulesEntries();
        expect(root.directChildRuleEntries?.[0]).toMatchObject({
          hasReferenceImportSurface: true,
          hasExactRulesetSurface: true
        });

        const allTerminals = root.findMixin(['#imported', '.button'], undefined, {
          searchParents: false
        });
        expect(allTerminals).toContain(terminalRuleset);
        expect(allTerminals).toContain(terminalMixin);
        expect(root.findMixin(['#imported', '.button'], undefined, {
          searchParents: false,
          terminalMixinOnly: true
        })).toEqual([terminalMixin]);
        expect(broadFastHits).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('mixin-ruleset calls with args reject imported exact ruleset terminals after namespace resolution', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const originalFindMixinsFast = (RulesClass.prototype as any).findMixinsFast;
      const referenceChild = rules([
        ruleset({
          selector: compound([el('#imported'), el('.dark'), el('.button')]),
          rules: [decl({ name: 'color', value: any('ruleset') })]
        })
      ], { referenceMode: true });
      const root = rules([referenceChild]);
      const broadFastHits: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (RulesClass.prototype as any).findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === root && (key === '#imported' || key === '.button')) {
          broadFastHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        root.getScopeFrame();
        referenceChild.getScopeFrame();
        root.collectDirectChildRulesEntries();
        expect(root.findMixin(['#imported', '.dark', '.button'], undefined, {
          searchParents: false
        })).toHaveLength(1);
        expect(root.findMixin(['#imported', '.dark', '.button'], undefined, {
          searchParents: false,
          terminalMixinOnly: true
        })).toBeUndefined();
        expect(broadFastHits).toEqual([]);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (RulesClass.prototype as any).findMixinsFast = originalFindMixinsFast;
      }
    });

    it('ScopeFrame live slots resolve param and @arguments via frame chain', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      // Prove params and @arguments are in liveSlotsByName by testing their output.
      // If either were missing from the frame, the reference lookup would fail or
      // fall through to the slower declaration/callable lookup path.
      const mixinDef = mixin({
        name: '.parameterized',
        params: list([any('color', { role: 'property' })]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          // @arguments is automatically bound in liveSlotsByName.
          decl({ name: 'args', value: ref({ key: 'arguments' }, { type: 'variable' }) })
        ]
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.a'),
          rules: [call({
            name: ref({ key: '.parameterized' }, { type: 'mixin-ruleset' }),
            args: list([any('red')])
          })]
        })
      ]);
      context.root = root;
      const evald = await root.eval(context);
      const css = await evald.render(context);

      expect(css).toBeString(`
        .a {
          color: red;
          args: red;
        }
      `);

      // runtimeVarBindings infrastructure is fully retired.
      expect('runtimeVarBindings' in RulesClass.prototype).toBe(false);
      expect('findRuntimeVarBinding' in RulesClass.prototype).toBe(false);
      expect('setRuntimeVarBinding' in RulesClass.prototype).toBe(false);
    });

    it('keeps mixin current reads and snapshot reads on separate binding paths', async () => {
      const root = rules([
        vardecl({ name: 'color', value: any('red') }),
        mixin({
          name: '.paint',
          rules: [
            decl({ name: 'current-before', value: ref({ key: 'color' }, { type: 'variable' }) }),
            decl({
              name: 'snapshot-before',
              value: ref({ key: 'color' }, { type: 'variable', readMode: 'snapshot' })
            }),
            vardecl({ name: 'color', value: any('blue') }),
            decl({ name: 'current-after', value: ref({ key: 'color' }, { type: 'variable' }) }),
            decl({
              name: 'snapshot-after',
              value: ref({ key: 'color' }, { type: 'variable', readMode: 'snapshot' })
            })
          ]
        }),
        ruleset({
          selector: el('.use'),
          rules: [
            call({ name: ref({ key: '.paint' }, { type: 'mixin' }) })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .use {
          current-before: blue;
          snapshot-before: red;
          current-after: blue;
          snapshot-after: blue;
        }
      `);
    });

    it('routes mixin setDefined writes through the resolved caller binding', async () => {
      const root = rules([
        vardecl({ name: 'color', value: any('red') }),
        mixin({
          name: '.set-color',
          rules: [
            vardecl({ name: 'color', value: any('blue') }, { setDefined: true })
          ]
        }),
        ruleset({
          selector: el('.use'),
          rules: [
            call({ name: ref({ key: '.set-color' }, { type: 'mixin' }) }),
            decl({ name: 'after-call', value: ref({ key: 'color' }, { type: 'variable' }) })
          ]
        }),
        decl({ name: 'after-root', value: ref({ key: 'color' }, { type: 'variable' }) })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .use {
          after-call: blue;
        }
        after-root: blue;
      `);
    });

    it('evaluates mixin setDefined writes from live parameter bindings', async () => {
      const root = rules([
        vardecl({ name: 'color', value: any('red') }),
        mixin({
          name: '.set-color',
          params: list([any('next', { role: 'property' })]),
          rules: [
            vardecl({
              name: 'color',
              value: ref({ key: 'next' }, { type: 'variable' })
            }, { setDefined: true })
          ]
        }),
        ruleset({
          selector: el('.use'),
          rules: [
            call({
              name: ref({ key: '.set-color' }, { type: 'mixin' }),
              args: list([any('blue')])
            }),
            decl({ name: 'after-call', value: ref({ key: 'color' }, { type: 'variable' }) })
          ]
        }),
        decl({ name: 'after-root', value: ref({ key: 'color' }, { type: 'variable' }) })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .use {
          after-call: blue;
        }
        after-root: blue;
      `);
    });

    it('does not prepare unused mixin parameter containers before lookup', async () => {
      const originalDetachTrivia = Node.prototype.detachTrivia;
      let detachedArgContainers = 0;
      Node.prototype.detachTrivia = function detachTriviaForCounting(
        this: Node,
        ...args: Parameters<typeof originalDetachTrivia>
      ): ReturnType<typeof originalDetachTrivia> {
        if (this.type === 'Sequence' && this.valueOf() === 'red 10px') {
          detachedArgContainers++;
        }
        return originalDetachTrivia.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.unused',
            params: list([
              any('space', { role: 'property' })
            ]),
            rules: [
              decl({ name: 'color', value: any('blue') })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.unused' }, { type: 'mixin' }),
                args: list([seq([any('red'), any('10px')])])
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);

        expect(css).toContain('color: blue;');
        expect(detachedArgContainers).toBe(0);
      } finally {
        Node.prototype.detachTrivia = originalDetachTrivia;
      }
    });

    it('does not prepare unused rest parameter containers before lookup', async () => {
      const originalDetachTrivia = Node.prototype.detachTrivia;
      let detachedArgContainers = 0;
      Node.prototype.detachTrivia = function detachTriviaForCounting(
        this: Node,
        ...args: Parameters<typeof originalDetachTrivia>
      ): ReturnType<typeof originalDetachTrivia> {
        if (this.type === 'Sequence' && this.valueOf() === 'red 10px') {
          detachedArgContainers++;
        }
        return originalDetachTrivia.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.unused-rest',
            params: list([
              any('first', { role: 'property' }),
              rest('rest')
            ]),
            rules: [
              decl({ name: 'color', value: any('blue') })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.unused-rest' }, { type: 'mixin' }),
                args: list([any('0'), seq([any('red'), any('10px')])])
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);

        expect(css).toContain('color: blue;');
        expect(detachedArgContainers).toBe(0);
      } finally {
        Node.prototype.detachTrivia = originalDetachTrivia;
      }
    });

    it('does not prepare @arguments containers before @arguments lookup', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });
      const originalDetachTrivia = Node.prototype.detachTrivia;
      let detachedArgContainers = 0;
      Node.prototype.detachTrivia = function detachTriviaForCounting(
        this: Node,
        ...args: Parameters<typeof originalDetachTrivia>
      ): ReturnType<typeof originalDetachTrivia> {
        if (this.type === 'Sequence' && this.valueOf() === 'red 10px') {
          detachedArgContainers++;
        }
        return originalDetachTrivia.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.unused-arguments',
            params: list([
              any('space', { role: 'property' })
            ]),
            rules: [
              decl({ name: 'color', value: any('blue') })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({
                name: ref({ key: '.unused-arguments' }, { type: 'mixin' }),
                args: list([seq([any('red'), any('10px')])])
              })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);

        expect(css).toContain('color: blue;');
        expect(detachedArgContainers).toBe(0);
      } finally {
        Node.prototype.detachTrivia = originalDetachTrivia;
      }
    });

    it('evaluates named argument values in the caller scope when preparing lazy bindings', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });
      const root = rules([
        mixin({
          name: '.named',
          params: list([
            vardecl({ name: 'a', value: any('1px') }, { paramVar: true }),
            vardecl({ name: 'b', value: any('50%') }, { paramVar: true })
          ]),
          rules: [
            decl({ name: 'height', value: ref({ key: 'b' }, { type: 'variable' }) }),
            decl({ name: 'args', value: ref({ key: 'arguments' }, { type: 'variable' }) })
          ]
        }),
        ruleset({
          selector: el('.use'),
          rules: [
            vardecl({ name: 'var', value: any('20%') }),
            call({
              name: ref({ key: '.named' }, { type: 'mixin' }),
              args: list([
                vardecl({ name: 'b', value: ref({ key: 'var' }, { type: 'variable' }) }, { paramVar: true })
              ])
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('height: 20%;');
      expect(css).toContain('args: 1px 20%;');
    });

    it('frame live slots resolve mixin params via frame chain after runtimeVarBindings removal', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const mixinDef = mixin({
        name: '.colored',
        params: list([any('color', { role: 'property' })]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          decl({ name: 'border-color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ]
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.a'),
          rules: [call({
            name: ref({ key: '.colored' }, { type: 'mixin-ruleset' }),
            args: list([any('red')])
          })]
        })
      ]);
      context.root = root;
      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .a {
          color: red;
          border-color: red;
        }
      `);
    });

    it('should call a mixin with a guard condition', async () => {
      // Create a mixin with a guard: .my-mixin(@color) when (@color = red) { color: @color; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('color', { role: 'property' })
        ]),
        guard: condition([
          expr(ref({ key: 'color' }, { type: 'variable' })),
          '=',
          any('red')
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin with matching condition: .test1 { .my-mixin(red); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('red')])
          })
        ]
      });

      // Create a ruleset that calls the mixin with non-matching condition: .test2 { .my-mixin(blue); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      const root = rules([mixinDef, testRuleset1, testRuleset2]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test1 {
          color: red;
        }
      `);
    });

    it('fails explicitly when a string-backed mixin guard reaches evaluation before hydration', async () => {
      const root = rules([
        mixin({
          name: '.guarded',
          guard: '(@enabled)',
          rules: [
            decl({ name: 'color', value: any('red') })
          ]
        }),
        ruleset({
          selector: el('.use'),
          rules: [
            call({ name: ref({ key: '.guarded' }, { type: 'mixin' }) })
          ]
        })
      ]);
      context.root = root;

      await expect(renderNodeToString(root, context)).rejects.toThrow(
        'String-backed mixin guards must be hydrated before evaluation'
      );
    });

    it('does not copy static bool guards before evaluating candidates', async () => {
      const originalCopy = Bool.prototype.cloneForPlacement;
      let guardCopies = 0;
      Bool.prototype.cloneForPlacement = function copyForCounting(
        this: Bool,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        guardCopies++;
        return originalCopy.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: '.guarded',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            guard: bool(true) as unknown as Condition,
            rules: [
              decl({ name: 'color', value: any('red') })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              call({ name: ref({ key: '.guarded' }, { type: 'mixin' }) })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('color: red;');
        expect(guardCopies).toBe(0);
      } finally {
        Bool.prototype.cloneForPlacement = originalCopy;
      }
    });

    it('restores caller rulesContext when static guard evaluation throws', async () => {
      context = new Context({ leakyRules: false });
      const savedRulesContext = rules([]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const guard = bool(true) as unknown as Condition;
      guard.eval = (evalContext: Context) => {
        expect(evalContext.rulesContext).not.toBe(savedRulesContext);
        throw new Error('guard eval failed');
      };
      const root = rules([
        mixin({
          name: '.guarded',
          guard,
          rules: [
            decl({ name: 'color', value: any('red') })
          ]
        }),
        ruleset({
          selector: el('.use'),
          rules: [
            call({ name: ref({ key: '.guarded' }, { type: 'mixin' }) })
          ]
        })
      ]);
      context.root = root;
      context.rulesContext = savedRulesContext;

      await expect(renderNodeToString(root, context)).rejects.toThrow('guard eval failed');
      expect(context.rulesContext).toBe(savedRulesContext);
    });

    it('evaluates dynamic guards from source without stamping guard state', async () => {
      context = new Context({ leakyRules: false });
      const guard = condition([
        expr(ref({ key: 'mode' }, { type: 'variable' })),
        '=',
        any('dark')
      ]);
      const root = rules([
        mixin({
          name: '.guarded',
          guard,
          rules: [
            decl({ name: 'color', value: any('red') })
          ]
        }),
        ruleset({
          selector: el('.use'),
          rules: [
            vardecl({ name: 'mode', value: any('dark') }),
            call({ name: ref({ key: '.guarded' }, { type: 'mixin' }) })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('color: red;');
      expect(guard.registrationPrepared).toBe(false);
      expect(guard.frozen).toBe(false);
    });

    it('does not clone source-free scalar leaves while evaluating dynamic guards', async () => {
      const originalClone = Any.prototype.clone;
      let scalarClones = 0;
      Any.prototype.clone = function cloneForCounting(
        this: Any,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.valueOf() === 'dark') {
          scalarClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        context = new Context({ leakyRules: false });
        const root = rules([
          mixin({
            name: '.guarded',
            guard: condition([
              expr(ref({ key: 'mode' }, { type: 'variable' })),
              '=',
              any('dark')
            ]),
            rules: [
              decl({ name: 'color', value: any('red') })
            ]
          }),
          ruleset({
            selector: el('.use'),
            rules: [
              vardecl({ name: 'mode', value: any('dark') }),
              call({ name: ref({ key: '.guarded' }, { type: 'mixin' }) })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('color: red;');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('evaluates dynamic mixin guards against caller scope while params still resolve from live slots', async () => {
      context = new Context({ leakyRules: false });
      const mixinDef = mixin({
        name: '.theme-mixin',
        params: list([
          any('color', { role: 'property' })
        ]),
        guard: condition([
          condition([
            expr(ref({ key: 'mode' }, { type: 'variable' })),
            '=',
            any('dark')
          ]),
          'and',
          condition([
            expr(ref({ key: 'color' }, { type: 'variable' })),
            '=',
            any('red')
          ])
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ]
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.dark'),
          rules: [
            vardecl({ name: 'mode', value: any('dark') }),
            call({
              name: ref({ key: '.theme-mixin' }, { type: 'mixin' }),
              args: list([any('red')])
            })
          ]
        }),
        ruleset({
          selector: el('.light'),
          rules: [
            vardecl({ name: 'mode', value: any('light') }),
            call({
              name: ref({ key: '.theme-mixin' }, { type: 'mixin' }),
              args: list([any('red')])
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.dark {');
      expect(css).toContain('color: red;');
      expect(css).not.toContain('.light {\n  color: red;');
    });

    it('evaluates no-param mixin guards against caller scope', async () => {
      context = new Context({ leakyRules: false });
      const mixinDef = mixin({
        name: '.scope-guarded',
        guard: condition([
          expr(ref({ key: 'mode' }, { type: 'variable' })),
          '=',
          any('dark')
        ]),
        rules: [
          decl({ name: 'color', value: any('black') })
        ]
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.dark'),
          rules: [
            vardecl({ name: 'mode', value: any('dark') }),
            call({ name: ref({ key: '.scope-guarded' }, { type: 'mixin' }) })
          ]
        }),
        ruleset({
          selector: el('.light'),
          rules: [
            vardecl({ name: 'mode', value: any('light') }),
            call({ name: ref({ key: '.scope-guarded' }, { type: 'mixin' }) })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.dark {');
      expect(css).toContain('color: black;');
      expect(css).not.toContain('.light {\n  color: black;');
    });

    it('does not let non-leaky no-param mixin bodies read caller scope after guard selection', async () => {
      context = new Context({ leakyRules: false });
      const mixinDef = mixin({
        name: '.scope-guarded-body',
        guard: condition([
          expr(ref({ key: 'mode' }, { type: 'variable' })),
          '=',
          any('dark')
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'mode' }, { type: 'variable' }) })
        ]
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.dark'),
          rules: [
            vardecl({ name: 'mode', value: any('dark') }),
            call({ name: ref({ key: '.scope-guarded-body' }, { type: 'mixin' }) })
          ]
        })
      ]);
      context.root = root;

      await expectRejects(
        root.eval(context),
        ReferenceError,
        /mode/
      );
    });

    it('keeps no-param guard lookup isolated from mixin body vars with the same name', async () => {
      context = new Context({ leakyRules: false });
      const mixinDef = mixin({
        name: '.scope-guarded-body-shadow',
        guard: condition([
          expr(ref({ key: 'mode' }, { type: 'variable' })),
          '=',
          any('dark')
        ]),
        rules: [
          vardecl({ name: 'mode', value: any('light') }),
          decl({ name: 'color', value: any('black') })
        ]
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.dark'),
          rules: [
            vardecl({ name: 'mode', value: any('dark') }),
            call({ name: ref({ key: '.scope-guarded-body-shadow' }, { type: 'mixin' }) })
          ]
        }),
        ruleset({
          selector: el('.light'),
          rules: [
            vardecl({ name: 'mode', value: any('light') }),
            call({ name: ref({ key: '.scope-guarded-body-shadow' }, { type: 'mixin' }) })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.dark {');
      expect(css).toContain('color: black;');
      expect(css).not.toContain('.light {\n  color: black;');
    });

    it('evaluates default guards against caller scope without leaking param bindings into sibling output', async () => {
      context = new Context({ leakyRules: false });
      const darkDefault = mixin({
        name: '.guarded-default',
        params: list([
          any('color', { role: 'property' })
        ]),
        guard: condition([
          condition([
            expr(ref({ key: 'mode' }, { type: 'variable' })),
            '=',
            any('dark')
          ]),
          'and',
          defaultguard()
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ]
      });

      const lightDefault = mixin({
        name: '.guarded-default',
        params: list([
          any('color', { role: 'property' })
        ]),
        guard: condition([
          condition([
            expr(ref({ key: 'mode' }, { type: 'variable' })),
            '=',
            any('light')
          ]),
          'and',
          defaultguard()
        ]),
        rules: [
          decl({ name: 'background', value: ref({ key: 'color' }, { type: 'variable' }) })
        ]
      });

      const root = rules([
        darkDefault,
        lightDefault,
        ruleset({
          selector: el('.dark'),
          rules: [
            vardecl({ name: 'mode', value: any('dark') }),
            vardecl({ name: 'color', value: any('outer-dark') }),
            call({
              name: ref({ key: '.guarded-default' }, { type: 'mixin' }),
              args: list([any('red')])
            }),
            decl({ name: 'value', value: ref({ key: 'color' }, { type: 'variable' }) })
          ]
        }),
        ruleset({
          selector: el('.light'),
          rules: [
            vardecl({ name: 'mode', value: any('light') }),
            vardecl({ name: 'color', value: any('outer-light') }),
            call({
              name: ref({ key: '.guarded-default' }, { type: 'mixin' }),
              args: list([any('blue')])
            }),
            decl({ name: 'value', value: ref({ key: 'color' }, { type: 'variable' }) })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.dark {');
      expect(css).toContain('color: red;');
      expect(css).toContain('value: outer-dark;');
      expect(css).toContain('.light {');
      expect(css).toContain('background: blue;');
      expect(css).toContain('value: outer-light;');
      expect(css).not.toContain('value: red;');
      expect(css).not.toContain('value: blue;');
    });

    it('does not clone source-free scalar leaves while probing default guards', async () => {
      const originalClone = Any.prototype.clone;
      let scalarClones = 0;
      Any.prototype.clone = function cloneForCounting(
        this: Any,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.valueOf() === 'dark') {
          scalarClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        context = new Context({ leakyRules: false });
        const root = rules([
          mixin({
            name: '.guarded-default',
            guard: condition([
              condition([
                expr(ref({ key: 'mode' }, { type: 'variable' })),
                '=',
                any('dark')
              ]),
              'and',
              defaultguard()
            ]),
            rules: [
              decl({ name: 'color', value: any('red') })
            ]
          }),
          ruleset({
            selector: el('.dark'),
            rules: [
              vardecl({ name: 'mode', value: any('dark') }),
              call({ name: ref({ key: '.guarded-default' }, { type: 'mixin' }) })
            ]
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('color: red;');
        expect(scalarClones).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('evaluates no-param default guards against caller scope', async () => {
      context = new Context({ leakyRules: false });
      const darkDefault = mixin({
        name: '.scope-default',
        guard: condition([
          condition([
            expr(ref({ key: 'mode' }, { type: 'variable' })),
            '=',
            any('dark')
          ]),
          'and',
          defaultguard()
        ]),
        rules: [
          decl({ name: 'color', value: any('black') })
        ]
      });

      const lightDefault = mixin({
        name: '.scope-default',
        guard: condition([
          condition([
            expr(ref({ key: 'mode' }, { type: 'variable' })),
            '=',
            any('light')
          ]),
          'and',
          defaultguard()
        ]),
        rules: [
          decl({ name: 'background', value: any('white') })
        ]
      });

      const root = rules([
        darkDefault,
        lightDefault,
        ruleset({
          selector: el('.dark'),
          rules: [
            vardecl({ name: 'mode', value: any('dark') }),
            call({ name: ref({ key: '.scope-default' }, { type: 'mixin' }) }),
            decl({ name: 'value', value: ref({ key: 'mode' }, { type: 'variable' }) })
          ]
        }),
        ruleset({
          selector: el('.light'),
          rules: [
            vardecl({ name: 'mode', value: any('light') }),
            call({ name: ref({ key: '.scope-default' }, { type: 'mixin' }) }),
            decl({ name: 'value', value: ref({ key: 'mode' }, { type: 'variable' }) })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('.dark {');
      expect(css).toContain('color: black;');
      expect(css).toContain('value: dark;');
      expect(css).toContain('.light {');
      expect(css).toContain('background: white;');
      expect(css).toContain('value: light;');
    });

    it('evaluates rest-parameter guard checks against live slot bindings', async () => {
      const mixinDef = mixin({
        name: '.rest-guard',
        params: list([
          any('first', { role: 'property' }),
          rest('rest')
        ]),
        guard: condition([
          expr(ref({ key: 'rest' }, { type: 'variable' })),
          '=',
          seq([any('2px'), any('3px')])
        ]),
        rules: [
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ]
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.match'),
          rules: [
            call({
              name: ref({ key: '.rest-guard' }, { type: 'mixin' }),
              args: list([any('1px'), any('2px'), any('3px')])
            })
          ]
        }),
        ruleset({
          selector: el('.miss'),
          rules: [
            call({
              name: ref({ key: '.rest-guard' }, { type: 'mixin' }),
              args: list([any('1px'), any('4px'), any('5px')])
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .match {
          margin: 2px 3px;
        }
      `);
    });

    it('should call a mixin that calls another mixin', async () => {
      // Create a base mixin: .base-mixin(@color) { color: @color; }
      const baseMixin = mixin({
        name: '.base-mixin',
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ]
      });

      // Create a mixin that calls the base mixin: .wrapper-mixin(@color) { .base-mixin(@color); }
      const wrapperMixin = mixin({
        name: '.wrapper-mixin',
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: [
          call({
            name: ref({ key: '.base-mixin' }, { type: 'mixin' }),
            args: list([ref({ key: 'color' }, { type: 'variable' })])
          })
        ]
      });

      // Create a ruleset that calls the wrapper mixin: .test { .wrapper-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.wrapper-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      const root = rules([baseMixin, wrapperMixin, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          color: blue;
        }
      `);
    });

    it('should call a mixin with pattern matching by value', async () => {
      // Create mixins with pattern matching: .mixin(red) and .mixin(blue)
      const redMixin = mixin({
        name: '.mixin',
        params: list([
          any('red') // Pattern match - must be exactly 'red'
        ]),
        rules: [
          decl({ name: 'color', value: any('red') })
        ]
      });

      const blueMixin = mixin({
        name: '.mixin',
        params: list([
          any('blue') // Pattern match - must be exactly 'blue'
        ]),
        rules: [
          decl({ name: 'color', value: any('blue') })
        ]
      });

      // Create rulesets that call the mixin with different values
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: [
          call({
            name: ref({ key: '.mixin' }, { type: 'mixin' }),
            args: list([any('red')])
          })
        ]
      });

      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: [
          call({
            name: ref({ key: '.mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ]
      });

      const root = rules([redMixin, blueMixin, testRuleset1, testRuleset2]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test1 {
          color: red;
        }
        .test2 {
          color: blue;
        }
      `);
    });

    it('should call a mixin with rest parameters', async () => {
      // Create a mixin with a rest parameter: .my-mixin(@a, @rest...) { margin: @rest; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          rest('rest') // Rest parameter collects remaining arguments
        ]),
        rules: [
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin with multiple args: .test { .my-mixin(10px, 20px, 30px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')])
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          margin: 20px 30px;
        }
      `);
    });

    it('should call a mixin with unnamed rest parameter (auto-generated name)', async () => {
      // Create a mixin with an unnamed rest parameter: .my-mixin(@a, ...) { margin: @rest; }
      // The name should be auto-generated as "rest"
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          rest(undefined) // Unnamed rest parameter - should auto-generate "rest"
        ]),
        rules: [
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin with multiple args: .test { .my-mixin(10px, 20px, 30px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')])
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /'rest' is not defined/);
    });

    it('should call a mixin with multiple nested compound selectors', async () => {
      // .do .re .mi .fa {
      //   .sol .la {
      //     .si {
      //       color: cyan;
      //     }
      //   }
      // }
      // .mutli-selector-parents {
      //   .do.re.mi.fa.sol.la.si();
      // }
      const node = rules([
        ruleset({
          selector: sel([el('.do'), co(' '), el('.re'), co(' '), el('.mi'), co(' '), el('.fa')]),
          rules: [
            ruleset({
              selector: sel([el('.sol'), co(' '), el('.la')]),
              rules: [
                ruleset({
                  selector: sel([el('.si')]),
                  rules: [
                    decl({ name: 'color', value: any('cyan') })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.mutli-selector-parents'),
          rules: [
            call({ name: ref({ key: compound([el('.do'), el('.re'), el('.mi'), el('.fa'), el('.sol'), el('.la'), el('.si')]) }, { type: 'mixin-ruleset' }) })
          ]
        })
      ]);
      context.opts.output = { ...context.opts.output, collapseNesting: true };
      const css = await renderNodeToString(node, context, { context });
      expect(css).toBeString(`
        .do .re .mi .fa .sol .la .si {
          color: cyan;
        }
        .mutli-selector-parents {
          color: cyan;
        }
      `);
    });

    it('should call a mixin or ruleset with different nesting patterns', async () => {
      Node.prototype.fullRender = false;
      // #theme() {
      //   .dark() {
      //     .navbar() {
      //       @color: cyan;
      //     }
      //   }
      // }
      // #theme.dark.navbar {
      //   @color: blue;
      // }
      // .rule {
      //   #theme.dark.navbar();
      //   background-color: @color;
      // }
      const node = rules([
        mixin({
          name: '#theme',
          rules: [
            mixin({
              name: '.dark',
              rules: [
                mixin({
                  name: '.navbar',
                  rules: [
                    vardecl({ name: 'color', value: any('cyan') })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: [
            vardecl({ name: 'color', value: any('blue') })
          ]
        }),
        ruleset({
          selector: el('.rule'),
          rules: [
            call({ name: ref({ key: ['#theme', '.dark', '.navbar'] }, { type: 'mixin-ruleset' }) }),
            decl({ name: 'background-color', value: ref({ key: 'color' }, { type: 'variable' }) })
          ]
        })
      ]);
      const css = await renderNodeToString(node, context);
      expect(css).toBeString(`
        .rule {
          background-color: cyan;
        }
      `);
    });

    it('should resolve mixin-ruleset lookups against interpolated selector names', async () => {
      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [any('foo')]
      }, { role: 'ident' });
      const node = rules([
        ruleset({
          selector: interpolatedSelector(dynamicClass),
          rules: [
            decl({ name: 'color', value: any('red') })
          ]
        }),
        ruleset({
          selector: el('.out'),
          rules: [
            call({
              name: ref({ key: '.foo' }, { type: 'mixin-ruleset' })
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        .foo {
          color: red;
        }
        .out {
          color: red;
        }
      `);
    });

    it('keeps pseudo selector args isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const dynamicPseudoArg = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        mixin({
          name: '.emit',
          params: list([any('name', { role: 'property' })]),
          rules: [
            ruleset({
              selector: compound([
                pseudo({
                  name: ':is',
                  arg: interpolatedSelector(dynamicPseudoArg)
                })
              ]),
              rules: [
                decl({ name: 'color', value: any('red') })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one :is(.foo)');
      expect(css).toContain('.two :is(.bar)');
      expect(css).not.toContain('.two :is(.foo)');
      expect(css).not.toContain('.one :is(.bar)');
    });

    it('keeps calc-wrapped operation operands isolated across repeated mixin calls', async () => {
      context = new Context({
        leakyRules: true,
        unitMode: 'preserve'
      });

      const node = rules([
        mixin({
          name: '.emit-op',
          params: list([any('scale', { role: 'property' })]),
          rules: [
            decl({
              name: 'width',
              value: op([
                dimension([10, 'px']),
                '*',
                ref({ key: 'scale' }, { type: 'variable' })
              ])
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-op' }, { type: 'mixin' }),
              args: list([dimension([2, 'em'])])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-op' }, { type: 'mixin' }),
              args: list([dimension([3, 'em'])])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context);

      expect(css).toContain('.one {\n  width: calc(20 * 1px * 1em);');
      expect(css).toContain('.two {\n  width: calc(30 * 1px * 1em);');
      expect(css).not.toContain('.two {\n  width: calc(20 * 1px * 1em);');
      expect(css).not.toContain('.one {\n  width: calc(30 * 1px * 1em);');
    });

    it('keeps interpolated selector replacements isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        mixin({
          name: '.emit-interpolated',
          params: list([any('name', { role: 'property' })]),
          rules: [
            ruleset({
              selector: interpolatedSelector(dynamicClass),
              rules: [
                decl({ name: 'color', value: any('red') })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-interpolated' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-interpolated' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one .foo');
      expect(css).toContain('.two .bar');
      expect(css).not.toContain('.one .bar');
      expect(css).not.toContain('.two .foo');
    });

    it('keeps compound selector components isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        mixin({
          name: '.emit-compound',
          params: list([any('name', { role: 'property' })]),
          rules: [
            ruleset({
              selector: compound([
                el('.base'),
                interpolatedSelector(dynamicClass)
              ]),
              rules: [
                decl({ name: 'color', value: any('red') })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-compound' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-compound' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one .base.foo');
      expect(css).toContain('.two .base.bar');
      expect(css).not.toContain('.one .base.bar');
      expect(css).not.toContain('.two .base.foo');
    });

    it('keeps complex selector components isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        mixin({
          name: '.emit-complex',
          params: list([any('name', { role: 'property' })]),
          rules: [
            ruleset({
              selector: sel([
                el('.base'),
                co(' '),
                interpolatedSelector(dynamicClass)
              ]),
              rules: [
                decl({ name: 'color', value: any('red') })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-complex' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-complex' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one .base .foo');
      expect(css).toContain('.two .base .bar');
      expect(css).not.toContain('.one .base .bar');
      expect(css).not.toContain('.two .base .foo');
    });

    it('keeps selector-list items isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        mixin({
          name: '.emit-list',
          params: list([any('name', { role: 'property' })]),
          rules: [
            ruleset({
              selector: sellist([
                pseudo({
                  name: ':is',
                  arg: sellist([
                    interpolatedSelector(dynamicClass),
                    el('.static')
                  ])
                })
              ]),
              rules: [
                decl({ name: 'color', value: any('red') })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-list' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-list' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one .foo');
      expect(css).toContain('.two .bar');
      expect(css).toContain('.one .static');
      expect(css).toContain('.two .static');
      expect(css).not.toContain('.one .bar');
      expect(css).not.toContain('.two .foo');
    });

    it('keeps paren values isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const dynamicValue = interpolated({
        source: INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      });

      const node = rules([
        mixin({
          name: '.emit-paren',
          params: list([any('name', { role: 'property' })]),
          rules: [
            decl({
              name: 'value',
              value: paren(dynamicValue)
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-paren' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-paren' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one {\n  value: (foo);');
      expect(css).toContain('.two {\n  value: (bar);');
      expect(css).not.toContain('.one {\n  value: (bar);');
      expect(css).not.toContain('.two {\n  value: (foo);');
    });

    it('keeps quoted values isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: '.emit-quoted',
          params: list([any('name', { role: 'property' })]),
          rules: [
            decl({
              name: 'value',
              // @ts-expect-error – Reference is not in Quoted's allowed content types but works at runtime
              value: quoted(ref({ key: 'name' }, { type: 'variable' }))
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-quoted' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-quoted' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one {\n  value: "foo";');
      expect(css).toContain('.two {\n  value: "bar";');
      expect(css).not.toContain('.one {\n  value: "bar";');
      expect(css).not.toContain('.two {\n  value: "foo";');
    });

    it('keeps sequence values isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: '.emit-sequence',
          params: list([any('name', { role: 'property' })]),
          rules: [
            decl({
              name: 'value',
              value: seq([ref({ key: 'name' }, { type: 'variable' }), any('tail')])
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-sequence' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-sequence' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one {\n  value: foo tail;');
      expect(css).toContain('.two {\n  value: bar tail;');
      expect(css).not.toContain('.one {\n  value: bar tail;');
      expect(css).not.toContain('.two {\n  value: foo tail;');
    });

    it('keeps declaration values isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: '.emit-decl-value',
          params: list([any('name', { role: 'property' })]),
          rules: [
            decl({
              name: 'value',
              value: ref({ key: 'name' }, { type: 'variable' })
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-decl-value' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-decl-value' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one {\n  value: foo;');
      expect(css).toContain('.two {\n  value: bar;');
      expect(css).not.toContain('.one {\n  value: bar;');
      expect(css).not.toContain('.two {\n  value: foo;');
    });

    it('keeps interpolated declaration names isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const dynamicName = interpolated({
        source: 'prop-' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      });

      const node = rules([
        mixin({
          name: '.emit-decl-name',
          params: list([any('name', { role: 'property' })]),
          rules: [
            decl({
              // @ts-expect-error – Interpolated<AnyRole> is not in DeclarationValue.name type but is valid at runtime
              name: dynamicName,
              value: any('ok')
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-decl-name' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-decl-name' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one {\n  prop-foo: ok;');
      expect(css).toContain('.two {\n  prop-bar: ok;');
      expect(css).not.toContain('.one {\n  prop-bar: ok;');
      expect(css).not.toContain('.two {\n  prop-foo: ok;');
    });

    it('keeps interpolated mixin registration prep wrappers self-owned instead of back-pointing to the canonical mixin', async () => {
      const dynamicMixinName = interpolated({
        source: '.inner-' + INTERPOLATION_PLACEHOLDER,
        replacements: [any('foo')]
      });
      const params = list([any('value', { role: 'property' })]);
      const body = rules([
        decl({ name: 'value', value: any('ok') })
      ]);
      const node = mixin({
        name: dynamicMixinName,
        params,
        rules: body.rules
      });

      const prepared = await node.prepareRegistration(context);

      expect(prepared).not.toBe(node);
      expect(prepared.sourceNode).toBe(prepared);
      expect(prepared.name!.valueOf()).toBe('.inner-foo');
      expect(dynamicMixinName.parent).toBe(node);
      expect(params.parent).toBe(node);
      // New model (Mixin.sourceNode wrapper eliminated): the `rules([...])` wrapper
      // passed as `rules:` is DISCARDED — the Mixin stores/owns its body CHILDREN
      // directly (factory `parentChildren` over childKeys 'rules'), so the child is
      // parented to the Mixin. The wrapper object itself is no longer in the tree.
      expect(node.rules[0]!.parent).toBe(node);
    });

    it('keeps nested interpolated mixin names isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const dynamicMixinName = interpolated({
        source: '.inner-' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      });

      const node = rules([
        mixin({
          name: '.emit-nested-mixin',
          params: list([any('name', { role: 'property' })]),
          rules: [
            mixin({
              name: dynamicMixinName,
              rules: [
                decl({
                  name: 'value',
                  value: ref({ key: 'name' }, { type: 'variable' })
                })
              ]
            }),
            call({
              name: ref({ key: dynamicMixinName }, { type: 'mixin' })
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-nested-mixin' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-nested-mixin' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });
      expect(css).toContain('.one {\n  value: foo;\n}');
      expect(css).toContain('.two {\n  value: bar;\n}');
      expect(css).not.toContain('.inner-foo()');
      expect(css).not.toContain('.inner-bar()');
    });

    it('keeps ampersand append selectors isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: '.emit-amp-append',
          rules: [
            ruleset({
              selector: sel([amp('-suffix')]),
              rules: [
                decl({ name: 'color', value: any('red') })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-amp-append' }, { type: 'mixin' })
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-amp-append' }, { type: 'mixin' })
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one-suffix');
      expect(css).toContain('.two-suffix');
      expect(css).not.toContain('.one.one-suffix');
      expect(css).not.toContain('.two.two-suffix');
    });

    it('keeps bare ampersand selectors isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: true },
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: '.emit-amp-self',
          rules: [
            ruleset({
              selector: sel([amp()]),
              rules: [
                decl({ name: 'color', value: any('red') })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-amp-self' }, { type: 'mixin' })
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-amp-self' }, { type: 'mixin' })
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: true });

      expect(css).toContain('.one {\n  color: red;\n}');
      expect(css).toContain('.two {\n  color: red;\n}');
      expect(css.match(/\.one \{\n  color: red;\n\}/g)).toHaveLength(1);
      expect(css.match(/\.two \{\n  color: red;\n\}/g)).toHaveLength(1);
    });

    it('keeps at-rule preludes isolated across repeated mixin calls', async () => {
      context = new Context({ output: { collapseNesting: false },
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: '.emit-media',
          params: list([any('mode', { role: 'property' })]),
          rules: [
            atrule({
              name: '@media',
              prelude: ref({ key: 'mode' }, { type: 'variable' }),
              rules: [
                decl({
                  name: 'value',
                  value: ref({ key: 'mode' }, { type: 'variable' })
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.one'),
          rules: [
            call({
              name: ref({ key: '.emit-media' }, { type: 'mixin' }),
              args: list([any('screen')])
            })
          ]
        }),
        ruleset({
          selector: el('.two'),
          rules: [
            call({
              name: ref({ key: '.emit-media' }, { type: 'mixin' }),
              args: list([any('print')])
            })
          ]
        })
      ]);
      context.root = node;

      const css = await renderNodeToString(node, context, { collapseNesting: false });

      expect(css).toContain('.one {\n  @media screen {\n    value: screen;');
      expect(css).toContain('.two {\n  @media print {\n    value: print;');
      expect(css).not.toContain('.one {\n  @media print');
      expect(css).not.toContain('.two {\n  @media screen');
    });

    it('should resolve nested mixin-ruleset lookups for local ampersand descendant keys', async () => {
      const root = rules([
        ruleset({
          selector: sel([el('.b'), co(' '), el('.bb')]),
          rules: [
            ruleset({
              selector: sel([
                compound([amp(), el('.foo-xxx')]),
                co(' '),
                compound([el('.yyy-foo'), el('#foo')])
              ]),
              rules: [
                ruleset({
                  selector: sel([amp(), co(' '), compound([el('.foo'), el('.bbb')])]),
                  rules: [
                    decl({ name: 'b', value: any('1') })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('mi-test-b'),
          rules: [
            call({
              name: ref({
                key: ['.b', '.bb', '.foo-xxx', '.yyy-foo', '#foo', '.foo', '.bbb']
              }, { type: 'mixin-ruleset' })
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .b .bb {
          &.foo-xxx .yyy-foo#foo {
            & .foo.bbb {
              b: 1;
            }
          }
        }
        mi-test-b {
          b: 1;
        }
      `);
    });

    it('preserves collapse output for complex parent ampersands and nested array-path ruleset mixin calls', async () => {
      const root = rules([
        ruleset({
          selector: sel([el('.b'), co(' '), el('.bb')]),
          rules: [
            ruleset({
              selector: sel([
                compound([amp(), el('.foo-xxx')]),
                co(' '),
                compound([el('.yyy-foo'), el('#foo')])
              ]),
              rules: [
                ruleset({
                  selector: sel([amp(), co(' '), compound([el('.foo'), el('.bbb')])]),
                  rules: [
                    decl({ name: 'b', value: any('1') })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('#foo-foo'),
          rules: [
            ruleset({
              selector: sel([co('>'), el('.bar')]),
              rules: [
                ruleset({
                  selector: sel([el('.baz')]),
                  rules: [
                    decl({ name: 'c', value: any('c') })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('mi-test-b'),
          rules: [
            call({
              name: ref({
                key: ['.b', '.bb', '.foo-xxx', '.yyy-foo', '#foo', '.foo', '.bbb']
              }, { type: 'mixin-ruleset' })
            })
          ]
        }),
        ruleset({
          selector: el('mi-test-c'),
          rules: [
            ruleset({
              selector: sel([amp('-1')]),
              rules: [
                call({
                  name: ref({ key: '#foo-foo' }, { type: 'mixin-ruleset' })
                })
              ]
            }),
            ruleset({
              selector: sel([amp('-2')]),
              rules: [
                call({
                  name: ref({ key: ['#foo-foo', '.bar'] }, { type: 'mixin-ruleset' })
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('mi-test-c-3'),
          rules: [
            call({
              name: ref({ key: ['#foo-foo', '.bar', '.baz'] }, { type: 'mixin-ruleset' })
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context, { collapseNesting: true });

      expect(css).toBeString(`
        .b .bb.foo-xxx .yyy-foo#foo .foo.bbb {
          b: 1;
        }
        #foo-foo > .bar .baz {
          c: c;
        }
        mi-test-b {
          b: 1;
        }
        mi-test-c-1 > .bar .baz {
          c: c;
        }
        mi-test-c-2 .baz {
          c: c;
        }
        mi-test-c-3 {
          c: c;
        }
      `);
    });
  });

  describe('rest parameter matching and assignment', () => {
    it('should match a mixin with rest parameter and assign empty rest when no extra args provided', async () => {
      // Create a mixin with a rest parameter: .my-mixin(@a, @rest...) { padding: @rest; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: [
          decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin with only the required arg: .test { .my-mixin(10px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px')]) // Only one arg, rest should be empty
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          padding: rest;
        }
      `);
    });

    it('should match a mixin with rest parameter and assign single value to rest', async () => {
      // Create a mixin with a rest parameter: .my-mixin(@a, @rest...) { margin: @rest; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: [
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin with two args: .test { .my-mixin(10px, 20px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px')]) // Rest should contain 20px
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          margin: 20px;
        }
      `);
    });

    it('should match a mixin with rest parameter and assign multiple values to rest', async () => {
      // Create a mixin with a rest parameter: .my-mixin(@a, @rest...) { padding: @rest; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: [
          decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin with many args: .test { .my-mixin(10px, 20px, 30px, 40px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px'), any('40px')]) // Rest should contain 20px, 30px, 40px
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          padding: 20px 30px 40px;
        }
      `);
    });

    it('expands rest call arguments across positional params', async () => {
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' }),
          any('c', { role: 'property' })
        ]),
        rules: [
          decl({ name: 'padding', value: seq([
            ref({ key: 'a' }, { type: 'variable' }),
            ref({ key: 'b' }, { type: 'variable' }),
            ref({ key: 'c' }, { type: 'variable' })
          ]) })
        ]
      });

      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([
              any('10px'),
              rest(seq([any('20px'), any('30px')]))
            ])
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          padding: 10px 20px 30px;
        }
      `);
    });

    it('should match a mixin with rest parameter when multiple required params before rest', async () => {
      // Create a mixin with multiple params before rest: .my-mixin(@a, @b, @rest...) { margin: @rest; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' }),
          rest('rest')
        ]),
        rules: [
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(10px, 20px, 30px, 40px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px'), any('40px')]) // Rest should contain 30px, 40px
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          margin: 30px 40px;
        }
      `);
    });

    it('should use rest variable in multiple declarations within mixin', async () => {
      // Create a mixin that uses rest in multiple places: .my-mixin(@a, @rest...) { margin: @rest; padding: @rest; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: [
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) }),
          decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(10px, 20px, 30px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')])
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test {
          margin: 20px 30px;
          padding: 20px 30px;
        }
      `);
    });

    it('should match mixin with rest parameter over mixin without rest when both exist', async () => {
      // Create a mixin without rest: .my-mixin(@a, @b) { color: red; }
      const mixinWithoutRest = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' })
        ]),
        rules: [
          decl({ name: 'color', value: any('red') })
        ]
      });

      // Create a mixin with rest: .my-mixin(@a, @rest...) { color: blue; }
      const mixinWithRest = mixin({
        name: '.my-mixin',
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: [
          decl({ name: 'color', value: any('blue') })
        ]
      });

      // Create a ruleset that calls with exact 2 args: .test1 { .my-mixin(10px, 20px); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px')]) // Matches mixinWithoutRest exactly
          })
        ]
      });

      // Create a ruleset that calls with 3 args: .test2 { .my-mixin(10px, 20px, 30px); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')]) // Should match mixinWithRest
          })
        ]
      });

      const root = rules([mixinWithoutRest, mixinWithRest, testRuleset1, testRuleset2]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toBeString(`
        .test1 {
          color: red;
          color: blue;
        }
        .test2 {
          color: blue;
        }
      `);
    });
  });

  describe('arity failures', () => {
    it('should fail when calling a mixin with too few arguments (missing required parameter)', async () => {
      // Create a mixin with a required parameter: .my-mixin(@color) { color: @color; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('color', { role: 'property' }) // Required parameter without default
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin without args: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('should fail when calling a mixin with too few arguments (multiple required parameters)', async () => {
      // Create a mixin with multiple required parameters: .my-mixin(@color, @size) { color: @color; font-size: @size; }
      const mixinDef = mixin({
        name: '.my-mixin',
        params: list([
          any('color', { role: 'property' }),
          any('size', { role: 'property' })
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          decl({ name: 'font-size', value: ref({ key: 'size' }, { type: 'variable' }) })
        ]
      });

      // Create a ruleset that calls the mixin with only one arg: .test { .my-mixin(red); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('red')]) // Only one argument, but two are required
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('should fail when calling a mixin with no parameters but providing arguments', async () => {
      // Create a mixin with no parameters: .my-mixin() { color: red; }
      const mixinDef = mixin({
        name: '.my-mixin',
        rules: [
          decl({ name: 'color', value: any('red') })
        ]
      });

      // Create a ruleset that calls the mixin with args: .test { .my-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: [
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')]) // One argument, but mixin has no parameters
          })
        ]
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('keeps param vars preferred over outer same-name vars in lazy nested mixin lookups', async () => {
      const root = rules([
        vardecl({ name: 'gender_', value: any('"Outer"') }),
        mixin({
          name: '.Person',
          params: list([
            any('name', { role: 'property' }),
            any('gender_', { role: 'property' })
          ]),
          rules: [
            ruleset({
              selector: el('.person'),
              rules: [
                vardecl({
                  name: 'gender',
                  value: ref({ key: 'gender_' }, { type: 'variable' })
                }),
                mixin({
                  name: '.sayGender',
                  rules: [
                    decl({
                      name: 'gender',
                      value: ref({ key: 'gender' }, { type: 'variable' })
                    })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.test'),
          rules: [
            call({
              name: ref({ key: '.Person' }, { type: 'mixin' }),
              args: list([any('person'), any('"Male"')])
            }),
            call({
              name: ref({ key: ['.person', '.sayGender'] }, { type: 'mixin-ruleset' })
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('gender: "Male";');
      expect(css).not.toContain('gender: "Outer";');
      expect(css).not.toContain('.person {\n}');
    });

    it('does not emit an empty interpolated selector frame when a nested mixin consumes its scope', async () => {
      const root = rules([
        vardecl({ name: 'gender_', value: any('"Outer"') }),
        mixin({
          name: '.Person',
          params: list([
            any('name', { role: 'property' }),
            any('gender_', { role: 'property' })
          ]),
          rules: [
            ruleset({
              selector: interpolatedSelector(interpolated({
                source: '.' + INTERPOLATION_PLACEHOLDER,
                replacements: [ref({ key: 'name' }, { type: 'variable' })]
              })),
              rules: [
                vardecl({
                  name: 'gender',
                  value: ref({ key: 'gender_' }, { type: 'variable' })
                }),
                mixin({
                  name: '.sayGender',
                  rules: [
                    decl({
                      name: 'gender',
                      value: ref({ key: 'gender' }, { type: 'variable' })
                    })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('.test'),
          rules: [
            call({
              name: ref({ key: '.Person' }, { type: 'mixin' }),
              args: list([any('person'), any('"Male"')])
            }),
            call({
              name: ref({ key: ['.person', '.sayGender'] }, { type: 'mixin-ruleset' })
            })
          ]
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context, { collapseNesting: true });

      expect(css).toContain('gender: "Male";');
      expect(css).not.toContain('.person {\n}');
      expect(css).not.toContain('.test .person {\n}');
    });

    it('does not emit an empty interpolated selector frame on context-bound serialization', async () => {
      const root = rules([
        vardecl({ name: 'gender_', value: any('"Outer"') }),
        mixin({
          name: '.Person',
          params: list([
            any('name', { role: 'property' }),
            any('gender_', { role: 'property' })
          ]),
          rules: [
            ruleset({
              selector: interpolatedSelector(interpolated({
                source: '.' + INTERPOLATION_PLACEHOLDER,
                replacements: [ref({ key: 'name' }, { type: 'variable' })]
              })),
              rules: [
                vardecl({
                  name: 'gender',
                  value: ref({ key: 'gender_' }, { type: 'variable' })
                }),
                mixin({
                  name: '.sayGender',
                  rules: [
                    decl({
                      name: 'gender',
                      value: ref({ key: 'gender' }, { type: 'variable' })
                    })
                  ]
                })
              ]
            })
          ]
        }),
        ruleset({
          selector: el('mi-test-d'),
          rules: [
            call({
              name: ref({ key: '.Person' }, { type: 'mixin' }),
              args: list([any('person'), any('"Male"')])
            }),
            call({
              name: ref({ key: ['.person', '.sayGender'] }, { type: 'mixin-ruleset' })
            })
          ]
        })
      ]);
      context.root = root;
      context.opts.output = { ...context.opts.output, collapseNesting: true };

      const css = await renderNodeToString(root, context, { context });

      expect(css).toContain('mi-test-d {\n  gender: "Male";\n}');
      expect(css).not.toContain('mi-test-d .person {\n}');
    });

    it('keeps sibling collapsed rulesets closed before a later interpolated mixin-ruleset call', async () => {
      const { Parser } = await import('../../../../less-parser/src/index.js');
      const parser = new Parser();
      const tree = parser.parse(`
        @a1: foo;
        @a2: ~".foo";
        @a4: ~"#foo";

        .b .bb {
          &.@{a1}-xxx .yyy-@{a1}@{a4} {
            & @{a2}.bbb {
              b: 1;
            }
          }
        }

        mi-test-b {
          .b.bb.foo-xxx.yyy-foo#foo.foo.bbb();
        }

        @c1: @a1;
        @c2: bar;
        @c3: baz;

        #@{c1}-foo {
          > .@{c2} {
            .@{c3} {
              c: c;
            }
          }
        }

        mi-test-c {
          &-1 {#foo-foo();}
          &-2 {#foo-foo > .bar();}
          &-3 {#foo-foo > .bar.baz();}
        }

        .Person(@name, @gender_) {
          .@{name} {
            @gender: @gender_;
            .sayGender() {
              gender: @gender;
            }
          }
        }

        mi-test-d {
          .Person(person, "Male");
          .person.sayGender();
        }
      `).tree;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const typedTree5 = tree as unknown as RulesClass;
      context.root = typedTree5;
      context.opts.output = { ...context.opts.output, collapseNesting: true };

      const css = await renderNodeToString(typedTree5, context, { context });

      expect(css).toBeString(`
        .b .bb.foo-xxx .yyy-foo#foo .foo.bbb {
          b: 1;
        }
        mi-test-b {
          b: 1;
        }
        #foo-foo > .bar .baz {
          c: c;
        }
        mi-test-c-1 > .bar .baz {
          c: c;
        }
        mi-test-c-2 .baz {
          c: c;
        }
        mi-test-c-3 {
          c: c;
        }
        mi-test-d {
          gender: "Male";
        }
      `);
    });
  });

  describe('serialization', () => {
    it('should serialize a mixin', () => {
      const rule = mixin({
        name: 'myMixin',
        rules: [
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ]
      });
      expect(rule.toTrimmedString()).toBeString(`
        myMixin() {
          color: black;
          background-color: white;
        }
      `);
    });

    it('should serialize a mixin with args', () => {
      const rule = mixin({
        name: 'my-mixin',
        params: list([
          vardecl({ name: 'a', value: any('black') }, { paramVar: true }),
          vardecl({ name: 'b', value: any('white') }, { paramVar: true })
        ], { sep: ';' }),
        rules: [
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ]
      });
      expect(rule.toTrimmedString()).toBeString(`
        my-mixin($a: black; $b: white) {
          color: black;
          background-color: white;
        }
      `);
    });

    it('should serialize a guard', () => {
      const rule = mixin({
        name: 'my-mixin',
        params: list([
          vardecl({ name: 'a', value: any('black') }, { paramVar: true }),
          vardecl({ name: 'b', value: any('white') }, { paramVar: true })
        ], { sep: ';' }),
        guard: condition([expr(ref({ key: 'a' })), '=', expr(ref({ key: 'b' }))]),
        rules: [
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ]
      });
      expect(rule.toTrimmedString()).toBeString(`
        my-mixin($a: black; $b: white) when ($($a) = $($b)) {
          color: black;
          background-color: white;
        }
      `);
    });
  });

  // it('should serialize to a module', () => {
  //   let rule = mixin({
  //     name: ident('myMixin'),
  //     value: ruleset([
  //       decl({ name: 'color', value: any('black') }),
  //       decl({ name: 'background-color', value: any('white') })
  //     ])
  //   })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     'let myMixin = function() { return $J.ruleset(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: $J.any("color"),\n      value: $J.any("black")\n    }))\n    $OUT.push($J.decl({\n      name: $J.any("background-color"),\n      value: $J.any("white")\n    }))\n    return $OUT\n  })()\n)}'
  //   )
  //   expect(rule.value.obj()).toEqual({
  //     color: 'black',
  //     'background-color': 'white'
  //   })
  // })
});
