import { any, seq, decl } from '../index.js';
import { el } from '../selector-basic.js';
import { CompoundSelector } from '../selector-compound.js';
import { SelectorList } from '../selector-list.js';

describe('Node mutation methods', () => {
  describe('setValue with index', () => {
    it('sets parent on the new child node', () => {
      const a = any('a');
      const b = any('b');
      const s = seq([a]);
      s.setValue(0, b);
      expect(b.parent).toBe(s);
    });

    it('replaces the element at the given index', () => {
      const a = any('a');
      const b = any('b');
      const s = seq([a]);
      s.setValue(0, b);
      expect(s.value[0]).toBe(b);
    });
  });

  describe('setValue with named key', () => {
    it('sets parent on the new child node', () => {
      const name = any('color', { role: 'property' });
      const value = any('red');
      const newValue = any('blue');
      const d = decl({ name, value });
      d.setValue('value', newValue);
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
      expect(s.value.length).toBe(2);
      expect(s.value[1]).toBe(b);
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
      s.unshift(a);
      expect(a.parent).toBe(s);
      expect(s.value[0]).toBe(a);
      expect(s.value[1]).toBe(b);
    });
  });

  describe('splice', () => {
    it('sets parent on inserted nodes', () => {
      const a = any('a');
      const b = any('b');
      const c = any('c');
      const s = seq([a, c]);
      s.splice(1, 0, b);
      expect(b.parent).toBe(s);
      expect(s.value[1]).toBe(b);
    });

    it('returns removed nodes', () => {
      const a = any('a');
      const b = any('b');
      const s = seq([a, b]);
      const removed = s.splice(0, 1);
      expect(removed).toEqual([a]);
      expect(s.value.length).toBe(1);
    });
  });

  describe('valueOf invalidation', () => {
    it('recomputes valueOf after setValue by index', () => {
      const a = el('.a');
      const b = el('.b');
      const compound = CompoundSelector.create([a]);
      expect(compound.valueOf()).toBe('.a');
      compound.setValue(0, b);
      expect(compound.valueOf()).toBe('.b');
    });

    it('recomputes valueOf after push', () => {
      const a = el('.a');
      const b = el('.b');
      const compound = CompoundSelector.create([a]);
      expect(compound.valueOf()).toBe('.a');
      compound.push(b);
      expect(compound.valueOf()).toBe('.a.b');
    });

    it('recomputes valueOf after splice', () => {
      const a = el('.a');
      const b = el('.b');
      const c = el('.c');
      const compound = CompoundSelector.create([a, b, c]);
      expect(compound.valueOf()).toBe('.a.b.c');
      compound.splice(1, 1);
      expect(compound.valueOf()).toBe('.a.c');
    });

    it('recomputes valueOf after unshift', () => {
      const a = el('.a');
      const b = el('.b');
      const compound = CompoundSelector.create([b]);
      expect(compound.valueOf()).toBe('.b');
      compound.unshift(a);
      expect(compound.valueOf()).toBe('.a.b');
    });
  });

  describe('keySet invalidation', () => {
    it('recomputes keySet after setValue by index', () => {
      const a = el('.a');
      const b = el('.b');
      const compound = CompoundSelector.create([a]);
      expect(compound.keySet).toEqual(new Set(['.a']));
      compound.setValue(0, b);
      expect(compound.keySet).toEqual(new Set(['.b']));
    });

    it('recomputes keySet after push', () => {
      const a = el('.a');
      const b = el('.b');
      const compound = CompoundSelector.create([a]);
      expect(compound.keySet).toEqual(new Set(['.a']));
      compound.push(b);
      expect(compound.keySet).toEqual(new Set(['.a', '.b']));
    });

    it('recomputes keySet after splice removal', () => {
      const a = el('.a');
      const b = el('.b');
      const compound = CompoundSelector.create([a, b]);
      expect(compound.keySet).toEqual(new Set(['.a', '.b']));
      compound.splice(0, 1);
      expect(compound.keySet).toEqual(new Set(['.b']));
    });

    it('recomputes keySet on SelectorList after push', () => {
      const a = el('.a');
      const b = el('.b');
      const list = SelectorList.create([a]);
      expect(list.keySet.has('.a')).toBe(true);
      list.push(b);
      expect(list.keySet.has('.b')).toBe(true);
    });
  });
});
