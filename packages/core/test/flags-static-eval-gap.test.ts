import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '../src/context.js';
import {
  F_STATIC,
  any,
  decl,
  el,
  rules,
  ruleset,
  sel,
  sellist
} from '../src/index.js';
import { Rules } from '../src/tree/rules.js';
import { Ruleset } from '../src/tree/ruleset.js';
import { Declaration } from '../src/tree/declaration.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Static stylesheet eval gap', () => {
  function createStaticStylesheet() {
    const selector = sellist([sel([el('.static')])]);
    const declaration = decl({ name: 'color', value: any('red') }) as Declaration;
    const body = rules([declaration]) as Rules;
    const stylesheetRuleset = ruleset({
      selector,
      rules: body
    }) as Ruleset;
    const tree = rules([stylesheetRuleset]) as Rules;

    return {
      selector,
      declaration,
      body,
      stylesheetRuleset,
      tree
    };
  }

  it('first eval keeps the canonical static root and only does one top-level pass', async () => {
    const context = new Context();
    const { selector, declaration, body, stylesheetRuleset, tree } = createStaticStylesheet();

    expect(selector.hasFlag(F_STATIC)).toBe(true);
    expect(declaration.hasFlag(F_STATIC)).toBe(true);
    expect(body.hasFlag(F_STATIC)).toBe(true);
    expect(stylesheetRuleset.hasFlag(F_STATIC)).toBe(true);
    expect(tree.hasFlag(F_STATIC)).toBe(true);

    const rootPreEvalSpy = vi.spyOn(tree, 'preEval');
    const rootEvalNodeSpy = vi.spyOn(tree as unknown as { evalNode: typeof Rules.prototype.eval }, 'evalNode');
    const bodyPreEvalSpy = vi.spyOn(body, 'preEval');
    const bodyEvalNodeSpy = vi.spyOn(body as unknown as { evalNode: typeof Rules.prototype.eval }, 'evalNode');
    const rulesetPreEvalSpy = vi.spyOn(stylesheetRuleset, 'preEval');
    const rulesetEvalNodeSpy = vi.spyOn(stylesheetRuleset as unknown as { evalNode: typeof Ruleset.prototype.eval }, 'evalNode');
    const declPreEvalSpy = vi.spyOn(declaration, 'preEval');
    const declEvalNodeSpy = vi.spyOn(declaration as unknown as { evalNode: typeof Declaration.prototype.eval }, 'evalNode');

    const evald = await tree.eval(context);

    expect(evald).toBe(tree);
    expect(rootPreEvalSpy).toHaveBeenCalledTimes(1);
    expect(rootEvalNodeSpy).toHaveBeenCalledTimes(1);
    expect(rulesetPreEvalSpy).toHaveBeenCalledTimes(1);
    expect(rulesetEvalNodeSpy).not.toHaveBeenCalled();
    expect(bodyPreEvalSpy).not.toHaveBeenCalled();
    expect(bodyEvalNodeSpy).not.toHaveBeenCalled();
    expect(declPreEvalSpy).toHaveBeenCalledTimes(1);
    expect(declEvalNodeSpy).not.toHaveBeenCalled();
  });

  it('only re-eval of an already-evaluated static stylesheet is zero-cost', async () => {
    const context = new Context();
    const { declaration, body, stylesheetRuleset, tree } = createStaticStylesheet();

    await tree.eval(context);

    const rootPreEvalSpy = vi.spyOn(tree, 'preEval');
    const rootEvalNodeSpy = vi.spyOn(tree as unknown as { evalNode: typeof Rules.prototype.eval }, 'evalNode');
    const bodyPreEvalSpy = vi.spyOn(body, 'preEval');
    const bodyEvalNodeSpy = vi.spyOn(body as unknown as { evalNode: typeof Rules.prototype.eval }, 'evalNode');
    const rulesetPreEvalSpy = vi.spyOn(stylesheetRuleset, 'preEval');
    const rulesetEvalNodeSpy = vi.spyOn(stylesheetRuleset as unknown as { evalNode: typeof Ruleset.prototype.eval }, 'evalNode');
    const declPreEvalSpy = vi.spyOn(declaration, 'preEval');
    const declEvalNodeSpy = vi.spyOn(declaration as unknown as { evalNode: typeof Declaration.prototype.eval }, 'evalNode');

    const evald = await tree.eval(context);

    expect(evald).toBe(tree);
    expect(rootPreEvalSpy).not.toHaveBeenCalled();
    expect(rootEvalNodeSpy).not.toHaveBeenCalled();
    expect(bodyPreEvalSpy).not.toHaveBeenCalled();
    expect(bodyEvalNodeSpy).not.toHaveBeenCalled();
    expect(rulesetPreEvalSpy).not.toHaveBeenCalled();
    expect(rulesetEvalNodeSpy).not.toHaveBeenCalled();
    expect(declPreEvalSpy).not.toHaveBeenCalled();
    expect(declEvalNodeSpy).not.toHaveBeenCalled();
  });
});
