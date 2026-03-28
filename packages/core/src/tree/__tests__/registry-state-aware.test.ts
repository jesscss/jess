import { describe, it, expect } from 'vitest';
import { rules, vardecl, decl, any, ref, ruleset, el, mixin, list, call } from '../index.js';
import { Context } from '../../context.js';

describe('Registry state awareness', () => {
  describe('VarDeclaration lookup via state-overlaid children', () => {
    it('find() sees VarDeclarations added to children via eval state overlay', () => {
      const ctx = new Context({ leakyRules: true });
      const root = rules([
        decl({ name: 'color', value: any('red') })
      ]);
      ctx.root = root;

      const colorVar = vardecl({ name: 'color', value: any('blue') });
      ctx.activeState.get(root).fields.set('value', [...root.value, colorVar]);

      const found = root.find('declaration', 'color', 'VarDeclaration', { context: ctx });
      expect(found).toBeDefined();
      expect(found).toBe(colorVar);
    });

    it('find() sees VarDeclarations prepended via eval state overlay', () => {
      const ctx = new Context({ leakyRules: true });
      const body = rules([
        decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
      ]);
      ctx.root = body;

      const paramVar = vardecl({ name: 'color', value: any('blue') });
      ctx.activeState.get(body).fields.set('value', [paramVar, ...body.value]);

      const found = body.find('declaration', 'color', 'VarDeclaration', { context: ctx });
      expect(found).toBeDefined();
      expect(found).toBe(paramVar);
    });

    it('state-overlaid VarDeclaration does not pollute canonical registry', () => {
      const ctx = new Context({ leakyRules: true });
      const root = rules([]);
      ctx.root = root;

      const colorVar = vardecl({ name: 'color', value: any('blue') });
      ctx.activeState.get(root).fields.set('value', [colorVar]);

      expect(root.find('declaration', 'color', 'VarDeclaration', { context: ctx })).toBe(colorVar);
      expect(root.find('declaration', 'color', 'VarDeclaration', {})).toBeUndefined();
    });

    it('different eval states see different VarDeclarations for the same Rules', () => {
      const ctx1 = new Context({ leakyRules: true });
      const ctx2 = new Context({ leakyRules: true });
      const body = rules([]);

      const redVar = vardecl({ name: 'color', value: any('red') });
      const blueVar = vardecl({ name: 'color', value: any('blue') });

      ctx1.activeState.get(body).fields.set('value', [redVar]);
      ctx2.activeState.get(body).fields.set('value', [blueVar]);

      expect(body.find('declaration', 'color', 'VarDeclaration', { context: ctx1 })).toBe(redVar);
      expect(body.find('declaration', 'color', 'VarDeclaration', { context: ctx2 })).toBe(blueVar);
    });
  });

  describe('End-to-end: variable resolution through state-overlaid children', () => {
    it('reference resolves VarDeclaration injected via state overlay', async () => {
      const ctx = new Context({ leakyRules: true });
      ctx.depth = 2;

      const body = rules([
        decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
      ]);
      ctx.root = body;

      const paramVar = vardecl({ name: 'color', value: any('blue') });
      ctx.activeState.get(body).fields.set('value', [paramVar, ...body.value]);

      const evald = await body.eval(ctx);
      const css = evald.render(ctx);
      expect(css).toContain('color: blue');
    });

    it('mixin param binding resolves correctly', async () => {
      const ctx = new Context({ leakyRules: true });
      ctx.depth = 2;

      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([any('color', { role: 'property' })]),
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

      const evald = await root.eval(ctx);
      const css = evald.render(ctx);
      expect(css).toContain('color: blue');
    });

    it('two calls to same mixin with different args produce different output', async () => {
      const ctx = new Context({ leakyRules: true });
      ctx.depth = 2;

      const mixinDef = mixin({
        name: any('.color-mixin'),
        params: list([
          vardecl({ name: 'color', value: any('red') }, { paramVar: true })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      const call1 = ruleset({
        selector: el('.a'),
        rules: rules([
          call({
            name: ref({ key: '.color-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      const call2 = ruleset({
        selector: el('.b'),
        rules: rules([
          call({
            name: ref({ key: '.color-mixin' }, { type: 'mixin' }),
            args: list([any('green')])
          })
        ])
      });

      const root = rules([mixinDef, call1, call2]);
      ctx.root = root;

      const evald = await root.eval(ctx);
      const css = evald.render(ctx);
      expect(css).toContain('.a');
      expect(css).toContain('color: blue');
      expect(css).toContain('.b');
      expect(css).toContain('color: green');
    });
  });

  describe('Subtree boundary crossing', () => {
    it('getParent walks from subtree state into parent state', () => {
      const { getParent, setParent } = require('../util/field-helpers.js');
      const { EvalState } = require('../../eval-state.js');
      const ctx = new Context({ leakyRules: true });

      const root = rules([]);
      const outerScope = rules([]);
      const body = rules([
        decl({ name: 'color', value: any('red') })
      ]);
      ctx.root = root;

      // Root state: outerScope's parent is root
      setParent(outerScope, root, ctx);

      // Push subtree: body's parent is outerScope
      const subtree = new EvalState();
      ctx.pushState(subtree);
      setParent(body, outerScope, ctx);

      // From inside the subtree, getParent(body) should find outerScope
      expect(getParent(body, ctx)).toBe(outerScope);

      // getParent(outerScope) should find root — THIS CROSSES THE BOUNDARY
      expect(getParent(outerScope, ctx)).toBe(root);

      ctx.popState();
    });

    it('variable lookup crosses subtree boundary to find param in parent scope', async () => {
      const { setParent } = require('../util/field-helpers.js');
      const { EvalState } = require('../../eval-state.js');
      const ctx = new Context({ leakyRules: true });
      ctx.depth = 2;

      const paramVar = vardecl({ name: 'color', value: any('blue') });
      const paramScope = rules([paramVar]);
      const body = rules([
        decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
      ]);
      const root = rules([]);
      ctx.root = root;

      // Root state: paramScope parent is root
      setParent(paramScope, root, ctx);

      // Push subtree
      const callSubtree = new EvalState();
      ctx.pushState(callSubtree);

      // In subtree: body parent is paramScope
      setParent(body, paramScope, ctx);
      ctx.rulesContext = paramScope;

      const evald = await body.eval(ctx);
      const css = evald.render(ctx);

      ctx.popState();

      expect(css).toContain('color: blue');
    });
  });
});
