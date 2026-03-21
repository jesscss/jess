import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { el, selcap, sellist } from '../index.js';
import { sessionPatchField } from '../util/session-helpers.js';

describe('SelectorCapture', () => {
  it('renders session-patched selector values without mutating the canonical node', () => {
    const context = new Context();
    context.createSession();
    const node = selcap(el('.a'));

    sessionPatchField(node, 'value', sellist([el('.x'), el('.y')]), context);

    expect(node.toTrimmedString({ context })).toBe('*[.x,\n.y]');
    expect(node.toTrimmedString()).toBe('*[.a]');
  });

  it('evals the session-patched selector value', async () => {
    const context = new Context();
    context.createSession();
    const node = selcap(el('.a'));

    sessionPatchField(node, 'value', sellist([el('.x'), el('.y')]), context);

    const result = await node.eval(context);
    expect(result.toTrimmedString({ context })).toBe('.x,\n.y');
    expect(node.toTrimmedString()).toBe('*[.a]');
  });
});
