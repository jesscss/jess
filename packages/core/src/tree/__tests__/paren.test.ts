import { describe, expect, it } from 'vitest';
import { any, paren, ref, rules, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
import { sessionPatchField } from '../util/session-helpers.js';

describe('Paren', () => {
  it('serializes wrapped values on the public render path', () => {
    const node = paren(any('red'));

    expect(node.toTrimmedString()).toBe('(red)');
  });

  it('reads a session-patched value without changing canonical render output', () => {
    const ctx = new Context();
    ctx.session = new EvalSession();
    const node = paren(any('red'));

    sessionPatchField(node, 'value', any('blue'), ctx);

    expect(node.toTrimmedString({ context: ctx })).toBe('(blue)');
    expect(node.toTrimmedString()).toBe('(red)');
  });

  it('evals in a non-reset session without overwriting the canonical child when the wrapper is preserved', async () => {
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
});
