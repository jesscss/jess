import { describe, it, expect } from 'vitest';
import { EvalSession } from '../eval-session.js';
import { Keyword, Dimension, Context, vardecl, any, Operation, decl, el, rules, rawrules, ruleset, atrule, seq, mixin, list, condition, call, pseudo, sellist, sel, compound, co, expr, paren, quoted, url, selcap, query, fn, range, ref, interpolated, interpolatedSelector, js, block, Negative, rest, attr } from '../index.js';
import {
  sessionGetDependency,
  sessionGetField,
  sessionGetParent,
  sessionGetIndex,
  sessionGetSourceParent,
  sessionIsEvaluated,
  sessionIsPreEvaluated,
  sessionIsStatic,
  sessionSetIndex,
  sessionMergeDependencies,
  sessionPatchField,
  sessionGetChildren,
  sessionAppendChildren,
  sessionPrependChildren,
  sessionRemoveChild,
  sessionSetDependency,
  sessionSetEvaluated,
  sessionSetParent,
  sessionSetPreEvaluated,
  sessionReplaceNode,
  sessionSetSourceParent,
  sessionSetRuntimeState
} from '../tree/util/session-helpers.js';

describe('EvalSession', () => {
  describe('field patches', () => {
    it('stores and retrieves patched fields', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      session.patchField(node, 'value', 'blue');
      expect(session.getField(node, 'value')).toBe('blue');
    });

    it('returns undefined for unpatched fields', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      expect(session.getField(node, 'value')).toBeUndefined();
    });

    it('distinguishes patched-to-undefined from unpatched', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      session.patchField(node, 'value', undefined);
      expect(session.hasField(node, 'value')).toBe(true);
      expect(session.getField(node, 'value')).toBeUndefined();
    });

    it('does not mutate the original node', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      session.patchField(node, 'value', 'blue');
      expect(node.value).toBe('red');
      expect(session.getField(node, 'value')).toBe('blue');
    });

    it('hasPatches returns false for untouched nodes', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      expect(session.hasPatches(node)).toBe(false);
    });

    it('hasPatches returns true after patching', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      session.patchField(node, 'value', 'blue');
      expect(session.hasPatches(node)).toBe(true);
    });
  });

  describe('session isolation', () => {
    it('patches in one session do not affect another', () => {
      const session1 = new EvalSession();
      const session2 = new EvalSession();
      const node = new Keyword('red');

      session1.patchField(node, 'value', 'blue');
      session2.patchField(node, 'value', 'green');

      expect(session1.getField(node, 'value')).toBe('blue');
      expect(session2.getField(node, 'value')).toBe('green');
      expect(node.value).toBe('red');
    });

    it('runtime state is isolated between sessions', () => {
      const session1 = new EvalSession();
      const session2 = new EvalSession();
      const node = new Keyword('red');

      session1.getRuntime(node).evaluated = true;
      session2.getRuntime(node).evaluated = false;

      expect(session1.getRuntime(node).evaluated).toBe(true);
      expect(session2.getRuntime(node).evaluated).toBe(false);
    });

    it('each session gets a unique id', () => {
      const session1 = new EvalSession();
      const session2 = new EvalSession();

      expect(session1.id).not.toBe(session2.id);
    });
  });

  describe('runtime state', () => {
    it('creates empty runtime on first access', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      const runtime = session.getRuntime(node);
      expect(runtime).toEqual({});
    });

    it('returns same runtime object on repeated access', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      const r1 = session.getRuntime(node);
      const r2 = session.getRuntime(node);
      expect(r1).toBe(r2);
    });

    it('hasRuntime returns false before first access', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      expect(session.hasRuntime(node)).toBe(false);
    });

    it('tracks parent in runtime state', () => {
      const session = new EvalSession();
      const child = new Keyword('red');
      const parent = new Keyword('container');

      session.getRuntime(child).parent = parent;
      expect(session.getRuntime(child).parent).toBe(parent);
    });
  });

  describe('scope snapshots', () => {
    it('stores and retrieves scope snapshots by path', () => {
      const session = new EvalSession();
      const varNode = new Keyword('red');
      const snapshot = {
        variables: new Map([['@color', varNode]]),
        mixins: new Map()
      };

      session.setScope('/path/to/file.less', snapshot);
      expect(session.getScope('/path/to/file.less')).toBe(snapshot);
    });

    it('returns undefined for unknown paths', () => {
      const session = new EvalSession();
      expect(session.getScope('/unknown')).toBeUndefined();
    });

    it('scope snapshots are isolated between sessions', () => {
      const session1 = new EvalSession();
      const session2 = new EvalSession();
      const red = new Keyword('red');
      const blue = new Keyword('blue');

      session1.setScope('/file.less', {
        variables: new Map([['@color', red]]),
        mixins: new Map()
      });
      session2.setScope('/file.less', {
        variables: new Map([['@color', blue]]),
        mixins: new Map()
      });

      const s1Vars = session1.getScope('/file.less')!.variables;
      const s2Vars = session2.getScope('/file.less')!.variables;
      expect((s1Vars.get('@color') as Keyword).value).toBe('red');
      expect((s2Vars.get('@color') as Keyword).value).toBe('blue');
    });
  });

  describe('materialization', () => {
    it('tracks materialized nodes', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      expect(session.isMaterialized(node)).toBe(false);
      session.materialize(node);
      expect(session.isMaterialized(node)).toBe(true);
    });

    it('materialization is isolated between sessions', () => {
      const session1 = new EvalSession();
      const session2 = new EvalSession();
      const node = new Keyword('red');

      session1.materialize(node);
      expect(session1.isMaterialized(node)).toBe(true);
      expect(session2.isMaterialized(node)).toBe(false);
    });
  });

  describe('rules child overlays', () => {
    it('stores and retrieves session-local Rules children', () => {
      const session = new EvalSession();
      const node = rules([decl({ name: 'color', value: any('red') })]);
      const patched = [decl({ name: 'background', value: any('blue') })];

      session.setChildren(node, patched);

      expect(session.getChildren(node)).toBe(patched);
      expect(session.hasChildren(node)).toBe(true);
      expect(node.value[0]!.toTrimmedString()).toBe('color: red');
    });
  });
});

describe('session-aware helpers', () => {
  describe('sessionGetField / sessionPatchField', () => {
    it('falls through to node field when no session', () => {
      const ctx = new Context();
      const node = new Dimension({ number: 10, unit: 'px' });

      expect(sessionGetField<number>(node, 'number', ctx)).toBe(10);
    });

    it('reads patched value when session exists', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Dimension({ number: 10, unit: 'px' });

      sessionPatchField(node, 'number', 20, ctx);
      expect(sessionGetField<number>(node, 'number', ctx)).toBe(20);
      expect(node.number).toBe(10);
    });

    it('falls through to node for unpatched fields with session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Dimension({ number: 10, unit: 'px' });

      expect(sessionGetField<number>(node, 'number', ctx)).toBe(10);
    });

    it('writes directly to node when no session', () => {
      const ctx = new Context();
      const node = new Dimension({ number: 10, unit: 'px' });

      sessionPatchField(node, 'number', 20, ctx);
      expect(node.number).toBe(20);
    });

    it('Declaration rendering reads patched fields from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = decl({ name: 'color', value: any('red') });

      sessionPatchField(node, 'name', any('background', { role: 'property' }), ctx);
      sessionPatchField(node, 'value', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('background: blue');
      expect(node.toTrimmedString()).toBe('color: red');
    });

    it('Ruleset rendering reads patched selector and rules from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = ruleset({
        selector: el('.a'),
        rules: rules([decl({ name: 'color', value: any('red') })])
      });
      const patchedRules = rules([decl({ name: 'background', value: any('blue') })]);

      sessionPatchField(node, 'selector', el('.b'), ctx);
      sessionPatchField(node, 'rules', patchedRules, ctx);

      const sessionOut = node.toTrimmedString({ context: ctx });
      const canonicalOut = node.toTrimmedString();

      expect(sessionOut).toContain('.b');
      expect(sessionOut).toContain('background: blue;');
      expect(canonicalOut).toContain('.a');
      expect(canonicalOut).toContain('color: red;');
    });

    it('Ruleset eval does not overwrite canonical hoistToRoot in a session', async () => {
      const ctx = new Context({ collapseNesting: true });
      ctx.createSession();
      const child = ruleset({
        selector: el('.child'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const root = rules([
        ruleset({
          selector: el('.parent'),
          rules: rules([child])
        })
      ]);

      const evald = await root.eval(ctx);

      expect(evald.toString({ collapseNesting: true, context: ctx })).toContain('.parent .child');
      expect(child.hoistToRoot).toBeUndefined();
    });

    it('AtRule rendering reads patched name, prelude, and rules from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = atrule({
        name: any('@media', { role: 'atkeyword' }),
        prelude: seq([any('screen', { role: 'keyword' })]),
        rules: rules([decl({ name: 'color', value: any('red') })])
      });
      const patchedRules = rules([decl({ name: 'background', value: any('blue') })]);

      sessionPatchField(node, 'name', any('@supports', { role: 'atkeyword' }), ctx);
      sessionPatchField(node, 'prelude', seq([any('(display:grid)')]), ctx);
      sessionPatchField(node, 'rules', patchedRules, ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('@supports (display:grid) {\n  background: blue;\n}\n');
      expect(node.toTrimmedString()).toBe('@media screen {\n  color: red;\n}\n');
    });

    it('AtRule eval does not overwrite canonical name, prelude, or rules in a session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const name = interpolated({
        source: '@%%',
        replacements: [expr(any('media'))]
      }, { role: 'atkeyword' });
      const prelude = seq([expr(any('screen'))]);
      const body = rules([
        decl({ name: 'color', value: expr(any('blue')) })
      ]);
      const node = atrule({
        name,
        prelude,
        rules: body
      });

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString()).toBe('@media screen {\n  color: blue;\n}\n');
      expect(node.name).toBe(name);
      expect(node.prelude).toBe(prelude);
      expect(node.rules).toBe(body);
    });

    it('Mixin rendering reads patched name, params, guard, and rules from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = mixin({
        name: any('.base'),
        params: list([any('color', { role: 'property' })]),
        rules: rules([decl({ name: 'color', value: any('red') })])
      });
      const patchedRules = rules([decl({ name: 'background', value: any('blue') })]);

      sessionPatchField(node, 'name', any('.patched'), ctx);
      sessionPatchField(node, 'params', list([any('size', { role: 'property' })]), ctx);
      sessionPatchField(node, 'guard', condition([any('true')]), ctx);
      sessionPatchField(node, 'rules', patchedRules, ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('.patched(size) when true {\n  background: blue;\n}');
      expect(node.toTrimmedString()).toBe('.base(color) {\n  color: red;\n}');
    });

    it('Mixin preEval does not overwrite the canonical interpolated name in a session', async () => {
      const ctx = new Context({ leakyRules: true });
      ctx.depth = 2;
      ctx.createSession();
      const name = interpolated({
        source: '%%',
        replacements: [expr(any('.button'))]
      }, { role: 'name' });
      const mixinDef = mixin({
        name,
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const preEvald = await mixinDef.preEval(ctx);

      expect(preEvald.toTrimmedString({ context: ctx })).toContain('.button()');
      expect(mixinDef.name).toBe(name);
      expect(mixinDef.name?.type).toBe('Interpolated');
    });

    it('mixin param binding in a non-reset session does not overwrite canonical defaults', async () => {
      const ctx = new Context({ leakyRules: true });
      ctx.depth = 2;
      ctx.session = new EvalSession();
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          vardecl({ name: 'color', value: any('red') }, { paramVar: true })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });
      const root = rules([mixinDef, testRuleset]);
      ctx.root = root;
      ctx.rulesContext = testRuleset.rules;

      const mixinCall = testRuleset.rules!.value[0]!;
      const output = await mixinCall.eval(ctx);

      expect(output.toTrimmedString({ context: ctx })).toContain('color: blue;');
      expect(String((mixinDef.params!.value[0] as any).value)).toBe('red');
    });

    it('Call rendering reads patched name, args, and content from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = call({
        name: any('rgb'),
        args: list([any('red'), any('blue')]),
        contentNode: any('fallback')
      });

      sessionPatchField(node, 'name', any('hsl'), ctx);
      sessionPatchField(node, 'args', list([any('120deg'), any('50%')]), ctx);
      sessionPatchField(node, 'contentNode', any('patched'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('hsl(120deg, 50%): patched');
      expect(node.toTrimmedString()).toBe('rgb(red, blue): fallback');
    });

    it('Call eval does not overwrite the canonical name or args in a session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const name = interpolated({
        source: '%%',
        replacements: [expr(any('blur'))]
      }, { role: 'ident' });
      const args = list([expr(any('4px'))]);
      const node = call({
        name,
        args
      });

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('blur(4px)');
      expect(node.name).toBe(name);
      expect(node.args).toBe(args);
    });

    it('PseudoSelector rendering reads patched name and arg from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = pseudo({
        name: ':not',
        arg: any('red')
      });

      sessionPatchField(node, 'name', ':where', ctx);
      sessionPatchField(node, 'arg', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe(':where(blue)');
      expect(node.toTrimmedString()).toBe(':not(red)');
    });

    it('PseudoSelector eval does not overwrite the canonical arg in a session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const arg = expr(any('blue'));
      const node = pseudo({
        name: ':not',
        arg
      });

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe(':not(blue)');
      expect(node.arg).toBe(arg);
    });

    it('SelectorList rendering reads patched items from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = sellist([el('.a'), el('.b')]);

      sessionPatchField(node, 'value', [el('.x'), el('.y')], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('.x,\n.y');
      expect(node.toTrimmedString()).toBe('.a,\n.b');
    });

    it('SelectorList eval does not overwrite canonical items in a session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const item = pseudo({
        name: ':is',
        arg: sellist([el('.a'), el('.b')])
      });
      const node = sellist([item]);

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('.a,\n.b');
      expect(node.value[0]).toBe(item);
    });

    it('ComplexSelector rendering reads patched components from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = sel([el('.a'), co('>'), el('.b') as any]);

      sessionPatchField(node, 'value', [el('.x'), co('>'), el('.y') as any], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('.x > .y');
      expect(node.toTrimmedString()).toBe('.a > .b');
    });

    it('ComplexSelector eval does not overwrite canonical components in a session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const first = pseudo({
        name: ':not',
        arg: expr(any('blue'))
      }) as any;
      const join = co('>');
      const last = el('.target') as any;
      const node = sel([first, join, last]);

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe(':not(blue) > .target');
      expect(node.value[0]).toBe(first);
      expect(node.value[1]).toBe(join);
      expect(node.value[2]).toBe(last);
    });

    it('CompoundSelector rendering reads patched components from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = compound([el('button') as any, el('.a') as any]);

      sessionPatchField(node, 'value', [el('input') as any, el('.b') as any], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('input.b');
      expect(node.toTrimmedString()).toBe('button.a');
    });

    it('CompoundSelector eval does not overwrite canonical components in a session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const first = el('button') as any;
      const second = pseudo({
        name: ':not',
        arg: expr(any('blue'))
      }) as any;
      const node = compound([first, second]);

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('button:not(blue)');
      expect(node.value[0]).toBe(first);
      expect(node.value[1]).toBe(second);
    });

    it('Expression rendering reads a patched child from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = expr(any('red'));

      sessionPatchField(node, 'value', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('$(blue)');
      expect(node.toTrimmedString()).toBe('$(red)');
    });

    it('Paren rendering reads a patched child from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = paren(any('red'));

      sessionPatchField(node, 'value', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('(blue)');
      expect(node.toTrimmedString()).toBe('(red)');
    });

    it('Block rendering reads a patched child from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = block(any('red'));

      sessionPatchField(node, 'value', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('{blue}');
      expect(node.toTrimmedString()).toBe('{red}');
    });

    it('Negative rendering and eval read a patched child from the active session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Negative(new Dimension({ number: 2, unit: 'px' }));
      const renderPatched = new Dimension({ number: 3, unit: 'px' });

      sessionPatchField(node, 'value', renderPatched, ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('-3px');
      expect(node.toTrimmedString()).toBe('-2px');

      const preEvald = await node.preEval(ctx);
      if (!(preEvald instanceof Negative)) {
        throw new TypeError('Expected Negative.preEval() to return a Negative');
      }
      const evalPatched = new Dimension({ number: 4, unit: 'px' });
      sessionPatchField(preEvald, 'value', evalPatched, ctx);

      const sessionEvald = await preEvald.eval(ctx);
      const canonicalEvald = await node.eval(new Context());

      expect(sessionEvald.toTrimmedString()).toBe('-4px');
      expect(canonicalEvald.toTrimmedString()).toBe('-2px');
      expect(node.value.toTrimmedString()).toBe('2px');
      expect(node.value).not.toBe(renderPatched);
      expect(preEvald.value).not.toBe(evalPatched);
    });

    it('Rest rendering reads a patched value from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = rest('args');

      sessionPatchField(node, 'value', 'tail', ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('...$$tail');
      expect(node.toTrimmedString()).toBe('...$$args');
      expect(node.value).toBe('args');
    });

    it('AttributeSelector rendering reads patched name and value from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = attr({
        name: 'data',
        op: '=',
        value: any('red')
      });

      sessionPatchField(node, 'name', any('data-theme'), ctx);
      sessionPatchField(node, 'value', quoted('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('[data-theme="blue"]');
      expect(node.toTrimmedString()).toBe('[data=red]');
      expect(node.name).toBe('data');
      expect(node.value?.toTrimmedString()).toBe('red');
    });

    it('InterpolatedSelector rendering and eval read a patched value from the active session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const node = interpolatedSelector(interpolated({
        source: '.%%',
        replacements: [any('alpha')]
      }));
      const renderPatched = interpolated({
        source: '.%%',
        replacements: [any('beta')]
      });

      sessionPatchField(node, 'value', renderPatched, ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('.beta');
      expect(node.toTrimmedString()).toBe('.alpha');

      const preEvald = await node.preEval(ctx);
      if (!('type' in preEvald) || preEvald.type !== 'InterpolatedSelector') {
        throw new TypeError('Expected InterpolatedSelector.preEval() to return an InterpolatedSelector');
      }
      const evalPatched = interpolated({
        source: '.%%',
        replacements: [any('gamma')]
      });
      sessionPatchField(preEvald, 'value', evalPatched, ctx);

      const sessionEvald = await preEvald.eval(ctx);
      const canonicalEvald = await node.eval(new Context());

      expect(sessionEvald.toTrimmedString()).toBe('.gamma');
      expect(canonicalEvald.toTrimmedString()).toBe('.alpha');
      expect(node.value.toTrimmedString()).toBe('.alpha');
      expect(node.value).not.toBe(renderPatched);
      expect(preEvald.value).not.toBe(evalPatched);
    });

    it('Quoted rendering reads a patched child from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = quoted('red');

      sessionPatchField(node, 'value', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('\"blue\"');
      expect(node.toTrimmedString()).toBe('\"red\"');
    });

    it('Url rendering reads a patched child from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = url(quoted('a.png'));

      sessionPatchField(node, 'value', quoted('b.png'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('url(\"b.png\")');
      expect(node.toTrimmedString()).toBe('url(\"a.png\")');
    });

    it('SelectorCapture rendering reads a patched child from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = selcap(el('.a'));

      sessionPatchField(node, 'value', sellist([el('.x'), el('.y')]), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('*[.x,\n.y]');
      expect(node.toTrimmedString()).toBe('*[.a]');
    });

    it('List rendering reads patched items from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = list([any('red'), any('blue')]);

      sessionPatchField(node, 'value', [any('cyan'), any('magenta')], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('cyan, magenta');
      expect(node.toTrimmedString()).toBe('red, blue');
    });

    it('List operate uses patched items without mutating the canonical list', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = list([any('red')]);

      sessionPatchField(node, 'value', [any('cyan'), any('magenta')], ctx);

      const result = node.operate(any('black'), '+', ctx);

      expect(result.toTrimmedString({ context: ctx })).toBe('cyan, magenta, black');
      expect(node.toTrimmedString()).toBe('red');
      expect(node.value.map((item) => item.toTrimmedString())).toEqual(['red']);
    });

    it('Sequence rendering reads patched items from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = seq([any('red'), any('blue')]);

      sessionPatchField(node, 'value', [any('cyan'), any('magenta')], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('cyan magenta');
      expect(node.toTrimmedString()).toBe('red blue');
    });

    it('QueryCondition rendering reads patched items from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = query([any('screen'), any('and'), paren(any('color'))]);

      sessionPatchField(node, 'value', [any('print'), any('and'), paren(any('monochrome'))], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('print and (monochrome)');
      expect(node.toTrimmedString()).toBe('screen and (color)');
    });

    it('Condition rendering reads patched operands from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = condition([any('a'), '=', any('b')]);

      sessionPatchField(node, 'left', any('x'), ctx);
      sessionPatchField(node, 'operator', '>=', ctx);
      sessionPatchField(node, 'right', any('y'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('(x >= y)');
      expect(node.toTrimmedString()).toBe('(a = b)');
    });

    it('Func rendering reads patched name, params, and body from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = fn({
        name: any('base'),
        params: list([any('color')]),
        body: rules([decl({ name: 'return', value: any('red') })])
      });
      const patchedBody = rules([decl({ name: 'return', value: any('blue') })]);

      sessionPatchField(node, 'name', any('patched'), ctx);
      sessionPatchField(node, 'params', list([any('size')]), ctx);
      sessionPatchField(node, 'body', patchedBody, ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('$function patched(size) {\n  return: blue;\n}');
      expect(node.toTrimmedString()).toBe('$function base(color) {\n  return: red;\n}');
    });

    it('Func evalCall reads patched params and body without overwriting canonical fields', async () => {
      const ctx = new Context({ leakyRules: true });
      ctx.depth = 2;
      ctx.createSession();
      const params = list([
        vardecl({ name: 'color', value: any('red') })
      ]);
      const body = rules([
        decl({ name: 'return', value: ref({ key: 'color' }, { type: 'variable' }) })
      ]);
      const node = fn({
        name: any('base'),
        params,
        body
      });
      const patchedParams = list([
        vardecl({ name: 'tone', value: any('red') })
      ]);
      const patchedBody = rules([
        decl({ name: 'return', value: ref({ key: 'tone' }, { type: 'variable' }) })
      ]);
      const root = rules([node]);
      ctx.root = root;

      sessionPatchField(node, 'params', patchedParams, ctx);
      sessionPatchField(node, 'body', patchedBody, ctx);

      const result = await node.evalCall(ctx, list([any('blue')]));

      expect(result.toTrimmedString({ context: ctx })).toBe('blue');
      expect(node.params).toBe(params);
      expect(node.body).toBe(body);
    });

    it('Range rendering reads patched bounds from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = range(
        { start: any('1'), end: any('3'), step: any('2') },
        { includeEnd: false }
      );

      sessionPatchField(node, 'start', any('2'), ctx);
      sessionPatchField(node, 'end', any('4'), ctx);
      sessionPatchField(node, 'step', any('3'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('2 to <4 step 3');
      expect(node.toTrimmedString()).toBe('1 to <3 step 2');
    });

    it('Reference rendering reads patched target and key from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = ref({ target: ref('ns'), key: 'foo' }, { type: 'declaration' });

      sessionPatchField(node, 'target', ref('theme'), ctx);
      sessionPatchField(node, 'key', 'bar', ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('$theme.bar');
      expect(node.toTrimmedString()).toBe('$ns.foo');
    });

    it('Reference eval reads patched key without mutating the canonical node', async () => {
      const ctx = new Context();
      ctx.session = new EvalSession();
      const lookup = ref({ key: 'foo' }, { type: 'variable' });
      const scope = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        vardecl({
          name: any('bar'),
          value: any('blue')
        }),
        decl({
          name: any('color'),
          value: lookup
        })
      ]);
      sessionPatchField(lookup, 'key', 'bar', ctx);
      const preEvald = await scope.preEval(ctx);
      ctx.root = preEvald;
      ctx.rulesContext = preEvald;

      const evald = await lookup.eval(ctx);

      expect(`${evald}`).toBe('blue');
      expect(lookup.key).toBe('foo');
    });

    it('Interpolated rendering reads patched source and replacements from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = interpolated({
        source: '--%%',
        replacements: [any('red')]
      });

      sessionPatchField(node, 'source', 'color-%%', ctx);
      sessionPatchField(node, 'replacements', [any('blue')], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('color-blue');
      expect(node.toTrimmedString()).toBe('--red');
    });

    it('Interpolated eval does not overwrite canonical replacements in a session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const original = expr(any('button'));
      const node = interpolated({
        source: '.%%',
        replacements: [original]
      });

      const result = await node.eval(ctx);

      expect(result.toTrimmedString({ context: ctx })).toBe('.button');
      expect(node.replacements[0]).toBe(original);
      expect(original.evaluated).toBe(false);
    });

    it('JsImport rendering reads patched path and imports from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = js({
        path: quoted('a.js'),
        imports: ['foo']
      });

      sessionPatchField(node, 'path', quoted('b.js'), ctx);
      sessionPatchField(node, 'imports', [['bar', 'baz']], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('@-from \"b.js\" import ( bar as baz );');
      expect(node.toTrimmedString()).toBe('@-from \"a.js\" import ( foo );');
    });

    it('JsImport eval does not overwrite the canonical path in a session', async () => {
      const ctx = new Context();
      ctx.session = new EvalSession();
      const originalPath = quoted(expr(any('module.js')));
      const node = js({
        path: originalPath,
        imports: ['foo']
      });

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('@-from "module.js" import ( foo );');
      expect(node.toTrimmedString()).toBe('@-from "$(module.js)" import ( foo );');
      expect(node.path).toBe(originalPath);
    });
  });

  describe('sessionGetParent / sessionSetParent', () => {
    it('returns node.parent when no session', () => {
      const ctx = new Context();
      const child = new Keyword('red');
      const parent = new Keyword('container');
      parent.adopt(child);

      expect(sessionGetParent(child, ctx)).toBe(parent);
    });

    it('returns session parent when set in session', () => {
      const ctx = new Context();
      ctx.createSession();
      const child = new Keyword('red');
      const sessionParent = new Keyword('session-parent');

      sessionSetParent(child, sessionParent, ctx);
      expect(sessionGetParent(child, ctx)).toBe(sessionParent);
    });
  });

  describe('session Rules child helpers', () => {
    it('sessionGetChildren falls through to canonical rules without a session overlay', () => {
      const ctx = new Context();
      const child = decl({ name: 'color', value: any('red') });
      const node = rules([child]);

      expect(sessionGetChildren(node, ctx)).toEqual([child]);
    });

    it('sessionAppendChildren appends without mutating canonical Rules.value', () => {
      const ctx = new Context();
      ctx.createSession();
      const child = decl({ name: 'color', value: any('red') });
      const appended = decl({ name: 'background', value: any('blue') });
      const node = rules([child]);

      sessionAppendChildren(node, [appended], ctx);

      expect(sessionGetChildren(node, ctx)).toEqual([child, appended]);
      expect(node.value).toEqual([child]);
      expect(sessionGetParent(appended, ctx)).toBe(node);
      expect(appended.parent).toBeUndefined();
    });

    it('sessionPrependChildren prepends without mutating canonical Rules.value', () => {
      const ctx = new Context();
      ctx.createSession();
      const child = decl({ name: 'color', value: any('red') });
      const prepended = decl({ name: 'background', value: any('blue') });
      const node = rules([child]);

      sessionPrependChildren(node, [prepended], ctx);

      expect(sessionGetChildren(node, ctx)).toEqual([prepended, child]);
      expect(node.value).toEqual([child]);
      expect(sessionGetParent(prepended, ctx)).toBe(node);
    });

    it('sessionRemoveChild removes from the session overlay without mutating canonical Rules.value', () => {
      const ctx = new Context();
      ctx.createSession();
      const first = decl({ name: 'color', value: any('red') });
      const second = decl({ name: 'background', value: any('blue') });
      const node = rules([first, second]);

      sessionRemoveChild(node, first, ctx);

      expect(sessionGetChildren(node, ctx)).toEqual([second]);
      expect(node.value).toEqual([first, second]);
      expect(sessionGetParent(first, ctx)).toBeUndefined();
      expect(first.parent).toBe(node);
    });

    it('sessionReplaceNode replaces inside the session overlay without mutating canonical Rules.value', () => {
      const ctx = new Context();
      ctx.createSession();
      const first = decl({ name: 'color', value: any('red') });
      const second = decl({ name: 'background', value: any('blue') });
      const replacement = decl({ name: 'border', value: any('black') });
      const node = rules([first, second]);

      sessionReplaceNode(first, replacement, ctx);

      expect(sessionGetChildren(node, ctx)).toEqual([replacement, second]);
      expect(node.value).toEqual([first, second]);
      expect(sessionGetParent(replacement, ctx)).toBe(node);
      expect(sessionGetParent(first, ctx)).toBeUndefined();
      expect(first.parent).toBe(node);
    });

    it('Rules rendering reads the session-local child overlay without mutating canonical output', () => {
      const ctx = new Context();
      ctx.createSession();
      const first = decl({ name: 'color', value: any('red') });
      const second = decl({ name: 'background', value: any('blue') });
      const replacement = decl({ name: 'border', value: any('black') });
      const appended = decl({ name: 'margin', value: any('1px') });
      const node = rules([first, second]);

      sessionReplaceNode(first, replacement, ctx);
      sessionAppendChildren(node, [appended], ctx);

      expect(node.toTrimmedString({ context: ctx })).toContain('border: black;');
      expect(node.toTrimmedString({ context: ctx })).toContain('margin: 1px;');
      expect(node.toTrimmedString({ context: ctx })).not.toContain('color: red;');
      expect(node.toTrimmedString()).toContain('color: red;');
      expect(node.toTrimmedString()).not.toContain('border: black;');
      expect(node.toTrimmedString()).not.toContain('margin: 1px;');
    });

    it('RawRules rendering reads the session-local child overlay without mutating canonical output', () => {
      const ctx = new Context();
      ctx.createSession();
      const first = decl({ name: 'color', value: any('red') });
      const replacement = decl({ name: 'background', value: any('blue') });
      const appended = decl({ name: 'border', value: any('black') });
      const node = rawrules([first]);

      sessionReplaceNode(first, replacement, ctx);
      sessionAppendChildren(node, [appended], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('background: blueborder: black');
      expect(node.toTrimmedString()).toBe('color: red');
      expect(node.toBraced({ context: ctx })).toBe('{background: blueborder: black}');
      expect(node.toBraced()).toBe('{color: red}');
      expect(node.value).toEqual([first]);
    });

    it('Rules.at reads the session-local child overlay when context is provided', () => {
      const ctx = new Context();
      ctx.createSession();
      const first = decl({ name: 'color', value: any('red') });
      const second = decl({ name: 'background', value: any('blue') });
      const replacement = decl({ name: 'border', value: any('black') });
      const node = rules([first, second]);

      sessionReplaceNode(first, replacement, ctx);

      expect(node.at(0, ctx)).toBe(replacement);
      expect(node.at(0)).toBe(first);
    });

    it('Rules.toObject reads the session-local child overlay when context is provided', () => {
      const ctx = new Context();
      ctx.createSession();
      const first = decl({ name: 'color', value: any('red') });
      const second = decl({ name: 'background', value: any('blue') });
      const replacement = decl({ name: 'border', value: any('black') });
      const node = rules([first, second]);

      sessionReplaceNode(first, replacement, ctx);

      expect(node.toObject(true, ctx)).toEqual({
        border: 'black',
        background: 'blue'
      });
      expect(node.toObject()).toEqual({
        color: 'red',
        background: 'blue'
      });
    });
  });

  describe('sessionIsEvaluated / sessionSetEvaluated', () => {
    it('returns node.evaluated when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      node.evaluated = true;

      expect(sessionIsEvaluated(node, ctx)).toBe(true);
    });

    it('returns session evaluated state when set', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      node.evaluated = false;

      sessionSetEvaluated(node, true, ctx);
      expect(sessionIsEvaluated(node, ctx)).toBe(true);
      expect(node.evaluated).toBe(false);
    });

    it('falls through to node when session has no evaluated state', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      node.evaluated = true;

      expect(sessionIsEvaluated(node, ctx)).toBe(true);
    });
  });

  describe('sessionIsPreEvaluated / sessionSetPreEvaluated', () => {
    it('returns node.preEvaluated when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      node.preEvaluated = true;

      expect(sessionIsPreEvaluated(node, ctx)).toBe(true);
    });

    it('returns session preEvaluated state when set', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      node.preEvaluated = false;

      sessionSetPreEvaluated(node, true, ctx);
      expect(sessionIsPreEvaluated(node, ctx)).toBe(true);
      expect(node.preEvaluated).toBe(false);
    });

    it('falls through to node when session has no preEvaluated state', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      node.preEvaluated = true;

      expect(sessionIsPreEvaluated(node, ctx)).toBe(true);
    });

    it('writes directly to node when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');

      sessionSetPreEvaluated(node, true, ctx);
      expect(node.preEvaluated).toBe(true);
    });

    it('preEvaluated state is isolated between sessions', () => {
      const ctx1 = new Context();
      const ctx2 = new Context();
      ctx1.createSession();
      ctx2.createSession();
      const node = new Keyword('red');

      sessionSetPreEvaluated(node, true, ctx1);
      sessionSetPreEvaluated(node, false, ctx2);

      expect(sessionIsPreEvaluated(node, ctx1)).toBe(true);
      expect(sessionIsPreEvaluated(node, ctx2)).toBe(false);
      expect(node.preEvaluated).toBe(false);
    });
  });

  describe('sessionGetIndex / sessionSetIndex', () => {
    it('returns node.index when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      node.index = 3;

      expect(sessionGetIndex(node, ctx)).toBe(3);
    });

    it('returns session index when set', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      node.index = 3;

      sessionSetIndex(node, 7, ctx);
      expect(sessionGetIndex(node, ctx)).toBe(7);
      expect(node.index).toBe(3);
    });

    it('writes directly to node when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');

      sessionSetIndex(node, 5, ctx);
      expect(node.index).toBe(5);
    });
  });

  describe('sessionGetSourceParent / sessionSetSourceParent', () => {
    it('returns node.sourceParent when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      const sp = new Keyword('sp');
      node.sourceParent = sp;

      expect(sessionGetSourceParent(node, ctx)).toBe(sp);
    });

    it('returns session sourceParent when set', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      const canonical = new Keyword('canonical-sp');
      const sessionSP = new Keyword('session-sp');
      node.sourceParent = canonical;

      sessionSetSourceParent(node, sessionSP, ctx);
      expect(sessionGetSourceParent(node, ctx)).toBe(sessionSP);
      expect(node.sourceParent).toBe(canonical);
    });

    it('writes directly to node when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      const sp = new Keyword('sp');

      sessionSetSourceParent(node, sp, ctx);
      expect(node.sourceParent).toBe(sp);
    });
  });

  describe('sessionSetRuntimeState', () => {
    it('sets multiple runtime fields at once in a session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');

      sessionSetRuntimeState(node, { index: 4, evaluated: true, preEvaluated: true }, ctx);

      expect(sessionGetIndex(node, ctx)).toBe(4);
      expect(sessionIsEvaluated(node, ctx)).toBe(true);
      expect(sessionIsPreEvaluated(node, ctx)).toBe(true);
      expect(node.index).toBeUndefined();
      expect(node.evaluated).toBe(false);
      expect(node.preEvaluated).toBe(false);
    });

    it('applies directly when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');

      sessionSetRuntimeState(node, { index: 2, evaluated: true }, ctx);

      expect(node.index).toBe(2);
      expect(node.evaluated).toBe(true);
    });
  });

  describe('dependency helpers', () => {
    it('returns null / true without a session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      const depSource = vardecl({ name: 'base', value: any('red') });

      sessionSetDependency(node, {
        dependsOn: new Set([depSource]),
        sourceExpr: node
      }, ctx);

      expect(sessionGetDependency(node, ctx)).toBeNull();
      expect(sessionIsStatic(node, ctx)).toBe(true);
      expect(sessionMergeDependencies([node], ctx)).toBeNull();
    });

    it('stores and merges dependencies in a session', () => {
      const ctx = new Context();
      ctx.createSession();
      const left = new Keyword('left');
      const right = new Keyword('right');
      const depA = vardecl({ name: 'a', value: any('red') });
      const depB = vardecl({ name: 'b', value: any('blue') });

      sessionSetDependency(left, {
        dependsOn: new Set([depA]),
        sourceExpr: left
      }, ctx);
      sessionSetDependency(right, {
        dependsOn: new Set([depB]),
        sourceExpr: right
      }, ctx);

      const merged = sessionMergeDependencies([left, right], ctx);

      expect(sessionIsStatic(left, ctx)).toBe(false);
      expect(merged).not.toBeNull();
      expect(merged?.dependsOn?.has(depA)).toBe(true);
      expect(merged?.dependsOn?.has(depB)).toBe(true);
      expect(merged?.sourceExpr).toBe(left);
    });
  });

  describe('eval isolation regressions', () => {
    it('does not mark canonical operation nodes evaluated in preserve-mode session fallback', async () => {
      const ctx = new Context({ unitMode: 'preserve' });
      ctx.createSession();
      const left = new Dimension({ number: 10, unit: 'px' });
      const right = new Dimension({ number: 2, unit: 'rem' });
      const operation = new Operation([left, '+', right]);

      const result = await operation.eval(ctx);

      expect(String(result)).toContain('calc');
      expect(operation.evaluated).toBe(false);
      expect(left.evaluated).toBe(false);
      expect(right.evaluated).toBe(false);
    });

    it('Operation eval does not overwrite canonical left and right nodes in a session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const left = expr(any('foo'));
      const right = expr(any('bar'));
      const operation = new Operation([left, '/', right]);

      const result = await operation.eval(ctx);

      expect(result.toTrimmedString({ context: ctx })).toBe('foo / bar');
      expect(operation.left).toBe(left);
      expect(operation.right).toBe(right);
      expect(operation.toTrimmedString()).toBe('$(foo) / $(bar)');
    });

    it('Block eval in a non-reset session does not overwrite the canonical child', async () => {
      const ctx = new Context();
      ctx.session = new EvalSession();
      const original = expr(any('red'));
      const node = block(original);

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('{red}');
      expect(node.value).toBe(original);
      expect(sessionGetField(node, 'value', ctx)).not.toBe(original);
    });
  });
});
