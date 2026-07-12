import { any, seq, decl } from '../index.js';
import { Context } from '../../context.js';
import { el } from '../selector-basic.js';
import { CompoundSelector } from '../selector-compound.js';
import { SelectorList } from '../selector-list.js';

let context: Context;

describe('Node mutation methods', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('setValue with index', () => {
    it('sets parent on the new child node', () => {
      const a = any('a');
      const b = any('b');
      const s = seq([a]);
      s.setData(0, b);
      expect(b.parent).toBe(s);
    });

    it('replaces the element at the given index', () => {
      const a = any('a');
      const b = any('b');
      const s = seq([a]);
      s.setData(0, b);
      expect(s.data[0]).toBe(b);
    });
  });

  describe('setValue with named key', () => {
    it('sets parent on the new child node', () => {
      const name = any('color', { role: 'property' });
      const value = any('red');
      const newValue = any('blue');
      const d = decl({ name, value });
      d.setData('value', newValue);
      expect(newValue.parent).toBe(d);
    });
  });

  describe('push', () => {
    it('sets parent on pushed nodes', () => {
      const a = any('a');
      const b = any('b');
      const s = seq([a]);
      s.push(b);
      expect(b.parent).toBe(s);
      expect(s.data.length).toBe(2);
      expect(s.data[1]).toBe(b);
    });

    it('sets parent on multiple pushed nodes', () => {
      const a = any('a');
      const b = any('b');
      const c = any('c');
      const s = seq([]);
      s.push(a, b, c);
      expect(a.parent).toBe(s);
      expect(b.parent).toBe(s);
      expect(c.parent).toBe(s);
    });
  });

  describe('unshift', () => {
    it('sets parent on prepended nodes', () => {
      const a = any('a');
      const b = any('b');
      const s = seq([b]);
      (s as any).unshift(a);
      expect(a.parent).toBe(s);
      expect(s.data[0]).toBe(a);
      expect(s.data[1]).toBe(b);
    });
  });

  describe('splice', () => {
    it('sets parent on inserted nodes', () => {
      const a = any('a');
      const b = any('b');
      const c = any('c');
      const s = seq([a, c]);
      (s as any).splice(1, 0, b);
      expect(b.parent).toBe(s);
      expect(s.data[1]).toBe(b);
    });

    it('returns removed nodes', () => {
      const a = any('a');
      const b = any('b');
      const s = seq([a, b]);
      const removed = (s as any).splice(0, 1);
      expect(removed).toEqual([a]);
      expect(s.data.length).toBe(1);
    });
  });

  describe('valueOf invalidation', () => {
    it('recomputes valueOf after setValue by index', () => {
      const a = el('.a');
      const b = el('.b');
      const compound = (CompoundSelector as any).create([a]);
      expect(compound.valueOf()).toBe('.a');
      compound.setData(0, b);
      expect(compound.valueOf()).toBe('.b');
    });

    it('recomputes valueOf after push', () => {
      const a = el('.a');
      const b = el('.b');
      const compound = (CompoundSelector as any).create([a]);
      expect(compound.valueOf()).toBe('.a');
      compound.push(b);
      expect(compound.valueOf()).toBe('.a.b');
    });

    it('recomputes valueOf after splice', () => {
      const a = el('.a');
      const b = el('.b');
      const c = el('.c');
      const compound = (CompoundSelector as any).create([a, b, c]);
      expect(compound.valueOf()).toBe('.a.b.c');
      (compound as any).splice(1, 1);
      expect(compound.valueOf()).toBe('.a.c');
    });

    it('recomputes valueOf after unshift', () => {
      const a = el('.a');
      const b = el('.b');
      const compound = (CompoundSelector as any).create([b]);
      expect(compound.valueOf()).toBe('.b');
      (compound as any).unshift(a);
      expect(compound.valueOf()).toBe('.a.b');
    });
  });

  describe('keySet invalidation', () => {
    it('recomputes keySet after setValue by index', async () => {
      const a = el('.a');
      const b = el('.b');
      const compound = (CompoundSelector as any).create([a]);
      await compound.eval(context);
      await b.eval(context);
      expect(compound.keySet.equals(context.selectorBits.getBitset(['.a']))).toBe(true);
      compound.setData(0, b);
      expect(compound.keySet.equals(context.selectorBits.getBitset(['.b']))).toBe(true);
    });

    it('recomputes keySet after push', async () => {
      const a = el('.a');
      const b = el('.b');
      const compound = (CompoundSelector as any).create([a]);
      await compound.eval(context);
      await b.eval(context);
      expect(compound.keySet.equals(context.selectorBits.getBitset(['.a']))).toBe(true);
      compound.push(b);
      expect(compound.keySet.equals(context.selectorBits.getBitset(['.a', '.b']))).toBe(true);
    });

    it('recomputes keySet after splice removal', async () => {
      const a = el('.a');
      const b = el('.b');
      const compound = (CompoundSelector as any).create([a, b]);
      await compound.eval(context);
      expect(compound.keySet.equals(context.selectorBits.getBitset(['.a', '.b']))).toBe(true);
      (compound as any).splice(0, 1);
      expect(compound.keySet.equals(context.selectorBits.getBitset(['.b']))).toBe(true);
    });

    it('recomputes keySet on SelectorList after push', async () => {
      const a = el('.a');
      const b = el('.b');
      const list = (SelectorList as any).create([a]);
      await list.eval(context);
      await b.eval(context);
      expect(list.keySet.equals(context.selectorBits.getBitset(['.a']))).toBe(true);
      list.push(b);
      expect(list.keySet.equals(context.selectorBits.getBitset(['.a', '.b']))).toBe(true);
    });
  });
});
