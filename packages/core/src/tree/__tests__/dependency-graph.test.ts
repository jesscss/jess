import { describe, expect, it } from 'vitest';
import {
  Context,
  any,
  call,
  decl,
  el,
  list,
  mixin,
  num,
  op,
  ref,
  rules,
  ruleset,
  getDependency,
  vardecl
} from '../../index.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import type { Declaration } from '../declaration.js';
import type { Node } from '../node.js';
import type { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';

function getFirstRuleset(root: Rules): Ruleset {
  const rulesetNode = root.value.find(node => isNode(node, N.Ruleset));
  expect(rulesetNode).toBeDefined();
  return rulesetNode as Ruleset;
}

function collectDeclarations(node: Node): Declaration[] {
  if (isNode(node, N.Declaration)) {
    return [node as Declaration];
  }
  if (isNode(node, N.Rules)) {
    return node.value.flatMap(child => collectDeclarations(child));
  }
  return [];
}

function getDeclarations(node: Ruleset): Declaration[] {
  return collectDeclarations(node.rules);
}

describe('dependency graph propagation', () => {
  it('keeps static literal declarations static', async () => {
    const root = rules([
      ruleset({
        selector: el('.test'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      })
    ]);
    const ctx = new Context();
    ctx.root = root;
    ctx.createSession();

    const evald = await root.eval(ctx);
    const declaration = getDeclarations(getFirstRuleset(evald))[0]!;

    expect(getDependency(declaration.value, ctx)).toBeNull();
  });

  it('tracks direct top-level variable references', async () => {
    const base = vardecl({ name: 'base', value: any('red') });
    const root = rules([
      base,
      ruleset({
        selector: el('.test'),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'base' }, { type: 'variable' }) })
        ])
      })
    ]);
    const ctx = new Context();
    ctx.root = root;
    ctx.createSession();

    const evald = await root.eval(ctx);
    const declaration = getDeclarations(getFirstRuleset(evald))[0]!;
    const dependency = getDependency(declaration.value, ctx);

    expect(dependency).not.toBeNull();
    expect(dependency?.dependsOn?.size).toBe(1);
    expect([...dependency!.dependsOn!].map(dep => dep.name.valueOf())).toEqual(['base']);
  });

  it('propagates dependencies through operations', async () => {
    const base = vardecl({ name: 'base', value: any('10px') });
    const root = rules([
      base,
      ruleset({
        selector: el('.test'),
        rules: rules([
          decl({
            name: 'width',
            value: op([
              ref({ key: 'base' }, { type: 'variable' }),
              '+',
              num(2)
            ])
          })
        ])
      })
    ]);
    const ctx = new Context();
    ctx.root = root;
    ctx.createSession();

    const evald = await root.eval(ctx);
    const declaration = getDeclarations(getFirstRuleset(evald))[0]!;
    const dependency = getDependency(declaration.value, ctx);

    expect(dependency).not.toBeNull();
    expect([...dependency!.dependsOn!].map(dep => dep.name.valueOf())).toEqual(['base']);
  });

  it('treats mixin params with static inputs as static', async () => {
    const passthrough = mixin({
      name: any('.passthrough'),
      params: list([any('value', { role: 'property' })]),
      rules: rules([
        decl({ name: 'color', value: ref({ key: 'value' }, { type: 'variable' }) })
      ])
    });
    const root = rules([
      passthrough,
      ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.passthrough' }, { type: 'mixin' }),
            args: list([any('red')])
          })
        ])
      })
    ]);
    const ctx = new Context();
    ctx.root = root;
    ctx.createSession();

    const evald = await root.eval(ctx);
    const declaration = getDeclarations(getFirstRuleset(evald))[0]!;

    expect(getDependency(declaration.value, ctx)).toBeNull();
  });

  it('tracks top-level vars through mixin parameter binding', async () => {
    const base = vardecl({ name: 'base', value: any('red') });
    const passthrough = mixin({
      name: any('.passthrough'),
      params: list([any('value', { role: 'property' })]),
      rules: rules([
        decl({ name: 'color', value: ref({ key: 'value' }, { type: 'variable' }) })
      ])
    });
    const root = rules([
      base,
      passthrough,
      ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.passthrough' }, { type: 'mixin' }),
            args: list([ref({ key: 'base' }, { type: 'variable' })])
          })
        ])
      })
    ]);
    const ctx = new Context();
    ctx.root = root;
    ctx.createSession();

    const evald = await root.eval(ctx);
    const declaration = getDeclarations(getFirstRuleset(evald))[0]!;
    const dependency = getDependency(declaration.value, ctx);

    expect(dependency).not.toBeNull();
    expect(dependency?.dependsOn?.size).toBe(1);
    expect([...dependency!.dependsOn!].map(dep => dep.name.valueOf())).toEqual(['base']);
  });
});
