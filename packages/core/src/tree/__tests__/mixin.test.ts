import { mixin, rules, el, decl, any, condition, expr, ref, list, vardecl, Node, call, ruleset, rest, sel, co, compound, sellist, interpolated, interpolatedSelector, INTERPOLATION_PLACEHOLDER, amp, pseudo, paren, dimension, op, quoted, seq, atrule, defaultguard, Rules as RulesClass, comment, Any, Bool, bool } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { resolveFrameCell } from '../scope-frame.js';
import { MixinRegistry } from '../util/registry-utils.js';
import { renderNodeToString } from '../util/render-buffer.js';
import {
  attachMixinOutputSlot,
  canEnterMixinOutputForLookup,
  canEnterRulesEntryForLookup,
  getMixinOutputChildForSource,
  getMixinOutputSourceChild,
  getMixinOutputSourceChildren,
  getMixinOutputSourceIndex,
  getRulesetMixinPlacementSourceIndex
} from '../util/mixin-output-slot.js';

let context: Context;

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
      name: any('.button'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBeString(`
      .button() {
        color: red;
      }
    `);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('prepares mixin identity without pre-evaluating the body', async () => {
    const bodyDecl = decl({ name: 'color', value: any('red') });
    const body = rules([bodyDecl]);
    const node = mixin({
      name: any('.button'),
      rules: body
    });

    const prepared = await node.prepareRegistration(context);

    expect(prepared.registrationPrepared).toBe(true);
    expect(body.registrationPrepared).toBe(false);
    expect(bodyDecl.registrationPrepared).toBe(false);
  });

  describe('calling', () => {
    it('should call a simple mixin', async () => {
      // Create a mixin definition: .my-mixin() { color: red; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ])
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
        name: any('.commented'),
        rules: rules([
          comment('/**/'),
          decl({ name: 'color', value: any('red') })
        ])
      });
      const firstRuleset = ruleset({
        selector: el('.first'),
        rules: rules([
          call({ name: ref({ key: '.commented' }, { type: 'mixin' }) })
        ])
      });
      const secondRuleset = ruleset({
        selector: el('.second'),
        rules: rules([
          call({ name: ref({ key: '.commented' }, { type: 'mixin' }) })
        ])
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
        name: any('.repeat'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.use'),
          rules: rules([
            call({ name: ref({ key: '.repeat' }, { type: 'mixin' }) }),
            call({ name: ref({ key: '.repeat' }, { type: 'mixin' }) })
          ])
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
            name: any('.commented'),
            rules: mixinBody
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({ name: ref({ key: '.commented' }, { type: 'mixin' }) })
            ])
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
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin-ruleset' }) }) // Use 'mixin-ruleset' to find both Mixins and Rulesets
        ])
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
        const callerRules = rules([]);
        const root = rules([
          ruleset({
            selector: el('.my-mixin'),
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          }),
          ruleset({
            selector: el('.test'),
            rules: callerRules
          })
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
      const sourceValue = any('red');
      const sourceDecl = decl({ name: 'color', value: sourceValue });
      const sourceBody = rules([sourceDecl]);
      const sourceRuleset = ruleset({
        selector: el('.my-mixin'),
        rules: sourceBody
      });
      const callerRules = rules([]);
      const root = rules([
        sourceRuleset,
        ruleset({
          selector: el('.test'),
          rules: callerRules
        })
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
      const outputDecl = result.value[0];
      expect(outputDecl).not.toBe(sourceDecl);
      expect(getMixinOutputSourceChild(result, outputDecl!)).toBe(sourceDecl);
      expect(getMixinOutputChildForSource(result, sourceDecl)).toBe(outputDecl);
      expect(result.options.mixinOutputSlot?.rulesetPlacement?.sourceRules).toBe(sourceBody);
      expect(result.options.mixinOutputSlot?.rulesetPlacement?.outputRules).toBe(result);
      expect(outputDecl?.parent).toBe(result);
      expect(sourceDecl.parent).toBe(sourceBody);
      expect(sourceValue.parent).toBe(sourceDecl);
    });

    it('keeps ruleset-as-mixin nested placement order mapped through the slot', async () => {
      const sourceComment = comment('/* placement */');
      const sourceNested = ruleset({
        selector: el('.nested'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const sourceBody = rules([
        sourceComment,
        sourceNested
      ]);
      const sourceRuleset = ruleset({
        selector: el('.my-mixin'),
        rules: sourceBody
      });
      const callerRules = rules([]);
      const root = rules([
        sourceRuleset,
        ruleset({
          selector: el('.test'),
          rules: callerRules
        })
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
      expect(getMixinOutputSourceChildren(result)).toEqual(sourceBody.value);
      expect(result.value.map(child => getMixinOutputSourceChild(result, child))).toEqual(sourceBody.value);
      expect(sourceBody.value.map(source => getMixinOutputChildForSource(result, source))).toEqual(result.value);
      expect(result.options.mixinOutputSlot?.rulesetPlacement?.childSegments.map(segment => segment.source)).toEqual(sourceBody.value);
      expect(result.options.mixinOutputSlot?.rulesetPlacement?.childSegments.map(segment => segment.output)).toEqual(result.value);
      expect(result.value.map(child => getRulesetMixinPlacementSourceIndex(result, child))).toEqual([0, 1]);
      expect(result.value.map(child => result.options.mixinOutputSlot?.rulesetPlacement?.sourceIndexByOutput.get(child))).toEqual([0, 1]);
      expect(result.value[0]).not.toBe(sourceComment);
      expect(result.value[1]).not.toBe(sourceNested);
      expect(sourceComment.parent).toBe(sourceBody);
      expect(sourceNested.parent).toBe(sourceBody);
      expect(result.value.map(child => child.parent)).toEqual([result, result]);
    });

    it('should call a mixin with parameters', async () => {
      // Create a mixin with a parameter: .my-mixin(@color) { color: @color; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' }) // Parameter without default is Any with role: 'property' (like variable names)
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          vardecl({ name: 'color', value: any('red') }, { paramVar: true })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin without args: .test { .my-mixin(); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ])
      });

      // Create a ruleset that calls the mixin with args: .test2 { .my-mixin(blue); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
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
        name: any('.hover'),
        params: list([any('content', { role: 'property' })]),
        rules: rules([
          ruleset({
            selector: compound([amp(), el(':hover')]),
            rules: rules([
              call({ name: ref({ key: 'content' }, { type: 'variable' }) })
            ])
          })
        ])
      });

      // Build #table-row-variant(@background) {
      //   @hover-background: darken(@background, 5%);
      //   .hover({ background-color: @hover-background; });
      // }
      // Simplified: use a literal value for @hover-background default
      const tableRowVariantMixin = mixin({
        name: any('.table-row-variant'),
        params: list([any('background', { role: 'property' })]),
        rules: rules([
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
        ])
      });

      const component = ruleset({
        selector: el('.table-primary'),
        rules: rules([
          call({
            name: ref({ key: '.table-row-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
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
        name: any('.hover'),
        params: list([any('content', { role: 'property' })]),
        rules: rules([
          ruleset({
            selector: compound([amp(), el(':hover')]),
            rules: rules([
              call({ name: ref({ key: 'content' }, { type: 'variable' }) })
            ])
          })
        ])
      });

      const tableRowVariantMixin = mixin({
        name: any('.table-row-variant'),
        params: list([any('background', { role: 'property' })]),
        rules: rules([
          // @hover-background: @background (local body var, at outer mixin level)
          vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
          // .table-hover { .hover({ background-color: @hover-background; }); }
          ruleset({
            selector: el('.table-hover'),
            rules: rules([
              call({
                name: ref({ key: '.hover' }, { type: 'mixin' }),
                args: list([
                  rules([
                    decl({ name: 'background-color', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
                  ])
                ])
              })
            ])
          })
        ])
      });

      const component = ruleset({
        selector: el('.table-primary'),
        rules: rules([
          call({
            name: ref({ key: '.table-row-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
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
        name: any('.table-row-variant'),
        params: list([any('background', { role: 'property' })]),
        rules: rules([
          vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
          vardecl({
            name: 'hover-content',
            value: rules([
              decl({ name: 'background-color', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
            ])
          }),
          call({ name: ref({ key: 'hover-content' }, { type: 'variable' }) })
        ])
      });

      const component = ruleset({
        selector: el('.table-primary'),
        rules: rules([
          call({
            name: ref({ key: '.table-row-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
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
        const callerRules = rules([]);
        const root = rules([
          vardecl({
            name: 'content',
            value: rules([
              decl({ name: 'color', value: any('red') })
            ])
          }),
          ruleset({
            selector: el('.test'),
            rules: callerRules
          })
        ]);
        context.root = root;
        context.rulesContext = callerRules;

        const detachedCall = call({ name: ref({ key: 'content' }, { type: 'variable' }) });
        callerRules.adopt(detachedCall);
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
          && this.value.some(node => (
            node.type === 'Declaration'
            && node.value?.name?.valueOf?.() === 'color'
          ))
        ) {
          detachedRuleClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const callerRules = rules([]);
        const root = rules([
          vardecl({
            name: 'content',
            value: rules([
              decl({ name: 'color', value: any('red') })
            ])
          }),
          ruleset({
            selector: el('.test'),
            rules: callerRules
          })
        ]);
        context.root = root;
        context.rulesContext = callerRules;

        const detachedCall = call({ name: ref({ key: 'content' }, { type: 'variable' }) });
        callerRules.adopt(detachedCall);
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
        name: any('.table-row-variant'),
        params: list([any('background', { role: 'property' })]),
        rules: rules([
          vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
          vardecl({
            name: 'hover-content',
            value: rules([
              decl({ name: 'background-color', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.table-hover'),
            rules: rules([
              call({ name: ref({ key: 'hover-content' }, { type: 'variable' }) })
            ])
          })
        ])
      });

      const component = ruleset({
        selector: el('.table-primary'),
        rules: rules([
          call({
            name: ref({ key: '.table-row-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
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
        name: any('.table-row-variant'),
        params: list([any('background', { role: 'property' })]),
        rules: rules([
          vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
          vardecl({
            name: 'hover-content',
            value: rules([
              decl({ name: 'background-color', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
            ])
          }),
          call({ name: ref({ key: 'hover-content' }, { type: 'variable' }) })
        ])
      });

      const component = ruleset({
        selector: el('.table-primary'),
        rules: rules([
          call({
            name: ref({ key: '.table-row-variant' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
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
        name: any('.responsive-mixin'),
        params: list([
          vardecl({ name: 'size', value: any('14px') }, { paramVar: true }),
          vardecl({ name: 'weight', value: any('normal') }, { paramVar: true })
        ]),
        rules: mixinBody
      });
      const importedRoot = rules([importedMixinDef]);

      // The main file calls the mixin inside a ruleset
      const component = ruleset({
        selector: el('.component'),
        rules: rules([
          call({ name: ref({ key: '.responsive-mixin' }, { type: 'mixin' }) })
        ])
      });

      // Wire the imported root into the main root via push so the registry can find the mixin
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
        name: any('.button-variant'),
        params: list([
          any('background', { role: 'property' }),
          any('border', { role: 'property' }),
          vardecl({ name: 'hover-background', value: any('darken') }, { paramVar: true })
        ]),
        rules: rules([
          decl({ name: 'background-color', value: ref({ key: 'background' }, { type: 'variable' }) }),
          decl({ name: 'border-color', value: ref({ key: 'border' }, { type: 'variable' }) }),
          decl({ name: 'background-hover', value: ref({ key: 'hover-background' }, { type: 'variable' }) })
        ])
      });

      const component = ruleset({
        selector: el('.btn-primary'),
        rules: rules([
          call({
            name: ref({ key: '.button-variant' }, { type: 'mixin' }),
            args: list([any('blue'), any('darkblue')])
          })
        ])
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
        name: any('.setHeight'),
        params: list([
          any('h', { role: 'property' })
        ]),
        rules: rules([
          vardecl({ name: 'height', value: any('1024px') })
        ])
      });

      const useHeight = mixin({
        name: any('.useHeightInMixinCall'),
        params: list([
          any('h', { role: 'property' })
        ]),
        rules: rules([
          ruleset({
            selector: el('.useHeightInMixinCall'),
            rules: rules([
              decl({ name: 'mixin-height', value: ref({ key: 'h' }, { type: 'variable' }) })
            ])
          })
        ])
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
          rules: rules([
            decl({ name: 'height', value: ref({ key: 'height' }, { type: 'variable' }) })
          ])
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
        name: any('.mixin'),
        rules: rules([
          vardecl({ name: 'mix', value: any('#989') })
        ])
      });

      const root = rules([
        setMix,
        vardecl({ name: 'mix', value: any('blue') }),
        ruleset({
          selector: el('.tiny-scope'),
          rules: rules([
            decl({ name: 'color', value: ref({ key: 'mix' }, { type: 'variable' }) }),
            call({ name: ref({ key: '.mixin' }, { type: 'mixin' }) })
          ])
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
        name: any('.mixinNoParam'),
        params: list([
          vardecl({ name: 'parameter', value: ref({ key: 'parameterDefault' }, { type: 'variable' }) }, { paramVar: true })
        ]),
        guard: condition([
          ref({ key: 'parameter' }, { type: 'variable' }),
          '=',
          any('top level')
        ]),
        rules: rules([
          decl({ name: 'default', value: ref({ key: 'parameter' }, { type: 'variable' }) }),
          comment('/* source order */'),
          decl({ name: 'scope', value: ref({ key: 'anotherVariable' }, { type: 'variable' }) }),
          decl({ name: 'sub-scope-only', value: ref({ key: 'subScopeOnly' }, { type: 'variable' }) })
        ])
      });

      const root = rules([
        vardecl({ name: 'parameterDefault', value: any('top level') }),
        vardecl({ name: 'anotherVariable', value: any('top level') }),
        mixinNoParam,
        ruleset({
          selector: el('#allAreUsedHere'),
          rules: rules([
            vardecl({ name: 'parameterDefault', value: any('inside') }),
            vardecl({ name: 'anotherVariable', value: any('inside') }),
            vardecl({ name: 'subScopeOnly', value: any('inside') }),
            call({ name: ref({ key: '.mixinNoParam' }, { type: 'mixin' }) })
          ])
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
        name: any('.mixinNoParam'),
        params: list([
          vardecl({ name: 'parameter', value: ref({ key: 'parameterDefault' }, { type: 'variable' }) }, { paramVar: true })
        ]),
        guard: condition([
          ref({ key: 'parameter' }, { type: 'variable' }),
          '=',
          any('top level')
        ]),
        rules: rules([
          decl({ name: 'default', value: ref({ key: 'parameter' }, { type: 'variable' }) }),
          decl({ name: 'scope', value: ref({ key: 'anotherVariable' }, { type: 'variable' }) }),
          decl({ name: 'sub-scope-only', value: ref({ key: 'subScopeOnly' }, { type: 'variable' }) })
        ])
      });
      const mixinBody = mixinNoParam.value.rules;

      const callerRules = rules([
        vardecl({ name: 'parameterDefault', value: any('inside') }),
        vardecl({ name: 'anotherVariable', value: any('inside') }),
        vardecl({ name: 'subScopeOnly', value: any('inside') })
      ]);

      const root = rules([
        vardecl({ name: 'parameterDefault', value: any('top level') }),
        vardecl({ name: 'anotherVariable', value: any('top level') }),
        mixinNoParam,
        ruleset({
          selector: el('#allAreUsedHere'),
          rules: callerRules
        })
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
      expect(result.options.mixinOutputSlot?.childSegments.map(segment => ({
        kind: segment.kind,
        source: segment.source,
        output: segment.output,
        index: segment.index
      }))).toEqual(mixinBody.value.map((source, index) => ({
        kind: 'source-child',
        source,
        output: result.value[index],
        index
      })));
      expect(result.value.map(child => getMixinOutputSourceChild(result, child))).toEqual(mixinBody.value);
      expect(getMixinOutputSourceChildren(result)).toEqual(mixinBody.value);
      expect(mixinBody.value.map(source => getMixinOutputChildForSource(result, source))).toEqual(result.value);
      expect(result.value.map(child => result.options.mixinOutputSlot?.sourceIndexByOutput.get(child))).toEqual([0, 1, 2]);
      expect(result.value.map(child => getMixinOutputSourceIndex(result, child))).toEqual([0, 1, 2]);
      expect(result.options.mixinOutputSlot?.rulesetPlacement).toBeUndefined();
      expect(result.value.map(child => Reflect.get(child, 'index'))).toEqual([0, 1, 2]);
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
      expect(secondResult.value).not.toBe(result.value);
      expect(secondResult.options.referenceMode).toBe(false);
      expect(secondResult.options.mixinOutputSlot?.ambientLookup).toBe(true);
      expect(secondResult.value.map(child => getMixinOutputSourceChild(secondResult, child))).toEqual(mixinBody.value);
      expect(getMixinOutputSourceChildren(secondResult)).toEqual(mixinBody.value);
      expect(mixinBody.value.map(source => getMixinOutputChildForSource(secondResult, source))).toEqual(secondResult.value);
      expect(secondResult.value.map(child => secondResult.options.mixinOutputSlot?.sourceIndexByOutput.get(child))).toEqual([0, 1, 2]);
      expect(secondResult.value.map(child => getMixinOutputSourceIndex(secondResult, child))).toEqual([0, 1, 2]);
      expect(secondResult.options.mixinOutputSlot?.rulesetPlacement).toBeUndefined();
      expect(secondResult.value.map(child => Reflect.get(child, 'index'))).toEqual([0, 1, 2]);
      expect(secondResult.value.map((child, index) => child === result.value[index])).toEqual(
        mixinBody.value.map(() => false)
      );
    });

    it('keeps mixin-output entry traversal lookup-owned and type-specific', () => {
      const source = rules([
        decl({ name: 'color', value: any('red') })
      ]);
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
      attachMixinOutputSlot(output, source, true);
      const entry = { node: output };

      expect(output.options.referenceMode).toBe(false);
      expect(canEnterMixinOutputForLookup(entry, { type: 'VarDeclaration', hasTarget: false })).toBe(false);
      expect(canEnterMixinOutputForLookup(entry, { type: 'VarDeclaration', hasTarget: true })).toBe(true);
      expect(canEnterRulesEntryForLookup(entry, { type: 'VarDeclaration', hasTarget: true })).toBe(false);
      expect(canEnterRulesEntryForLookup(entry, { type: 'Mixin', hasTarget: true })).toBe(true);

      output.options.rulesVisibility.VarDeclaration = 'public';
      expect(canEnterRulesEntryForLookup(entry, { type: 'VarDeclaration', hasTarget: true })).toBe(true);
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
          && this.value.some(node => (
            node.type === 'Declaration'
            && node.value?.name?.valueOf?.() === 'marker'
          ))
        ) {
          shallowMarkerBodyClones++;
        }
        return originalClone.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: any('.guarded'),
            params: list([any('color', { role: 'property' })]),
            guard: condition([
              ref({ key: 'color' }, { type: 'variable' }),
              '=',
              any('red')
            ]),
            rules: rules([
              decl({ name: 'marker', value: ref({ key: 'color' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.guarded' }, { type: 'mixin' }),
                args: list([any('red')])
              })
            ])
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('marker: red;');
        expect(shallowMarkerBodyClones).toBe(0);
      } finally {
        RulesClass.prototype.clone = originalClone;
      }
    });

    it('does not copy childless evaluated scalar args just to bind mixin params', async () => {
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
        const root = rules([
          mixin({
            name: any('.noop'),
            params: list([any('color', { role: 'property' })]),
            rules: rules([])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.noop' }, { type: 'mixin' }),
                args: list([any('red')])
              })
            ])
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toBe('');
        expect(scalarCopies).toBe(0);
      } finally {
        Any.prototype.copy = originalCopy;
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
            name: any('.paint'),
            rules: rules([
              decl({ name: 'color', value: any('red') }),
              decl({ name: 'border-color', value: ref({ key: 'borderColor' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.test'),
            rules: rules([
              call({ name: ref({ key: '.paint' }, { type: 'mixin' }) })
            ])
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
        const root = rules([
          mixin({
            name: any('.use-color'),
            params: list([any('color', { role: 'property' })]),
            rules: rules([
              decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.use-color' }, { type: 'mixin' }),
                args: list([any('red')])
              })
            ])
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('color: red;');
        expect(scalarCopies).toBe(0);
      } finally {
        Any.prototype.copy = originalCopy;
      }
    });

    it('does not copy childless static default params just to bind mixin params', async () => {
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
        const root = rules([
          mixin({
            name: any('.noop'),
            params: list([
              vardecl({ name: 'color', value: any('red') }, { paramVar: true })
            ]),
            rules: rules([])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.noop' }, { type: 'mixin' })
              })
            ])
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toBe('');
        expect(scalarCopies).toBe(0);
      } finally {
        Any.prototype.copy = originalCopy;
      }
    });

    it('should call a mixin with multiple parameters', async () => {
      // Create a mixin with multiple parameters: .my-mixin(@color, @size) { color: @color; font-size: @size; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' }),
          any('size', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          decl({ name: 'font-size', value: ref({ key: 'size' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(blue, 16px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue'), any('16px')])
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'arguments' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(10px, 20px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px')])
          })
        ])
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
        const root = rules([
          mixin({
            name: any('.args'),
            params: list([
              any('color', { role: 'property' }),
              any('size', { role: 'property' })
            ]),
            rules: rules([
              decl({ name: 'margin', value: ref({ key: 'arguments' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.args' }, { type: 'mixin' }),
                args: list([any('red'), any('10px')])
              })
            ])
          })
        ]);
        context.root = root;

        const evald = await root.eval(context);
        const css = await evald.render(context);

        expect(css).toContain('margin: red 10px;');
        expect(scalarCopies).toBe(0);
      } finally {
        Any.prototype.copy = originalCopy;
      }
    });

    it('does not copy childless scalar rest param values when resolving rest slots', async () => {
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
        const root = rules([
          mixin({
            name: any('.resty'),
            params: list([
              any('first', { role: 'property' }),
              rest('rest')
            ]),
            rules: rules([
              decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.resty' }, { type: 'mixin' }),
                args: list([any('0'), any('red'), any('10px')])
              })
            ])
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('margin: red 10px;');
        expect(scalarCopies).toBe(0);
      } finally {
        Any.prototype.copy = originalCopy;
      }
    });

    it('keeps default param containers owned without reparenting the source container', async () => {
      const defaultValue = seq([any('red'), any('10px')]);
      const param = vardecl({ name: 'space', value: defaultValue }, { paramVar: true });
      const root = rules([
        mixin({
          name: any('.container-default'),
          params: list([param]),
          rules: rules([])
        }),
        ruleset({
          selector: el('.use'),
          rules: rules([
            call({
              name: ref({ key: '.container-default' }, { type: 'mixin' })
            })
          ])
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);
      expect(css).toBe('');
      expect(defaultValue.parent).toBe(param);
      expect(param.parent?.parent).toBe(root.value[0]);
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
            name: any('.container-param'),
            params: list([any('space', { role: 'property' })]),
            rules: rules([
              decl({ name: 'margin', value: ref({ key: 'space' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.container-param' }, { type: 'mixin' }),
                args: list([seq([any('red'), any('10px')])])
              })
            ])
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
            name: any('.container-param'),
            params: list([any('space', { role: 'property' })]),
            rules: rules([
              decl({ name: 'margin', value: ref({ key: 'space' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.container-param' }, { type: 'mixin' }),
                args: list([
                  vardecl({ name: 'space', value: seq([any('red'), any('10px')]) }, { paramVar: true })
                ])
              })
            ])
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
            name: any('.container-default'),
            params: list([
              vardecl({ name: 'space', value: seq([any('red'), any('10px')]) }, { paramVar: true })
            ]),
            rules: rules([
              decl({ name: 'margin', value: ref({ key: 'space' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.container-default' }, { type: 'mixin' })
              })
            ])
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
            name: any('.resty'),
            params: list([
              any('first', { role: 'property' }),
              rest('rest')
            ]),
            rules: rules([
              decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.resty' }, { type: 'mixin' }),
                args: list([any('0'), seq([any('red'), any('10px')])])
              })
            ])
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
            name: any('.args'),
            params: list([
              any('space', { role: 'property' })
            ]),
            rules: rules([
              decl({ name: 'margin', value: ref({ key: 'arguments' }, { type: 'variable' }) })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.args' }, { type: 'mixin' }),
                args: list([seq([any('red'), any('10px')])])
              })
            ])
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
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key] = args;
        if (type === 'declaration' && typeof key === 'string' && ['color', 'size', 'rest', 'arguments'].includes(key)) {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const mixinDef = mixin({
          name: any('.my-mixin'),
          params: list([
            any('color', { role: 'property' }),
            vardecl({ name: 'size', value: any('16px') }, { paramVar: true }),
            rest('rest')
          ]),
          rules: rules([
            decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
            decl({ name: 'font-size', value: ref({ key: 'size' }, { type: 'variable' }) }),
            decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) }),
            decl({ name: 'margin', value: ref({ key: 'arguments' }, { type: 'variable' }) })
          ])
        });

        const testRuleset = ruleset({
          selector: el('.test'),
          rules: rules([
            call({
              name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
              args: list([any('blue'), any('1px'), any('2px'), any('3px')])
            })
          ])
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
        RulesClass.prototype.find = originalFind;
      }
    });

    it('resolves lexical variable bindings without declaration-registry lookup', async () => {
      context.treeContext = new TreeContext({
        file: {
          name: 'test.less',
          path: '/virtual',
          fullPath: '/virtual/test.less'
        }
      });
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key] = args;
        if (type === 'declaration' && typeof key === 'string' && key === 'base-color') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        // Lexical global: @base-color defined once at root, referenced inside mixin body
        const mixinDef = mixin({
          name: any('.my-mixin'),
          rules: rules([
            decl({ name: 'color', value: ref({ key: 'base-color' }, { type: 'variable' }) }),
            decl({ name: 'border-color', value: ref({ key: 'base-color' }, { type: 'variable' }) }),
            decl({ name: 'outline-color', value: ref({ key: 'base-color' }, { type: 'variable' }) })
          ])
        });

        const root = rules([
          vardecl({ name: 'base-color', value: any('steelblue') }),
          mixinDef,
          ruleset({
            selector: el('.test'),
            rules: rules([
              call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
            ])
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
        // without touching DeclarationRegistry.find at all.
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('ScopeFrame declarationBucketsByName matches registry state after eval', async () => {
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

      // varsByName is populated after eval (via _indexRules during registry access)
      const frame = root.getScopeFrame();

      // Frame should have both declared names
      expect(frame.declarationBucketsByName.has('brand')).toBe(true);
      expect(frame.declarationBucketsByName.has('size')).toBe(true);

      // Last-definition-wins: 'brand' bucket has two entries; last wins
      const brandBucket = frame.declarationBucketsByName.get('brand')!;
      expect(brandBucket).toHaveLength(2);
      expect(brandBucket[brandBucket.length - 1]!.cell.value.valueOf()).toBe('navy');

      // resolveFrameCell should return the same winner as the registry
      const frameResult = resolveFrameCell('brand', frame);
      expect(frameResult).toBeDefined();
      expect(frameResult!.cell.value.valueOf()).toBe('navy');

      const sizeResult = resolveFrameCell('size', frame);
      expect(sizeResult).toBeDefined();
      expect(sizeResult!.cell.value.valueOf()).toBe('16px');

      // A name not in the scope resolves to undefined
      expect(resolveFrameCell('unknown', frame)).toBeUndefined();
    });

    it('mixinsByName fast path: type=mixin static-name lookup skips MixinRegistry.find', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (typeof key === 'string' && key === '.fast-mixin') {
          mixinRegistryHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const mixinDef = mixin({
          name: any('.fast-mixin'),
          rules: rules([decl({ name: 'color', value: any('purple') })])
        });

        const root = rules([
          mixinDef,
          ruleset({
            selector: el('.a'),
            rules: rules([call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin' }) })])
          }),
          ruleset({
            selector: el('.b'),
            rules: rules([call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin' }) })])
          }),
          ruleset({
            selector: el('.c'),
            rules: rules([call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin' }) })])
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
        expect(mixinRegistryHits.length).toBe(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('mixinsByName fast path: type=mixin-ruleset static Mixin hit skips MixinRegistry.find', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (typeof key === 'string' && key === '.fast-mixin') {
          mixinRegistryHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const mixinDef = mixin({
          name: any('.fast-mixin'),
          rules: rules([decl({ name: 'color', value: any('green') })])
        });

        const root = rules([
          mixinDef,
          ruleset({
            selector: el('.a'),
            rules: rules([call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin-ruleset' }) })])
          }),
          ruleset({
            selector: el('.b'),
            rules: rules([call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin-ruleset' }) })])
          }),
          ruleset({
            selector: el('.c'),
            rules: rules([call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin-ruleset' }) })])
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

        expect(mixinRegistryHits.length).toBe(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('mixinsByName fast path: type=mixin-ruleset simple Ruleset hit skips MixinRegistry.find', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (typeof key === 'string' && key === '.fast-ruleset') {
          mixinRegistryHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const root = rules([
          ruleset({
            selector: el('.fast-ruleset'),
            rules: rules([decl({ name: 'color', value: any('green') })])
          }),
          ruleset({
            selector: el('.a'),
            rules: rules([call({ name: ref({ key: '.fast-ruleset' }, { type: 'mixin-ruleset' }) })])
          }),
          ruleset({
            selector: el('.b'),
            rules: rules([call({ name: ref({ key: '.fast-ruleset' }, { type: 'mixin-ruleset' }) })])
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

        expect(mixinRegistryHits.length).toBe(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('mixinsByName fast path: type=mixin resolved interpolated name skips MixinRegistry.find', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (typeof key === 'string' && key === '.fast-mixin') {
          mixinRegistryHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const mixinDef = mixin({
          name: interpolated({
            source: '.' + INTERPOLATION_PLACEHOLDER,
            replacements: [any('fast-mixin')]
          }, { role: 'name' }),
          rules: rules([decl({ name: 'color', value: any('orange') })])
        });

        const root = rules([
          mixinDef,
          ruleset({
            selector: el('.a'),
            rules: rules([call({ name: ref({ key: '.fast-mixin' }, { type: 'mixin' }) })])
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toBeString(`
          .a {
            color: orange;
          }
        `);
        expect(mixinRegistryHits.length).toBe(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('mixinsByName fast path: type=mixin-ruleset resolved interpolated simple name skips MixinRegistry.find', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (typeof key === 'string' && key === '.foo') {
          mixinRegistryHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const dynamicClass = interpolated({
          source: '.' + INTERPOLATION_PLACEHOLDER,
          replacements: [any('foo')]
        }, { role: 'ident' });
        const root = rules([
          ruleset({
            selector: interpolatedSelector(dynamicClass),
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          }),
          ruleset({
            selector: el('.out'),
            rules: rules([
              call({
                name: ref({ key: '.foo' }, { type: 'mixin-ruleset' })
              })
            ])
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
        expect(mixinRegistryHits.length).toBe(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('mixinsByName fast path: type=mixin static-name miss skips MixinRegistry.find once scopes are indexed', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (typeof key === 'string' && key === '.missing-mixin') {
          mixinRegistryHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: any('.other-mixin'),
            rules: rules([decl({ name: 'color', value: any('green') })])
          }),
          ruleset({
            selector: el('.a'),
            rules: rules([
              decl({
                name: 'content',
                value: ref({ key: '.missing-mixin' }, { type: 'mixin', fallbackValue: true })
              })
            ])
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toBeString(`
          .a {
            content: .missing-mixin;
          }
        `);
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('mixinsByName fast path: type=mixin-ruleset simple-name miss skips MixinRegistry.find once scopes are indexed', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (typeof key === 'string' && key === '.missing-ruleset-mixin') {
          mixinRegistryHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: any('.other-mixin'),
            rules: rules([decl({ name: 'color', value: any('green') })])
          }),
          ruleset({
            selector: el('.a'),
            rules: rules([
              decl({
                name: 'content',
                value: ref({ key: '.missing-ruleset-mixin' }, { type: 'mixin-ruleset', fallbackValue: true })
              })
            ])
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toBeString(`
          .a {
            content: .missing-ruleset-mixin;
          }
        `);
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('mixinsByName fast path: unresolved dynamic simple-name candidates do not trigger MixinRegistry.find', () => {
      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (typeof key === 'string' && key === '.missing-mixin') {
          mixinRegistryHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: interpolated({
              source: '.' + INTERPOLATION_PLACEHOLDER,
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }, { role: 'name' }),
            rules: rules([decl({ name: 'color', value: any('orange') })])
          })
        ]);

        const found = root.find('mixin', '.missing-mixin');
        expect(found).toBeUndefined();
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('namespace fast path: unresolved dynamic namespace segments do not trigger MixinRegistry.find', () => {
      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#theme') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: any('#theme'),
            rules: rules([
              mixin({
                name: interpolated({
                  source: INTERPOLATION_PLACEHOLDER,
                  replacements: [ref({ key: 'segment' }, { type: 'variable' })]
                }, { role: 'name' }),
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

        const found = root.find('mixin', ['#theme', '.dark', '.navbar', '.colors'], undefined, {
          context
        });
        expect(found).toBeUndefined();
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('namespace fast path: type=mixin ignores compound-prefix ruleset ambiguity', () => {
      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#theme') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
        const root = rules([
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
          })
        ]);
        const found = root.find('mixin', ['#theme', '.dark', '.navbar', '.colors'], 'Mixin', {
          context
        });
        expect(found).toHaveLength(1);
        expect(found?.[0]?.type).toBe('Mixin');
        const mixinHit = found?.[0];
        expect(mixinHit?.type === 'Mixin' ? mixinHit.value.name?.valueOf() : undefined).toBe('.colors');
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('namespace fast path: type=mixin misses ignore callable ruleset starts', () => {
      const originalFind = MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#theme') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
        const root = rules([
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
          })
        ]);

        const found = root.find('mixin', ['#theme', '.dark', '.navbar', '.colors'], 'Mixin', {
          context
        });
        expect(found).toBeUndefined();
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        MixinRegistry.prototype.find = originalFind;
      }
    });

    it('namespace fast path: mixin-ruleset path unions plain namespace rulesets with callable namespace mixins', async () => {
      const { Parser } = await import('../../../../less-parser/src/index.ts');
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

      context.root = tree;

      const found = tree.find('mixin', ['#guarded', '#deeper', '.mixin'], undefined, {
        context
      });

      expect(found).toHaveLength(3);

      const css = await renderNodeToString(tree, context, { context });

      expect(css).toContain('#guarded-caller {');
      expect(css).toContain('guarded: namespace;');
      expect(css).toContain('silent: namespace;');
      expect(css).toContain('guarded: with default;');
    });

    it('ScopeFrame live slots resolve param and @arguments via frame chain', async () => {
      context.treeContext = new TreeContext({
        file: { name: 'test.less', path: '/virtual', fullPath: '/virtual/test.less' }
      });

      // Prove params and @arguments are in liveSlotsByName by testing their output.
      // If either were missing from the frame, the reference lookup would fail or
      // fall through to a stale registry path that no longer exists.
      const mixinDef = mixin({
        name: any('.parameterized'),
        params: list([any('color', { role: 'property' })]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          // @arguments is automatically bound in liveSlotsByName.
          decl({ name: 'args', value: ref({ key: 'arguments' }, { type: 'variable' }) })
        ])
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.a'),
          rules: rules([call({
            name: ref({ key: '.parameterized' }, { type: 'mixin-ruleset' }),
            args: list([any('red')])
          })])
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
            name: any('.unused'),
            params: list([
              any('space', { role: 'property' })
            ]),
            rules: rules([
              decl({ name: 'color', value: any('blue') })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.unused' }, { type: 'mixin' }),
                args: list([seq([any('red'), any('10px')])])
              })
            ])
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
            name: any('.unused-rest'),
            params: list([
              any('first', { role: 'property' }),
              rest('rest')
            ]),
            rules: rules([
              decl({ name: 'color', value: any('blue') })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.unused-rest' }, { type: 'mixin' }),
                args: list([any('0'), seq([any('red'), any('10px')])])
              })
            ])
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
            name: any('.unused-arguments'),
            params: list([
              any('space', { role: 'property' })
            ]),
            rules: rules([
              decl({ name: 'color', value: any('blue') })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({
                name: ref({ key: '.unused-arguments' }, { type: 'mixin' }),
                args: list([seq([any('red'), any('10px')])])
              })
            ])
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
          name: any('.named'),
          params: list([
            vardecl({ name: 'a', value: any('1px') }, { paramVar: true }),
            vardecl({ name: 'b', value: any('50%') }, { paramVar: true })
          ]),
          rules: rules([
            decl({ name: 'height', value: ref({ key: 'b' }, { type: 'variable' }) }),
            decl({ name: 'args', value: ref({ key: 'arguments' }, { type: 'variable' }) })
          ])
        }),
        ruleset({
          selector: el('.use'),
          rules: rules([
            vardecl({ name: 'var', value: any('20%') }),
            call({
              name: ref({ key: '.named' }, { type: 'mixin' }),
              args: list([
                vardecl({ name: 'b', value: ref({ key: 'var' }, { type: 'variable' }) }, { paramVar: true })
              ])
            })
          ])
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
        name: any('.colored'),
        params: list([any('color', { role: 'property' })]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          decl({ name: 'border-color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.a'),
          rules: rules([call({
            name: ref({ key: '.colored' }, { type: 'mixin-ruleset' }),
            args: list([any('red')])
          })])
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
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        guard: condition([
          expr(ref({ key: 'color' }, { type: 'variable' })),
          '=',
          any('red')
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with matching condition: .test1 { .my-mixin(red); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('red')])
          })
        ])
      });

      // Create a ruleset that calls the mixin with non-matching condition: .test2 { .my-mixin(blue); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
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

    it('does not copy static bool guards before evaluating candidates', async () => {
      const originalCopy = Bool.prototype.copy;
      let guardCopies = 0;
      Bool.prototype.copy = function copyForCounting(
        this: Bool,
        ...args: Parameters<typeof originalCopy>
      ): ReturnType<typeof originalCopy> {
        guardCopies++;
        return originalCopy.apply(this, args);
      };

      try {
        const root = rules([
          mixin({
            name: any('.guarded'),
            guard: bool(true),
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              call({ name: ref({ key: '.guarded' }, { type: 'mixin' }) })
            ])
          })
        ]);
        context.root = root;

        const css = await renderNodeToString(root, context);
        expect(css).toContain('color: red;');
        expect(guardCopies).toBe(0);
      } finally {
        Bool.prototype.copy = originalCopy;
      }
    });

    it('restores caller rulesContext when static guard evaluation throws', async () => {
      context = new Context({ leakyRules: false });
      const savedRulesContext = rules([]);
      const guard = bool(true);
      guard.eval = (evalContext: Context) => {
        expect(evalContext.rulesContext).not.toBe(savedRulesContext);
        throw new Error('guard eval failed');
      };
      const root = rules([
        mixin({
          name: any('.guarded'),
          guard,
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        }),
        ruleset({
          selector: el('.use'),
          rules: rules([
            call({ name: ref({ key: '.guarded' }, { type: 'mixin' }) })
          ])
        })
      ]);
      context.root = root;
      context.rulesContext = savedRulesContext;

      await expect(renderNodeToString(root, context)).rejects.toThrow('guard eval failed');
      expect(context.rulesContext).toBe(savedRulesContext);
    });

    it('keeps dynamic guards on a copied eval surface', async () => {
      context = new Context({ leakyRules: false });
      const guard = condition([
        expr(ref({ key: 'mode' }, { type: 'variable' })),
        '=',
        any('dark')
      ]);
      const root = rules([
        mixin({
          name: any('.guarded'),
          guard,
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        }),
        ruleset({
          selector: el('.use'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({ name: ref({ key: '.guarded' }, { type: 'mixin' }) })
          ])
        })
      ]);
      context.root = root;

      const css = await renderNodeToString(root, context);

      expect(css).toContain('color: red;');
      expect(guard.evaluated).toBe(false);
      expect(guard.registrationPrepared).toBe(false);
    });

    it('does not clone source-free scalar leaves inside copied dynamic guards', async () => {
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
            name: any('.guarded'),
            guard: condition([
              expr(ref({ key: 'mode' }, { type: 'variable' })),
              '=',
              any('dark')
            ]),
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          }),
          ruleset({
            selector: el('.use'),
            rules: rules([
              vardecl({ name: 'mode', value: any('dark') }),
              call({ name: ref({ key: '.guarded' }, { type: 'mixin' }) })
            ])
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
        name: any('.theme-mixin'),
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
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({
              name: ref({ key: '.theme-mixin' }, { type: 'mixin' }),
              args: list([any('red')])
            })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            call({
              name: ref({ key: '.theme-mixin' }, { type: 'mixin' }),
              args: list([any('red')])
            })
          ])
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
        name: any('.scope-guarded'),
        guard: condition([
          expr(ref({ key: 'mode' }, { type: 'variable' })),
          '=',
          any('dark')
        ]),
        rules: rules([
          decl({ name: 'color', value: any('black') })
        ])
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({ name: ref({ key: '.scope-guarded' }, { type: 'mixin' }) })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            call({ name: ref({ key: '.scope-guarded' }, { type: 'mixin' }) })
          ])
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
        name: any('.scope-guarded-body'),
        guard: condition([
          expr(ref({ key: 'mode' }, { type: 'variable' })),
          '=',
          any('dark')
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'mode' }, { type: 'variable' }) })
        ])
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({ name: ref({ key: '.scope-guarded-body' }, { type: 'mixin' }) })
          ])
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
        name: any('.scope-guarded-body-shadow'),
        guard: condition([
          expr(ref({ key: 'mode' }, { type: 'variable' })),
          '=',
          any('dark')
        ]),
        rules: rules([
          vardecl({ name: 'mode', value: any('light') }),
          decl({ name: 'color', value: any('black') })
        ])
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({ name: ref({ key: '.scope-guarded-body-shadow' }, { type: 'mixin' }) })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            call({ name: ref({ key: '.scope-guarded-body-shadow' }, { type: 'mixin' }) })
          ])
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
        name: any('.guarded-default'),
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
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      const lightDefault = mixin({
        name: any('.guarded-default'),
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
        rules: rules([
          decl({ name: 'background', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      const root = rules([
        darkDefault,
        lightDefault,
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            vardecl({ name: 'color', value: any('outer-dark') }),
            call({
              name: ref({ key: '.guarded-default' }, { type: 'mixin' }),
              args: list([any('red')])
            }),
            decl({ name: 'value', value: ref({ key: 'color' }, { type: 'variable' }) })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            vardecl({ name: 'color', value: any('outer-light') }),
            call({
              name: ref({ key: '.guarded-default' }, { type: 'mixin' }),
              args: list([any('blue')])
            }),
            decl({ name: 'value', value: ref({ key: 'color' }, { type: 'variable' }) })
          ])
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

    it('does not clone source-free scalar leaves inside copied default guard probes', async () => {
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
            name: any('.guarded-default'),
            guard: condition([
              condition([
                expr(ref({ key: 'mode' }, { type: 'variable' })),
                '=',
                any('dark')
              ]),
              'and',
              defaultguard()
            ]),
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          }),
          ruleset({
            selector: el('.dark'),
            rules: rules([
              vardecl({ name: 'mode', value: any('dark') }),
              call({ name: ref({ key: '.guarded-default' }, { type: 'mixin' }) })
            ])
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
        name: any('.scope-default'),
        guard: condition([
          condition([
            expr(ref({ key: 'mode' }, { type: 'variable' })),
            '=',
            any('dark')
          ]),
          'and',
          defaultguard()
        ]),
        rules: rules([
          decl({ name: 'color', value: any('black') })
        ])
      });

      const lightDefault = mixin({
        name: any('.scope-default'),
        guard: condition([
          condition([
            expr(ref({ key: 'mode' }, { type: 'variable' })),
            '=',
            any('light')
          ]),
          'and',
          defaultguard()
        ]),
        rules: rules([
          decl({ name: 'background', value: any('white') })
        ])
      });

      const root = rules([
        darkDefault,
        lightDefault,
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({ name: ref({ key: '.scope-default' }, { type: 'mixin' }) }),
            decl({ name: 'value', value: ref({ key: 'mode' }, { type: 'variable' }) })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            call({ name: ref({ key: '.scope-default' }, { type: 'mixin' }) }),
            decl({ name: 'value', value: ref({ key: 'mode' }, { type: 'variable' }) })
          ])
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
        name: any('.rest-guard'),
        params: list([
          any('first', { role: 'property' }),
          rest('rest')
        ]),
        guard: condition([
          expr(ref({ key: 'rest' }, { type: 'variable' })),
          '=',
          seq([any('2px'), any('3px')])
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      const root = rules([
        mixinDef,
        ruleset({
          selector: el('.match'),
          rules: rules([
            call({
              name: ref({ key: '.rest-guard' }, { type: 'mixin' }),
              args: list([any('1px'), any('2px'), any('3px')])
            })
          ])
        }),
        ruleset({
          selector: el('.miss'),
          rules: rules([
            call({
              name: ref({ key: '.rest-guard' }, { type: 'mixin' }),
              args: list([any('1px'), any('4px'), any('5px')])
            })
          ])
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
        name: any('.base-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a mixin that calls the base mixin: .wrapper-mixin(@color) { .base-mixin(@color); }
      const wrapperMixin = mixin({
        name: any('.wrapper-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          call({
            name: ref({ key: '.base-mixin' }, { type: 'mixin' }),
            args: list([ref({ key: 'color' }, { type: 'variable' })])
          })
        ])
      });

      // Create a ruleset that calls the wrapper mixin: .test { .wrapper-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.wrapper-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
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
        name: any('.mixin'),
        params: list([
          any('red') // Pattern match - must be exactly 'red'
        ]),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      const blueMixin = mixin({
        name: any('.mixin'),
        params: list([
          any('blue') // Pattern match - must be exactly 'blue'
        ]),
        rules: rules([
          decl({ name: 'color', value: any('blue') })
        ])
      });

      // Create rulesets that call the mixin with different values
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: rules([
          call({
            name: ref({ key: '.mixin' }, { type: 'mixin' }),
            args: list([any('red')])
          })
        ])
      });

      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: rules([
          call({
            name: ref({ key: '.mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest') // Rest parameter collects remaining arguments
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with multiple args: .test { .my-mixin(10px, 20px, 30px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')])
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest(undefined) // Unnamed rest parameter - should auto-generate "rest"
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with multiple args: .test { .my-mixin(10px, 20px, 30px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')])
          })
        ])
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
          rules: rules([
            ruleset({
              selector: sel([el('.sol'), co(' '), el('.la')]),
              rules: rules([
                ruleset({
                  selector: sel([el('.si')]),
                  rules: rules([
                    decl({ name: 'color', value: any('cyan') })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.mutli-selector-parents'),
          rules: rules([
            call({ name: ref({ key: compound([el('.do'), el('.re'), el('.mi'), el('.fa'), el('.sol'), el('.la'), el('.si')]) }, { type: 'mixin-ruleset' }) })
          ])
        })
      ]);
      context.opts.collapseNesting = true;
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
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    vardecl({ name: 'color', value: any('cyan') })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            vardecl({ name: 'color', value: any('blue') })
          ])
        }),
        ruleset({
          selector: el('.rule'),
          rules: rules([
            call({ name: ref({ key: ['#theme', '.dark', '.navbar'] }, { type: 'mixin-ruleset' }) }),
            decl({ name: 'background-color', value: ref({ key: 'color' }, { type: 'variable' }) })
          ])
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
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: '.foo' }, { type: 'mixin-ruleset' })
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const dynamicPseudoArg = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        mixin({
          name: any('.emit'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            ruleset({
              selector: compound([
                pseudo({
                  name: ':is',
                  arg: interpolatedSelector(dynamicPseudoArg)
                })
              ]),
              rules: rules([
                decl({ name: 'color', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
          name: any('.emit-op'),
          params: list([any('scale', { role: 'property' })]),
          rules: rules([
            decl({
              name: 'width',
              value: op([
                dimension([10, 'px']),
                '*',
                ref({ key: 'scale' }, { type: 'variable' })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-op' }, { type: 'mixin' }),
              args: list([dimension([2, 'em'])])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-op' }, { type: 'mixin' }),
              args: list([dimension([3, 'em'])])
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        mixin({
          name: any('.emit-interpolated'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            ruleset({
              selector: interpolatedSelector(dynamicClass),
              rules: rules([
                decl({ name: 'color', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-interpolated' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-interpolated' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        mixin({
          name: any('.emit-compound'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            ruleset({
              selector: compound([
                el('.base'),
                interpolatedSelector(dynamicClass)
              ]),
              rules: rules([
                decl({ name: 'color', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-compound' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-compound' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        mixin({
          name: any('.emit-complex'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            ruleset({
              selector: sel([
                el('.base'),
                co(' '),
                interpolatedSelector(dynamicClass)
              ]),
              rules: rules([
                decl({ name: 'color', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-complex' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-complex' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        mixin({
          name: any('.emit-list'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
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
              rules: rules([
                decl({ name: 'color', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-list' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-list' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const dynamicValue = interpolated({
        source: INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      });

      const node = rules([
        mixin({
          name: any('.emit-paren'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            decl({
              name: 'value',
              value: paren(dynamicValue)
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-paren' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-paren' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: any('.emit-quoted'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            decl({
              name: 'value',
              value: quoted(ref({ key: 'name' }, { type: 'variable' }))
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-quoted' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-quoted' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: any('.emit-sequence'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            decl({
              name: 'value',
              value: seq([ref({ key: 'name' }, { type: 'variable' }), any('tail')])
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-sequence' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-sequence' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: any('.emit-decl-value'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            decl({
              name: any('value'),
              value: ref({ key: 'name' }, { type: 'variable' })
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-decl-value' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-decl-value' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const dynamicName = interpolated({
        source: 'prop-' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      });

      const node = rules([
        mixin({
          name: any('.emit-decl-name'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            decl({
              name: dynamicName,
              value: any('ok')
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-decl-name' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-decl-name' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
        decl({ name: any('value'), value: any('ok') })
      ]);
      const node = mixin({
        name: dynamicMixinName,
        params,
        rules: body
      });

      const prepared = await node.prepareRegistration(context);

      expect(prepared).not.toBe(node);
      expect(prepared.sourceNode).toBe(prepared);
      expect(prepared.value.name.valueOf()).toBe('.inner-foo');
      expect(dynamicMixinName.parent).toBe(node);
      expect(params.parent).toBe(node);
      expect(body.parent).toBe(node);
    });

    it('keeps nested interpolated mixin names isolated across repeated mixin calls', async () => {
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const dynamicMixinName = interpolated({
        source: '.inner-' + INTERPOLATION_PLACEHOLDER,
        replacements: [ref({ key: 'name' }, { type: 'variable' })]
      });

      const node = rules([
        mixin({
          name: any('.emit-nested-mixin'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            mixin({
              name: dynamicMixinName,
              rules: rules([
                decl({
                  name: any('value'),
                  value: ref({ key: 'name' }, { type: 'variable' })
                })
              ])
            }),
            call({
              name: ref({ key: dynamicMixinName }, { type: 'mixin' })
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-nested-mixin' }, { type: 'mixin' }),
              args: list([any('foo')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-nested-mixin' }, { type: 'mixin' }),
              args: list([any('bar')])
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: any('.emit-amp-append'),
          rules: rules([
            ruleset({
              selector: sel([amp('-suffix')]),
              rules: rules([
                decl({ name: 'color', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-amp-append' }, { type: 'mixin' })
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-amp-append' }, { type: 'mixin' })
            })
          ])
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
      context = new Context({
        collapseNesting: true,
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: any('.emit-amp-self'),
          rules: rules([
            ruleset({
              selector: sel([amp()]),
              rules: rules([
                decl({ name: 'color', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-amp-self' }, { type: 'mixin' })
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-amp-self' }, { type: 'mixin' })
            })
          ])
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
      context = new Context({
        collapseNesting: false,
        leakyRules: true
      });

      const node = rules([
        mixin({
          name: any('.emit-media'),
          params: list([any('mode', { role: 'property' })]),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: ref({ key: 'mode' }, { type: 'variable' }),
              rules: rules([
                decl({
                  name: 'value',
                  value: ref({ key: 'mode' }, { type: 'variable' })
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.one'),
          rules: rules([
            call({
              name: ref({ key: '.emit-media' }, { type: 'mixin' }),
              args: list([any('screen')])
            })
          ])
        }),
        ruleset({
          selector: el('.two'),
          rules: rules([
            call({
              name: ref({ key: '.emit-media' }, { type: 'mixin' }),
              args: list([any('print')])
            })
          ])
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
          rules: rules([
            ruleset({
              selector: sel([
                compound([amp(), el('.foo-xxx')]),
                co(' '),
                compound([el('.yyy-foo'), el('#foo')])
              ]),
              rules: rules([
                ruleset({
                  selector: sel([amp(), co(' '), compound([el('.foo'), el('.bbb')])]),
                  rules: rules([
                    decl({ name: 'b', value: any('1') })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('mi-test-b'),
          rules: rules([
            call({
              name: ref({
                key: ['.b', '.bb', '.foo-xxx', '.yyy-foo', '#foo', '.foo', '.bbb']
              }, { type: 'mixin-ruleset' })
            })
          ])
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
          rules: rules([
            ruleset({
              selector: sel([
                compound([amp(), el('.foo-xxx')]),
                co(' '),
                compound([el('.yyy-foo'), el('#foo')])
              ]),
              rules: rules([
                ruleset({
                  selector: sel([amp(), co(' '), compound([el('.foo'), el('.bbb')])]),
                  rules: rules([
                    decl({ name: 'b', value: any('1') })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('#foo-foo'),
          rules: rules([
            ruleset({
              selector: sel([co('>'), el('.bar')]),
              rules: rules([
                ruleset({
                  selector: sel([el('.baz')]),
                  rules: rules([
                    decl({ name: 'c', value: any('c') })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('mi-test-b'),
          rules: rules([
            call({
              name: ref({
                key: ['.b', '.bb', '.foo-xxx', '.yyy-foo', '#foo', '.foo', '.bbb']
              }, { type: 'mixin-ruleset' })
            })
          ])
        }),
        ruleset({
          selector: el('mi-test-c'),
          rules: rules([
            ruleset({
              selector: sel([amp('-1')]),
              rules: rules([
                call({
                  name: ref({ key: '#foo-foo' }, { type: 'mixin-ruleset' })
                })
              ])
            }),
            ruleset({
              selector: sel([amp('-2')]),
              rules: rules([
                call({
                  name: ref({ key: ['#foo-foo', '.bar'] }, { type: 'mixin-ruleset' })
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('mi-test-c-3'),
          rules: rules([
            call({
              name: ref({ key: ['#foo-foo', '.bar', '.baz'] }, { type: 'mixin-ruleset' })
            })
          ])
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
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with only the required arg: .test { .my-mixin(10px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px')]) // Only one arg, rest should be empty
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with two args: .test { .my-mixin(10px, 20px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px')]) // Rest should contain 20px
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with many args: .test { .my-mixin(10px, 20px, 30px, 40px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px'), any('40px')]) // Rest should contain 20px, 30px, 40px
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' }),
          any('c', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'padding', value: seq([
            ref({ key: 'a' }, { type: 'variable' }),
            ref({ key: 'b' }, { type: 'variable' }),
            ref({ key: 'c' }, { type: 'variable' })
          ]) })
        ])
      });

      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([
              any('10px'),
              rest(seq([any('20px'), any('30px')]))
            ])
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(10px, 20px, 30px, 40px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px'), any('40px')]) // Rest should contain 30px, 40px
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) }),
          decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(10px, 20px, 30px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')])
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      // Create a mixin with rest: .my-mixin(@a, @rest...) { color: blue; }
      const mixinWithRest = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'color', value: any('blue') })
        ])
      });

      // Create a ruleset that calls with exact 2 args: .test1 { .my-mixin(10px, 20px); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px')]) // Matches mixinWithoutRest exactly
          })
        ])
      });

      // Create a ruleset that calls with 3 args: .test2 { .my-mixin(10px, 20px, 30px); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')]) // Should match mixinWithRest
          })
        ])
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
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' }) // Required parameter without default
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin without args: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('should fail when calling a mixin with too few arguments (multiple required parameters)', async () => {
      // Create a mixin with multiple required parameters: .my-mixin(@color, @size) { color: @color; font-size: @size; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' }),
          any('size', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          decl({ name: 'font-size', value: ref({ key: 'size' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with only one arg: .test { .my-mixin(red); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('red')]) // Only one argument, but two are required
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('should fail when calling a mixin with no parameters but providing arguments', async () => {
      // Create a mixin with no parameters: .my-mixin() { color: red; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      // Create a ruleset that calls the mixin with args: .test { .my-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')]) // One argument, but mixin has no parameters
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('keeps param vars preferred over outer same-name vars in lazy nested mixin lookups', async () => {
      const root = rules([
        vardecl({ name: 'gender_', value: any('"Outer"') }),
        mixin({
          name: any('.Person'),
          params: list([
            any('name', { role: 'property' }),
            any('gender_', { role: 'property' })
          ]),
          rules: rules([
            ruleset({
              selector: el('.person'),
              rules: rules([
                vardecl({
                  name: 'gender',
                  value: ref({ key: 'gender_' }, { type: 'variable' })
                }),
                mixin({
                  name: any('.sayGender'),
                  rules: rules([
                    decl({
                      name: 'gender',
                      value: ref({ key: 'gender' }, { type: 'variable' })
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.test'),
          rules: rules([
            call({
              name: ref({ key: '.Person' }, { type: 'mixin' }),
              args: list([any('person'), any('"Male"')])
            }),
            call({
              name: ref({ key: ['.person', '.sayGender'] }, { type: 'mixin-ruleset' })
            })
          ])
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
          name: any('.Person'),
          params: list([
            any('name', { role: 'property' }),
            any('gender_', { role: 'property' })
          ]),
          rules: rules([
            ruleset({
              selector: interpolatedSelector(interpolated({
                source: '.' + INTERPOLATION_PLACEHOLDER,
                replacements: [ref({ key: 'name' }, { type: 'variable' })]
              })),
              rules: rules([
                vardecl({
                  name: 'gender',
                  value: ref({ key: 'gender_' }, { type: 'variable' })
                }),
                mixin({
                  name: any('.sayGender'),
                  rules: rules([
                    decl({
                      name: 'gender',
                      value: ref({ key: 'gender' }, { type: 'variable' })
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.test'),
          rules: rules([
            call({
              name: ref({ key: '.Person' }, { type: 'mixin' }),
              args: list([any('person'), any('"Male"')])
            }),
            call({
              name: ref({ key: ['.person', '.sayGender'] }, { type: 'mixin-ruleset' })
            })
          ])
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
          name: any('.Person'),
          params: list([
            any('name', { role: 'property' }),
            any('gender_', { role: 'property' })
          ]),
          rules: rules([
            ruleset({
              selector: interpolatedSelector(interpolated({
                source: '.' + INTERPOLATION_PLACEHOLDER,
                replacements: [ref({ key: 'name' }, { type: 'variable' })]
              })),
              rules: rules([
                vardecl({
                  name: 'gender',
                  value: ref({ key: 'gender_' }, { type: 'variable' })
                }),
                mixin({
                  name: any('.sayGender'),
                  rules: rules([
                    decl({
                      name: 'gender',
                      value: ref({ key: 'gender' }, { type: 'variable' })
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('mi-test-d'),
          rules: rules([
            call({
              name: ref({ key: '.Person' }, { type: 'mixin' }),
              args: list([any('person'), any('"Male"')])
            }),
            call({
              name: ref({ key: ['.person', '.sayGender'] }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      context.root = root;
      context.opts.collapseNesting = true;

      const css = await renderNodeToString(root, context, { context });

      expect(css).toContain('mi-test-d {\n  gender: "Male";\n}');
      expect(css).not.toContain('mi-test-d .person {\n}');
    });

    it('keeps sibling collapsed rulesets closed before a later interpolated mixin-ruleset call', async () => {
      const { Parser } = await import('../../../../less-parser/src/index.ts');
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
      context.root = tree;
      context.opts.collapseNesting = true;

      const css = await renderNodeToString(tree, context, { context });

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
        name: any('myMixin'),
        rules: rules([
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ])
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
        name: any('my-mixin'),
        params: list([
          vardecl({ name: 'a', value: any('black') }, { paramVar: true }),
          vardecl({ name: 'b', value: any('white') }, { paramVar: true })
        ], { sep: ';' }),
        rules: rules([
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ])
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
        name: any('my-mixin'),
        params: list([
          vardecl({ name: 'a', value: any('black') }, { paramVar: true }),
          vardecl({ name: 'b', value: any('white') }, { paramVar: true })
        ], { sep: ';' }),
        guard: condition([expr(ref({ key: 'a' })), '=', expr(ref({ key: 'b' }))]),
        rules: rules([
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ])
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
