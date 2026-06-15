import { any, vardecl, rules } from '../index.js';
import { Context } from '../../context.js';
import {
  assignScopeFrameVariable,
  buildScopeFrame,
  lookupScopeFrameVariable,
  setScopeFrameLiveBinding
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
    expect(current?.kind === 'declaration' && current.cell.value?.valueOf()).toBe('blue');
    expect(occurrence?.kind).toBe('declaration');
    expect(occurrence?.kind === 'declaration' && occurrence.cell.value?.valueOf()).toBe('red');
  });

  it('lets snapshot occurrence reads ignore live current cells', async () => {
    const root = rules([
      vardecl({ name: 'x', value: any('red') })
    ]);
    await root.eval(new Context());
    const frame = root.getScopeFrame();
    setScopeFrameLiveBinding(frame, 'x', { value: any('blue') });

    const current = lookupScopeFrameVariable(frame, 'x');
    const snapshot = lookupScopeFrameVariable(frame, 'x', {
      start: 1,
      includeLive: false
    });

    expect(current?.kind).toBe('live');
    expect(current?.kind === 'live' && current.cell.value?.valueOf()).toBe('blue');
    expect(snapshot?.kind).toBe('declaration');
    expect(snapshot?.kind === 'declaration' && snapshot.cell.value?.valueOf()).toBe('red');
  });

  it('records readonly provenance on static declaration cells', async () => {
    const root = rules([
      vardecl({ name: 'x', value: any('red') }, { readonly: true })
    ]);
    await root.eval(new Context());

    const hit = lookupScopeFrameVariable(root.getScopeFrame(), 'x');

    expect(hit.kind).toBe('declaration');
    expect(hit.kind === 'declaration' && hit.cell.readonly).toBe(true);
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
    expect(parent?.kind === 'declaration' && parent.cell.value?.valueOf()).toBe('black');
    expect(child?.kind).toBe('declaration');
    expect(child?.kind === 'declaration' && child.cell.value?.valueOf()).toBe('white');
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
    expect(parent?.kind === 'declaration' && parent.cell.value?.valueOf()).toBe('blue');
  });

  it('returns a covered miss when indexed frames have no matching binding', async () => {
    const root = rules([
      vardecl({ name: 'x', value: any('red') })
    ]);
    await root.eval(new Context());

    const hit = lookupScopeFrameVariable(root.getScopeFrame(), 'missing', {
      bailOnPendingDeclarations: true
    });

    expect(hit.kind).toBe('miss');
  });

  it('returns uncovered when pending dynamic declarations still need old lookup handling', async () => {
    const root = rules([]);
    await root.eval(new Context());
    const frame = root.getScopeFrame();
    frame.pendingDeclarationNames.push(vardecl({ name: 'dynamic', value: any('red') }));

    const hit = lookupScopeFrameVariable(frame, 'missing', {
      bailOnPendingDeclarations: true
    });

    expect(hit.kind).toBe('uncovered');
  });

  it('does not walk to parent declarations through an uncovered child declaration surface', async () => {
    const parentRules = rules([
      vardecl({ name: 'x', value: any('red') })
    ]);
    await parentRules.eval(new Context());
    const childRules = rules([
      vardecl({ name: 'x', value: any('blue') })
    ]);
    const childFrame = buildScopeFrame(
      undefined,
      childRules,
      parentRules.getScopeFrame(),
      new Map()
    );

    const hit = lookupScopeFrameVariable(childFrame, 'x', {
      bailOnPendingDeclarations: true
    });

    expect(hit.kind).toBe('uncovered');
  });

  it('resolves fallback live slots from the same facade lookup', async () => {
    const fallbackRules = rules([]);
    const fallbackFrame = fallbackRules.getScopeFrame();
    setScopeFrameLiveBinding(fallbackFrame, 'x', { value: any('blue') });
    const root = rules([]);
    await root.eval(new Context());
    const frame = root.getScopeFrame();
    frame.fallbackFrame = fallbackFrame;

    const hit = lookupScopeFrameVariable(frame, 'x');

    expect(hit.kind).toBe('live');
    expect(hit.kind === 'live' && hit.cell.value?.valueOf()).toBe('blue');
  });

  it('resolves fallback declarations from the same facade lookup', async () => {
    const fallbackRules = rules([
      vardecl({ name: 'x', value: any('blue') })
    ]);
    await fallbackRules.eval(new Context());
    const root = rules([]);
    await root.eval(new Context());
    const frame = root.getScopeFrame();
    frame.fallbackFrame = fallbackRules.getScopeFrame();

    const hit = lookupScopeFrameVariable(frame, 'x');

    expect(hit.kind).toBe('declaration');
    expect(hit.kind === 'declaration' && hit.cell.value?.valueOf()).toBe('blue');
  });

  it('returns a covered miss across fallback frames', async () => {
    const fallbackRules = rules([
      vardecl({ name: 'x', value: any('blue') })
    ]);
    await fallbackRules.eval(new Context());
    const root = rules([]);
    await root.eval(new Context());
    const frame = root.getScopeFrame();
    frame.fallbackFrame = fallbackRules.getScopeFrame();

    const hit = lookupScopeFrameVariable(frame, 'missing', {
      bailOnPendingDeclarations: true
    });

    expect(hit.kind).toBe('miss');
  });
});
