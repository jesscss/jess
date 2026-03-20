import { describe, it, expect } from 'vitest';
import { EvalSession } from '../eval-session.js';
import { Keyword, Dimension, Context, vardecl, any } from '../index.js';
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
  sessionSetDependency,
  sessionSetEvaluated,
  sessionSetParent,
  sessionSetPreEvaluated,
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
});
