import { any, vardecl, rules } from '../index.js';
import { Context } from '../../context.js';
import {
  assignScopeFrameVariable,
  lookupScopeFrameVariable
} from '../scope-frame.js';

describe('ScopeFrame variable facade', () => {
  it('keeps current reads separate from source-order occurrence reads', async () => {
    const root = rules([
      vardecl({ name: 'x', value: any('red') }),
      vardecl({ name: 'x', value: any('blue') })
    ]);
    await root.eval(new Context());
    const frame = root.getScopeFrame();

    const current = lookupScopeFrameVariable(frame, 'x');
    const occurrence = lookupScopeFrameVariable(frame, 'x', { start: 1 });

    expect(current?.kind).toBe('declaration');
    expect(current?.kind === 'declaration' && current.entry.cell.value?.valueOf()).toBe('blue');
    expect(occurrence?.kind).toBe('declaration');
    expect(occurrence?.kind === 'declaration' && occurrence.entry.cell.value?.valueOf()).toBe('red');
  });

  it('lets snapshot occurrence reads ignore live current cells', async () => {
    const root = rules([
      vardecl({ name: 'x', value: any('red') })
    ]);
    await root.eval(new Context());
    const frame = root.getScopeFrame();
    frame.liveSlotsByName.set('x', { value: any('blue') });

    const current = lookupScopeFrameVariable(frame, 'x');
    const snapshot = lookupScopeFrameVariable(frame, 'x', {
      start: 1,
      includeLive: false
    });

    expect(current?.kind).toBe('live');
    expect(current?.kind === 'live' && current.cell.value?.valueOf()).toBe('blue');
    expect(snapshot?.kind).toBe('declaration');
    expect(snapshot?.kind === 'declaration' && snapshot.entry.cell.value?.valueOf()).toBe('red');
  });

  it('shadows child declarations locally without mutating parent cells', async () => {
    const parentRules = rules([
      vardecl({ name: 'y', value: any('black') })
    ]);
    await parentRules.eval(new Context());
    const parentFrame = parentRules.getScopeFrame();
    const childRules = rules([
      vardecl({ name: 'y', value: any('white') })
    ]);
    childRules.scopeFrame = childRules.getScopeFrame(parentFrame);

    const parent = lookupScopeFrameVariable(parentFrame, 'y');
    const child = lookupScopeFrameVariable(childRules.scopeFrame, 'y');

    expect(parent?.kind).toBe('declaration');
    expect(parent?.kind === 'declaration' && parent.entry.cell.value?.valueOf()).toBe('black');
    expect(child?.kind).toBe('declaration');
    expect(child?.kind === 'declaration' && child.entry.cell.value?.valueOf()).toBe('white');
  });

  it('assignment writes mutate the resolved scoped binding cell', async () => {
    const parentRules = rules([
      vardecl({ name: 'x', value: any('red') })
    ]);
    await parentRules.eval(new Context());
    const parentFrame = parentRules.getScopeFrame();
    const childRules = rules([]);
    childRules.scopeFrame = childRules.getScopeFrame(parentFrame);

    const assigned = assignScopeFrameVariable(childRules.scopeFrame, 'x', any('blue'));
    const parent = lookupScopeFrameVariable(parentFrame, 'x');

    expect(assigned?.kind).toBe('declaration');
    expect(parent?.kind).toBe('declaration');
    expect(parent?.kind === 'declaration' && parent.entry.cell.value?.valueOf()).toBe('blue');
  });
});
