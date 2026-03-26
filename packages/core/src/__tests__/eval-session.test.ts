import { describe, it, expect } from 'vitest';
import { EvalSession, SessionInstanceRoot } from '../eval-session.js';
import { Keyword, Dimension, Context, vardecl, any, num, Operation, decl, el, rules, rawrules, ruleset, atrule, seq, mixin, list, condition, call, pseudo, sellist, sel, compound, co, expr, paren, quoted, url, selcap, query, fn, range, ref, interpolated, interpolatedSelector, js, jsfunc, block, Negative, rest, attr, nil } from '../index.js';
import type { Rules as RulesType } from '../tree/rules.js';
import { AssignmentType } from '../tree/declaration.js';
import {
  getDependency,
  getField,
  getParent,
  getIndex,
  getSourceParent,
  isEvaluated,
  isPreEvaluated,
  isStatic,
  setIndex,
  mergeDependencies,
  setField,
  getChildren,
  appendChildren,
  prependChildren,
  removeChild,
  setDependency,
  setEvaluated,
  setParent,
  setPreEvaluated,
  replaceNode,
  setSourceParent,
  setRuntimeState
} from '../tree/util/session-helpers.js';

describe('EvalSession', () => {
  describe('field patches', () => {
    it('stores and retrieves patched fields', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      session.setField(node, 'value', 'blue');
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

      session.setField(node, 'value', undefined);
      expect(session.hasField(node, 'value')).toBe(true);
      expect(session.getField(node, 'value')).toBeUndefined();
    });

    it('does not mutate the original node', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      session.setField(node, 'value', 'blue');
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

      session.setField(node, 'value', 'blue');
      expect(session.hasPatches(node)).toBe(true);
    });
  });

  describe('session isolation', () => {
    it('patches in one session do not affect another', () => {
      const session1 = new EvalSession();
      const session2 = new EvalSession();
      const node = new Keyword('red');

      session1.setField(node, 'value', 'blue');
      session2.setField(node, 'value', 'green');

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
  describe('getField / setField', () => {
    it('falls through to node field when no session', () => {
      const ctx = new Context();
      const node = new Dimension({ number: 10, unit: 'px' });

      expect(getField<number>(node, 'number', ctx)).toBe(10);
    });

    it('reads patched value when session exists', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Dimension({ number: 10, unit: 'px' });

      setField(node, 'number', 20, ctx);
      expect(getField<number>(node, 'number', ctx)).toBe(20);
      expect(node.number).toBe(10);
    });

    it('falls through to node for unpatched fields with session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Dimension({ number: 10, unit: 'px' });

      expect(getField<number>(node, 'number', ctx)).toBe(10);
    });

    it('writes directly to node when no session', () => {
      const ctx = new Context();
      const node = new Dimension({ number: 10, unit: 'px' });

      setField(node, 'number', 20, ctx);
      expect(node.number).toBe(20);
    });

    it('Declaration rendering reads patched fields from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = decl({ name: 'color', value: any('red') });

      setField(node, 'name', any('background', { role: 'property' }), ctx);
      setField(node, 'value', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('background: blue');
      expect(node.toTrimmedString()).toBe('color: red');
    });

    it('Declaration preEval keeps assignment-option normalization session-local', async () => {
      const ctx = new Context();
      ctx.session = new EvalSession();
      const node = decl(
        { name: 'color', value: any('red') },
        { assign: AssignmentType.Add }
      );

      const preEvald = await node.preEval(ctx);

      expect(preEvald.toTrimmedString({ context: ctx })).toContain('color:');
      expect(preEvald.toTrimmedString({ context: ctx })).not.toContain('+:');
      expect(node.toTrimmedString()).toContain('+:');
      expect(node.options?.normalizedFromAssign).toBeUndefined();
    });

    it('Ruleset rendering reads patched selector and rules from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = ruleset({
        selector: el('.a'),
        rules: rules([decl({ name: 'color', value: any('red') })])
      });
      const patchedRules = rules([decl({ name: 'background', value: any('blue') })]);

      setField(node, 'selector', el('.b'), ctx);
      setField(node, 'rules', patchedRules, ctx);

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

      setField(node, 'name', any('@supports', { role: 'atkeyword' }), ctx);
      setField(node, 'prelude', seq([any('(display:grid)')]), ctx);
      setField(node, 'rules', patchedRules, ctx);

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

      setField(node, 'name', any('.patched'), ctx);
      setField(node, 'params', list([any('size', { role: 'property' })]), ctx);
      setField(node, 'guard', condition([any('true')]), ctx);
      setField(node, 'rules', patchedRules, ctx);

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

    it('Mixin preEval keeps rulesVisibility writes off the canonical rules child in a session', async () => {
      const ctx = new Context({ leakyRules: false });
      ctx.depth = 2;
      ctx.createSession();
      const mixinDef = mixin({
        name: any('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const canonicalVisibility = { ...mixinDef.rules.options.rulesVisibility };

      const preEvald = await mixinDef.preEval(ctx);

      expect(preEvald.rules).not.toBe(mixinDef.rules);
      expect(preEvald.rules.options.rulesVisibility.Mixin).toBe('private');
      expect(preEvald.rules.options.rulesVisibility.VarDeclaration).toBe('private');
      expect(mixinDef.rules.options.rulesVisibility).toEqual(canonicalVisibility);
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

      setField(node, 'name', any('hsl'), ctx);
      setField(node, 'args', list([any('120deg'), any('50%')]), ctx);
      setField(node, 'contentNode', any('patched'), ctx);

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

    it('Call fallback materialization keeps canonical arg spacing unchanged in a session', async () => {
      const ctx = new Context();
      ctx.session = new EvalSession();
      const second = num(2);
      second.pre = 0;
      const arg = seq([num(1), second]);
      const node = call({
        name: ref('fn', { type: 'variable', fallbackValue: true }),
        args: list([arg])
      }, { silentFail: true });
      const root = rules([
        vardecl({
          name: any('fn'),
          value: jsfunc({ name: 'fn', fn: () => {
            throw new Error('boom');
          } })
        }),
        node
      ]);
      ctx.root = root;

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('fn(1 2)');
      expect(arg.toTrimmedString()).toBe('12');
      expect(second.pre).toBe(0);
    });

    it('Call fallback materialization keeps a patched content node session-local', async () => {
      const ctx = new Context();
      ctx.session = new EvalSession();
      const node = call({
        name: ref('fn', { type: 'variable', fallbackValue: true }),
        args: list([num(1)])
      }, { silentFail: true });
      const root = rules([
        vardecl({
          name: any('fn'),
          value: jsfunc({ name: 'fn', fn: () => {
            throw new Error('boom');
          } })
        }),
        node
      ]);
      ctx.root = root;

      setField(node, 'contentNode', any('patched'), ctx);

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('fn(1): patched');
      expect(node.contentNode).toBeUndefined();
      expect(node.toTrimmedString()).toBe('$fn??(1)');
    });

    it('PseudoSelector rendering reads patched name and arg from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = pseudo({
        name: ':not',
        arg: any('red')
      });

      setField(node, 'name', ':where', ctx);
      setField(node, 'arg', any('blue'), ctx);

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

      setField(node, 'value', [el('.x'), el('.y')], ctx);

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

      setField(node, 'value', [el('.x'), co('>'), el('.y') as any], ctx);

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

    it('ComplexSelector preserves session-only hoist propagation when collapsing to one child', async () => {
      const ctx = new Context();
      ctx.session = new EvalSession();
      const child = el('.target');
      const node = sel([child]);

      setField(node, 'hoistToRoot', true, ctx);

      const evald = await node.eval(ctx);

      expect(getField<boolean | undefined>(evald, 'hoistToRoot', ctx)).toBe(true);
      expect(evald.hoistToRoot).toBeUndefined();
      expect(node.hoistToRoot).toBeUndefined();
    });

    it('CompoundSelector rendering reads patched components from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = compound([el('button') as any, el('.a') as any]);

      setField(node, 'value', [el('input') as any, el('.b') as any], ctx);

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

      setField(node, 'value', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('$(blue)');
      expect(node.toTrimmedString()).toBe('$(red)');
    });

    it('Paren rendering reads a patched child from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = paren(any('red'));

      setField(node, 'value', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('(blue)');
      expect(node.toTrimmedString()).toBe('(red)');
    });

    it('Paren eval keeps wrapper child replacement session-local', async () => {
      const ctx = new Context();
      ctx.session = new EvalSession();
      const original = ref({ key: 'color' }, { type: 'variable' });
      const root = rules([
        vardecl({ name: 'color', value: any('red') })
      ]);
      const node = paren(original);
      ctx.root = root;
      ctx.rulesContext = root;

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('(red)');
      expect(node.value).toBe(original);
      expect(node.toTrimmedString()).toBe('($color)');
    });

    it('Block rendering reads a patched child from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = block(any('red'));

      setField(node, 'value', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('{blue}');
      expect(node.toTrimmedString()).toBe('{red}');
    });

    it('Negative rendering and eval read a patched child from the active session', async () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Negative(new Dimension({ number: 2, unit: 'px' }));
      const renderPatched = new Dimension({ number: 3, unit: 'px' });

      setField(node, 'value', renderPatched, ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('-3px');
      expect(node.toTrimmedString()).toBe('-2px');

      const preEvald = await node.preEval(ctx);
      if (!(preEvald instanceof Negative)) {
        throw new TypeError('Expected Negative.preEval() to return a Negative');
      }
      const evalPatched = new Dimension({ number: 4, unit: 'px' });
      setField(preEvald, 'value', evalPatched, ctx);

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

      setField(node, 'value', 'tail', ctx);

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

      setField(node, 'name', any('data-theme'), ctx);
      setField(node, 'value', quoted('blue'), ctx);

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

      setField(node, 'value', renderPatched, ctx);

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
      setField(preEvald, 'value', evalPatched, ctx);

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

      setField(node, 'value', any('blue'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('\"blue\"');
      expect(node.toTrimmedString()).toBe('\"red\"');
    });

    it('Quoted eval keeps evaluated child replacement session-local', async () => {
      const ctx = new Context();
      ctx.createSession();
      const node = quoted(interpolated({
        source: '%%',
        replacements: [expr(any('blue'))]
      }));

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('"blue"');
      expect(node.toTrimmedString()).toBe('"$(blue)"');
      expect(node.value).toBeTypeOf('object');
      expect(node.value).not.toBe('blue');
    });

    it('Url rendering reads a patched child from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = url(quoted('a.png'));

      setField(node, 'value', quoted('b.png'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('url(\"b.png\")');
      expect(node.toTrimmedString()).toBe('url(\"a.png\")');
    });

    it('Url eval keeps evaluated child replacement session-local', async () => {
      const ctx = new Context();
      ctx.session = new EvalSession();
      const original = quoted(interpolated({
        source: '%%.png',
        replacements: [expr(any('blue'))]
      }));
      const node = url(original);

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('url("blue.png")');
      expect(node.value).toBe(original);
      expect(node.toTrimmedString()).toBe('url("$(blue).png")');
    });

    it('SelectorCapture rendering reads a patched child from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = selcap(el('.a'));

      setField(node, 'value', sellist([el('.x'), el('.y')]), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('*[.x,\n.y]');
      expect(node.toTrimmedString()).toBe('*[.a]');
    });

    it('SelectorCapture eval keeps a patched selector value session-local', async () => {
      const ctx = new Context();
      ctx.createSession();
      const node = selcap(el('.a'));

      setField(node, 'value', sellist([el('.x'), el('.y')]), ctx);

      const result = await node.eval(ctx);

      expect(result.toTrimmedString({ context: ctx })).toBe('.x,\n.y');
      expect(node.toTrimmedString()).toBe('*[.a]');
      expect(node.value.toTrimmedString()).toBe('.a');
    });

    it('List rendering reads patched items from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = list([any('red'), any('blue')]);

      setField(node, 'value', [any('cyan'), any('magenta')], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('cyan, magenta');
      expect(node.toTrimmedString()).toBe('red, blue');
    });

    it('List operate uses patched items without mutating the canonical list', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = list([any('red')]);

      setField(node, 'value', [any('cyan'), any('magenta')], ctx);

      const result = node.operate(any('black'), '+', ctx);

      expect(result.toTrimmedString({ context: ctx })).toBe('cyan, magenta, black');
      expect(node.toTrimmedString()).toBe('red');
      expect(node.value.map(item => item.toTrimmedString())).toEqual(['red']);
    });

    it('Sequence rendering reads patched items from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = seq([any('red'), any('blue')]);

      setField(node, 'value', [any('cyan'), any('magenta')], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('cyan magenta');
      expect(node.toTrimmedString()).toBe('red blue');
    });

    it('Sequence eval keeps session-only value writes off the canonical node', async () => {
      const ctx = new Context();
      ctx.session = new EvalSession();
      const node = seq([num(10), nil(), num(20)]);

      const evald = await node.eval(ctx);

      expect(evald.toTrimmedString({ context: ctx })).toBe('10 20');
      expect(node.value.map(item => item.type)).toEqual(['Num', 'Nil', 'Num']);
    });

    it('QueryCondition rendering reads patched items from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = query([any('screen'), any('and'), paren(any('color'))]);

      setField(node, 'value', [any('print'), any('and'), paren(any('monochrome'))], ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('print and (monochrome)');
      expect(node.toTrimmedString()).toBe('screen and (color)');
    });

    it('Condition rendering reads patched operands from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = condition([any('a'), '=', any('b')]);

      setField(node, 'left', any('x'), ctx);
      setField(node, 'operator', '>=', ctx);
      setField(node, 'right', any('y'), ctx);

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

      setField(node, 'name', any('patched'), ctx);
      setField(node, 'params', list([any('size')]), ctx);
      setField(node, 'body', patchedBody, ctx);

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

      setField(node, 'params', patchedParams, ctx);
      setField(node, 'body', patchedBody, ctx);

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

      setField(node, 'start', any('2'), ctx);
      setField(node, 'end', any('4'), ctx);
      setField(node, 'step', any('3'), ctx);

      expect(node.toTrimmedString({ context: ctx })).toBe('2 to <4 step 3');
      expect(node.toTrimmedString()).toBe('1 to <3 step 2');
    });

    it('Reference rendering reads patched target and key from the active session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = ref({ target: ref('ns'), key: 'foo' }, { type: 'declaration' });

      setField(node, 'target', ref('theme'), ctx);
      setField(node, 'key', 'bar', ctx);

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
      setField(lookup, 'key', 'bar', ctx);
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

      setField(node, 'source', 'color-%%', ctx);
      setField(node, 'replacements', [any('blue')], ctx);

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

      setField(node, 'path', quoted('b.js'), ctx);
      setField(node, 'imports', [['bar', 'baz']], ctx);

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

  describe('getParent / setParent', () => {
    it('returns node.parent when no session', () => {
      const ctx = new Context();
      const child = new Keyword('red');
      const parent = new Keyword('container');
      parent.adopt(child);

      expect(getParent(child, ctx)).toBe(parent);
    });

    it('returns session parent when set in session', () => {
      const ctx = new Context();
      ctx.createSession();
      const child = new Keyword('red');
      const sessionParent = new Keyword('session-parent');

      setParent(child, sessionParent, ctx);
      expect(getParent(child, ctx)).toBe(sessionParent);
    });
  });

  describe('session Rules child helpers', () => {
    it('getChildren falls through to canonical rules without a session overlay', () => {
      const ctx = new Context();
      const child = decl({ name: 'color', value: any('red') });
      const node = rules([child]);

      expect(getChildren(node, ctx)).toEqual([child]);
    });

    it('appendChildren appends without mutating canonical Rules.value', () => {
      const ctx = new Context();
      ctx.createSession();
      const child = decl({ name: 'color', value: any('red') });
      const appended = decl({ name: 'background', value: any('blue') });
      const node = rules([child]);

      appendChildren(node, [appended], ctx);

      expect(getChildren(node, ctx)).toEqual([child, appended]);
      expect(node.value).toEqual([child]);
      expect(getParent(appended, ctx)).toBe(node);
      expect(appended.parent).toBeUndefined();
    });

    it('prependChildren prepends without mutating canonical Rules.value', () => {
      const ctx = new Context();
      ctx.createSession();
      const child = decl({ name: 'color', value: any('red') });
      const prepended = decl({ name: 'background', value: any('blue') });
      const node = rules([child]);

      prependChildren(node, [prepended], ctx);

      expect(getChildren(node, ctx)).toEqual([prepended, child]);
      expect(node.value).toEqual([child]);
      expect(getParent(prepended, ctx)).toBe(node);
    });

    it('removeChild removes from the session overlay without mutating canonical Rules.value', () => {
      const ctx = new Context();
      ctx.createSession();
      const first = decl({ name: 'color', value: any('red') });
      const second = decl({ name: 'background', value: any('blue') });
      const node = rules([first, second]);

      removeChild(node, first, ctx);

      expect(getChildren(node, ctx)).toEqual([second]);
      expect(node.value).toEqual([first, second]);
      expect(getParent(first, ctx)).toBeUndefined();
      expect(first.parent).toBe(node);
    });

    it('replaceNode replaces inside the session overlay without mutating canonical Rules.value', () => {
      const ctx = new Context();
      ctx.createSession();
      const first = decl({ name: 'color', value: any('red') });
      const second = decl({ name: 'background', value: any('blue') });
      const replacement = decl({ name: 'border', value: any('black') });
      const node = rules([first, second]);

      replaceNode(first, replacement, ctx);

      expect(getChildren(node, ctx)).toEqual([replacement, second]);
      expect(node.value).toEqual([first, second]);
      expect(getParent(replacement, ctx)).toBe(node);
      expect(getParent(first, ctx)).toBeUndefined();
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

      replaceNode(first, replacement, ctx);
      appendChildren(node, [appended], ctx);

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

      replaceNode(first, replacement, ctx);
      appendChildren(node, [appended], ctx);

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

      replaceNode(first, replacement, ctx);

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

      replaceNode(first, replacement, ctx);

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

  describe('isEvaluated / setEvaluated', () => {
    it('returns node.evaluated when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      node.evaluated = true;

      expect(isEvaluated(node, ctx)).toBe(true);
    });

    it('returns session evaluated state when set', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      node.evaluated = false;

      setEvaluated(node, true, ctx);
      expect(isEvaluated(node, ctx)).toBe(true);
      expect(node.evaluated).toBe(false);
    });

    it('falls through to node when session has no evaluated state', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      node.evaluated = true;

      expect(isEvaluated(node, ctx)).toBe(true);
    });
  });

  describe('isPreEvaluated / setPreEvaluated', () => {
    it('returns node.preEvaluated when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      node.preEvaluated = true;

      expect(isPreEvaluated(node, ctx)).toBe(true);
    });

    it('returns session preEvaluated state when set', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      node.preEvaluated = false;

      setPreEvaluated(node, true, ctx);
      expect(isPreEvaluated(node, ctx)).toBe(true);
      expect(node.preEvaluated).toBe(false);
    });

    it('falls through to node when session has no preEvaluated state', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      node.preEvaluated = true;

      expect(isPreEvaluated(node, ctx)).toBe(true);
    });

    it('writes directly to node when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');

      setPreEvaluated(node, true, ctx);
      expect(node.preEvaluated).toBe(true);
    });

    it('preEvaluated state is isolated between sessions', () => {
      const ctx1 = new Context();
      const ctx2 = new Context();
      ctx1.createSession();
      ctx2.createSession();
      const node = new Keyword('red');

      setPreEvaluated(node, true, ctx1);
      setPreEvaluated(node, false, ctx2);

      expect(isPreEvaluated(node, ctx1)).toBe(true);
      expect(isPreEvaluated(node, ctx2)).toBe(false);
      expect(node.preEvaluated).toBe(false);
    });
  });

  describe('getIndex / setIndex', () => {
    it('returns node.index when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      node.index = 3;

      expect(getIndex(node, ctx)).toBe(3);
    });

    it('returns session index when set', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      node.index = 3;

      setIndex(node, 7, ctx);
      expect(getIndex(node, ctx)).toBe(7);
      expect(node.index).toBe(3);
    });

    it('writes directly to node when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');

      setIndex(node, 5, ctx);
      expect(node.index).toBe(5);
    });
  });

  describe('getSourceParent / setSourceParent', () => {
    it('returns node.sourceParent when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      const sp = new Keyword('sp');
      node.sourceParent = sp;

      expect(getSourceParent(node, ctx)).toBe(sp);
    });

    it('returns session sourceParent when set', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');
      const canonical = new Keyword('canonical-sp');
      const sessionSP = new Keyword('session-sp');
      node.sourceParent = canonical;

      setSourceParent(node, sessionSP, ctx);
      expect(getSourceParent(node, ctx)).toBe(sessionSP);
      expect(node.sourceParent).toBe(canonical);
    });

    it('writes directly to node when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      const sp = new Keyword('sp');

      setSourceParent(node, sp, ctx);
      expect(node.sourceParent).toBe(sp);
    });
  });

  describe('setRuntimeState', () => {
    it('sets multiple runtime fields at once in a session', () => {
      const ctx = new Context();
      ctx.createSession();
      const node = new Keyword('red');

      setRuntimeState(node, { index: 4, evaluated: true, preEvaluated: true }, ctx);

      expect(getIndex(node, ctx)).toBe(4);
      expect(isEvaluated(node, ctx)).toBe(true);
      expect(isPreEvaluated(node, ctx)).toBe(true);
      expect(node.index).toBeUndefined();
      expect(node.evaluated).toBe(false);
      expect(node.preEvaluated).toBe(false);
    });

    it('applies directly when no session', () => {
      const ctx = new Context();
      const node = new Keyword('red');

      setRuntimeState(node, { index: 2, evaluated: true }, ctx);

      expect(node.index).toBe(2);
      expect(node.evaluated).toBe(true);
    });
  });

  describe('dependency helpers', () => {
    it('returns null / true without a session', () => {
      const ctx = new Context();
      const node = new Keyword('red');
      const depSource = vardecl({ name: 'base', value: any('red') });

      setDependency(node, {
        dependsOn: new Set([depSource]),
        sourceExpr: node
      }, ctx);

      expect(getDependency(node, ctx)).toBeNull();
      expect(isStatic(node, ctx)).toBe(true);
      expect(mergeDependencies([node], ctx)).toBeNull();
    });

    it('stores and merges dependencies in a session', () => {
      const ctx = new Context();
      ctx.createSession();
      const left = new Keyword('left');
      const right = new Keyword('right');
      const depA = vardecl({ name: 'a', value: any('red') });
      const depB = vardecl({ name: 'b', value: any('blue') });

      setDependency(left, {
        dependsOn: new Set([depA]),
        sourceExpr: left
      }, ctx);
      setDependency(right, {
        dependsOn: new Set([depB]),
        sourceExpr: right
      }, ctx);

      const merged = mergeDependencies([left, right], ctx);

      expect(isStatic(left, ctx)).toBe(false);
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
      expect(getField(node, 'value', ctx)).not.toBe(original);
    });
  });

  describe('SessionInstanceRoot', () => {
    it('creates instance roots over a canonical subtree', () => {
      const session = new EvalSession();
      const canonical = rules([decl({ name: 'color', value: new Keyword('red') })]);

      const root1 = session.createInstanceRoot(canonical);
      const root2 = session.createInstanceRoot(canonical);
      const root3 = session.createInstanceRoot(canonical);

      expect(root1.sourceRoot).toBe(canonical);
      expect(root2.sourceRoot).toBe(canonical);
      expect(root3.sourceRoot).toBe(canonical);

      expect(root1.id).not.toBe(root2.id);
      expect(root2.id).not.toBe(root3.id);

      expect(session.getInstanceRoots()).toHaveLength(3);
      expect(session.getInstanceRootsFor(canonical)).toHaveLength(3);
    });

    it('holds independent sparse shadow state per root', () => {
      const session = new EvalSession();
      const canonical = rules([decl({ name: 'color', value: new Keyword('red') })]);
      const colorDecl = canonical.value[0]!;

      const root1 = session.createInstanceRoot(canonical);
      const root2 = session.createInstanceRoot(canonical);
      const root3 = session.createInstanceRoot(canonical);

      // Root 2 patches the color to blue
      root2.setField(colorDecl, 'value', new Keyword('blue'));

      // Root 3 patches the color to green
      root3.setField(colorDecl, 'value', new Keyword('green'));

      // Root 1 has no shadow entry — source-backed
      expect(root1.hasShadow(colorDecl)).toBe(false);
      expect(root1.getField(colorDecl, 'value')).toBeUndefined();

      // Root 2 has its own patch
      expect(root2.hasShadow(colorDecl)).toBe(true);
      expect(root2.getField(colorDecl, 'value')).toBeInstanceOf(Keyword);
      expect((root2.getField(colorDecl, 'value') as any).value).toBe('blue');

      // Root 3 has its own independent patch
      expect(root3.hasShadow(colorDecl)).toBe(true);
      expect((root3.getField(colorDecl, 'value') as any).value).toBe('green');

      // Canonical node is unmodified
      expect((colorDecl as any).value).toBeInstanceOf(Keyword);
    });

    it('tracks shadow count per root (sparsity proof)', () => {
      const session = new EvalSession();
      const canonical = rules([
        decl({ name: 'color', value: new Keyword('red') }),
        decl({ name: 'background', value: new Keyword('white') }),
        decl({ name: 'border', value: new Keyword('none') })
      ]);

      const root1 = session.createInstanceRoot(canonical);
      const root2 = session.createInstanceRoot(canonical);

      // Root 1: no changes — zero shadow entries
      expect(root1.shadowCount).toBe(0);

      // Root 2: change only the color declaration
      const colorDecl = canonical.value[0]!;
      root2.setField(colorDecl, 'value', new Keyword('blue'));

      // Only 1 shadow entry despite 3 declarations in the tree
      expect(root2.shadowCount).toBe(1);

      // border and background stay source-backed
      expect(root2.hasShadow(canonical.value[1]!)).toBe(false);
      expect(root2.hasShadow(canonical.value[2]!)).toBe(false);
    });

    it('holds independent runtime state per root', () => {
      const session = new EvalSession();
      const canonical = rules([decl({ name: 'color', value: new Keyword('red') })]);
      const colorDecl = canonical.value[0]!;

      const root1 = session.createInstanceRoot(canonical);
      const root2 = session.createInstanceRoot(canonical);

      // Each root can set different parent for the same canonical node
      const parent1 = rules([]);
      const parent2 = rules([]);
      root1.getRuntime(colorDecl).parent = parent1;
      root2.getRuntime(colorDecl).parent = parent2;

      expect(root1.getRuntime(colorDecl).parent).toBe(parent1);
      expect(root2.getRuntime(colorDecl).parent).toBe(parent2);
    });

    it('binding deltas are per-root', () => {
      const session = new EvalSession();
      const canonical = rules([decl({ name: 'color', value: new Keyword('red') })]);

      const root1 = session.createInstanceRoot(canonical);
      const root2 = session.createInstanceRoot(canonical);
      const root3 = session.createInstanceRoot(canonical);

      // Root 1: no bindings (default)
      // Root 2: override @color to blue
      root2.bindings = new Map([['@color', new Keyword('blue')]]);
      // Root 3: override @color to green
      root3.bindings = new Map([['@color', new Keyword('green')]]);

      expect(root1.bindings).toBeUndefined();
      expect(root2.bindings!.get('@color')!.value).toBe('blue');
      expect(root3.bindings!.get('@color')!.value).toBe('green');
    });

    it('roots for different canonical subtrees do not mix', () => {
      const session = new EvalSession();
      const treeA = rules([decl({ name: 'a', value: new Keyword('1') })]);
      const treeB = rules([decl({ name: 'b', value: new Keyword('2') })]);

      session.createInstanceRoot(treeA);
      session.createInstanceRoot(treeA);
      session.createInstanceRoot(treeB);

      expect(session.getInstanceRootsFor(treeA)).toHaveLength(2);
      expect(session.getInstanceRootsFor(treeB)).toHaveLength(1);
      expect(session.getInstanceRoots()).toHaveLength(3);
    });

    it('Context carries the active instance root', () => {
      const session = new EvalSession();
      const canonical = rules([decl({ name: 'color', value: new Keyword('red') })]);
      const root = session.createInstanceRoot(canonical);

      const ctx = new Context();
      ctx.session = session;
      ctx.instanceRoot = root;

      expect(ctx.instanceRoot).toBe(root);
      expect(ctx.instanceRoot!.session).toBe(session);
      expect(ctx.instanceRoot!.sourceRoot).toBe(canonical);
    });

    it('session helpers route through active instance root', () => {
      const session = new EvalSession();
      const node = new Keyword('red');

      const container = rules([]);
      const root1 = session.createInstanceRoot(container);
      const root2 = session.createInstanceRoot(container);

      const ctx = new Context();
      ctx.session = session;

      // Patch via root1
      ctx.instanceRoot = root1;
      setField(node, 'value', 'blue', ctx);
      setParent(node, container, ctx);
      setEvaluated(node, true, ctx);

      // Patch via root2
      ctx.instanceRoot = root2;
      setField(node, 'value', 'green', ctx);
      setParent(node, undefined, ctx);
      setEvaluated(node, false, ctx);

      // Read back from root1
      ctx.instanceRoot = root1;
      expect(getField(node, 'value', ctx)).toBe('blue');
      expect(getParent(node, ctx)).toBe(container);
      expect(isEvaluated(node, ctx)).toBe(true);

      // Read back from root2 — independent
      ctx.instanceRoot = root2;
      expect(getField(node, 'value', ctx)).toBe('green');
      expect(getParent(node, ctx)).toBeUndefined();
      expect(isEvaluated(node, ctx)).toBe(false);

      // Without instance root, falls through to session (nothing there), then canonical
      ctx.instanceRoot = undefined;
      expect(getField(node, 'value', ctx)).toBe('red');
    });

    it('instance root children overlay is independent per root', () => {
      const session = new EvalSession();
      const child1 = decl({ name: 'a', value: new Keyword('1') });
      const child2 = decl({ name: 'b', value: new Keyword('2') });
      const child3 = decl({ name: 'c', value: new Keyword('3') });
      const canonical = rules([child1, child2]) as RulesType;

      const root1 = session.createInstanceRoot(canonical);
      const root2 = session.createInstanceRoot(canonical);

      const ctx = new Context();
      ctx.session = session;

      // Root 1: append child3
      ctx.instanceRoot = root1;
      appendChildren(canonical, [child3], ctx);

      // Root 2: no changes
      ctx.instanceRoot = root2;

      // Root 1 sees 3 children
      ctx.instanceRoot = root1;
      expect(getChildren(canonical, ctx)).toHaveLength(3);

      // Root 2 sees original 2 children (source-backed)
      ctx.instanceRoot = root2;
      expect(getChildren(canonical, ctx)).toHaveLength(2);

      // No instance root: also sees original 2
      ctx.instanceRoot = undefined;
      expect(getChildren(canonical, ctx)).toHaveLength(2);
    });

    it('instance root field patches override session-level patches', () => {
      const session = new EvalSession();
      const node = new Keyword('red');
      const container = rules([]);
      const root = session.createInstanceRoot(container);

      const ctx = new Context();
      ctx.session = session;

      // Session-level patch
      session.setField(node, 'value', 'blue');

      // Without instance root, see session patch
      expect(getField(node, 'value', ctx)).toBe('blue');

      // Instance root overrides session
      ctx.instanceRoot = root;
      root.setField(node, 'value', 'green');
      expect(getField(node, 'value', ctx)).toBe('green');

      // Session still has its own value
      ctx.instanceRoot = undefined;
      expect(getField(node, 'value', ctx)).toBe('blue');

      // Canonical is untouched
      expect(node.value).toBe('red');
    });

    it('dependency reach narrows affected nodes', () => {
      const session = new EvalSession();
      const colorVar = vardecl({ name: any('@color'), value: new Keyword('red') });
      const bgVar = vardecl({ name: any('@bg'), value: new Keyword('white') });
      const colorNode = new Keyword('red');
      const bgNode = new Keyword('white');
      const borderNode = new Keyword('none');

      const container = rules([colorVar, bgVar]);
      const root = session.createInstanceRoot(container);

      // Mark dependencies: colorNode depends on @color, bgNode depends on @bg
      session.setDependency(colorNode, { dependsOn: new Set([colorVar]) });
      session.setDependency(bgNode, { dependsOn: new Set([bgVar]) });
      // borderNode has no dependencies (static)

      // Root changes only @color
      root.setField(colorNode, 'value', new Keyword('blue'));
      root.setField(bgNode, 'value', new Keyword('gray'));
      root.setField(borderNode, 'value', new Keyword('solid'));

      // Compute reach for only @color changed
      const reach = root.computeDependencyReach(new Set([colorVar]));

      // Only colorNode is affected
      expect(reach.affectedNodes.size).toBe(1);
      expect(reach.affectedNodes.has(colorNode)).toBe(true);
      expect(reach.affectedNodes.has(bgNode)).toBe(false);
      expect(reach.affectedNodes.has(borderNode)).toBe(false);

      // isAffected reflects the same
      expect(root.isAffected(colorNode)).toBe(true);
      expect(root.isAffected(bgNode)).toBe(false);
      expect(root.isAffected(borderNode)).toBe(false);
    });

    it('isAffected is conservative when no reach computed', () => {
      const session = new EvalSession();
      const container = rules([]);
      const root = session.createInstanceRoot(container);
      const node = new Keyword('test');

      // No computeDependencyReach called — should be conservative (true)
      expect(root.isAffected(node)).toBe(true);
    });
  });
});
