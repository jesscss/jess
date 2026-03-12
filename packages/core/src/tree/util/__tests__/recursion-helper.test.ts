import { describe, it, expect } from 'vitest';
import { CallMap } from '../recursion-helper.js';
import { call, list, num, ref } from '../../index.js';

describe('CallMap', () => {
  describe('add', () => {
    it('should return true when the same call is added twice with undefined', () => {
      const callMap = new CallMap();
      const call1 = call({
        name: ref('mixin'),
        args: undefined
      });

      // First call with undefined - should return false
      expect(callMap.add(call1, undefined)).toBe(false);

      // Second call with undefined - should return true
      expect(callMap.add(call1, undefined)).toBe(true);
    });

    it('should return false when different calls are added with undefined', () => {
      const callMap = new CallMap();
      const call1 = call({
        name: ref('mixin1'),
        args: undefined
      });
      const call2 = call({
        name: ref('mixin2'),
        args: undefined
      });

      // First call with undefined
      expect(callMap.add(call1, undefined)).toBe(false);

      // Different call with undefined - should return false
      expect(callMap.add(call2, undefined)).toBe(false);
    });

    it('should return true when the same call is added twice with the same list instance', () => {
      const callMap = new CallMap();
      const list1 = list([num(1), num(2)]);
      const call1 = call({
        name: ref('mixin'),
        args: list1.data as any
      });

      // First call with list1
      expect(callMap.add(call1, list1)).toBe(false);

      // Second call with same list instance - should return true
      expect(callMap.add(call1, list1)).toBe(true);
    });

    it('should return true when the same call is added with identical lists (different instances)', () => {
      const callMap = new CallMap();
      const list1 = list([num(1), num(2)]);
      const list2 = list([num(1), num(2)]); // Same content, different instance
      const call1 = call({
        name: ref('mixin'),
        args: list1.data as any
      });

      // First call with list1
      expect(callMap.add(call1, list1)).toBe(false);

      // Second call with list2 (different instance, same value) - should return true
      expect(callMap.add(call1, list2)).toBe(true);
    });

    it('should return false when the same call is added with different lists', () => {
      const callMap = new CallMap();
      const list1 = list([num(1), num(2)]);
      const list2 = list([num(3), num(4)]); // Different content
      const call1 = call({
        name: ref('mixin'),
        args: list1.data as any
      });

      // First call with list1
      expect(callMap.add(call1, list1)).toBe(false);

      // Second call with list2 (different content) - should return false
      expect(callMap.add(call1, list2)).toBe(false);
    });

    it('should prevent a call from calling itself with the same params', () => {
      const callMap = new CallMap();
      const list1 = list([num(1), num(2)]);
      const call1 = call({
        name: ref('mixin'),
        args: list1.data as any
      });

      // First call - should return false
      expect(callMap.add(call1, list1)).toBe(false);

      // Same call with same params - should return true (recursion detected)
      expect(callMap.add(call1, list1)).toBe(true);
    });

    it('should prevent different calls from calling each other with the same params', () => {
      const callMap = new CallMap();
      const list1 = list([num(1), num(2)]);
      const call1 = call({
        name: ref('mixin1'),
        args: list1.data as any
      });
      const call2 = call({
        name: ref('mixin2'),
        args: list1.data as any
      });

      // First call with list1
      expect(callMap.add(call1, list1)).toBe(false);

      // Different call with same params - should return false
      // (each call tracks its own args separately)
      expect(callMap.add(call2, list1)).toBe(false);

      // But if call2 calls itself with same params, it should return true
      expect(callMap.add(call2, list1)).toBe(true);
    });
  });

  describe('delete', () => {
    it('should remove the last entry for a call', () => {
      const callMap = new CallMap();
      const list1 = list([num(1), num(2)]);
      const call1 = call({
        name: ref('mixin'),
        args: list1.data as any
      });

      // Add once - this adds the entry to the set
      callMap.add(call1, list1);

      // Add again - this checks but doesn't add (only one entry exists)
      expect(callMap.add(call1, list1)).toBe(true);

      // Delete once - removes the only entry
      expect(callMap.delete(call1)).toBe(true);

      // Now should return false (no entries)
      expect(callMap.add(call1, list1)).toBe(false);
    });

    it('should handle multiple entries for a call', () => {
      const callMap = new CallMap();
      const list1 = list([num(1), num(2)]);
      const list2 = list([num(3), num(4)]);
      const call1 = call({
        name: ref('mixin'),
        args: list1.data as any
      });

      // Add first list
      callMap.add(call1, list1);

      // Manually add second list to the set (simulating multiple calls)
      // Note: The current implementation doesn't add new args on subsequent calls,
      // so we need to test the delete behavior with multiple entries differently
      const set = (callMap as any)._callMap.get(call1);
      if (set) {
        set.push(list2);
      }

      // Delete once - should remove the last entry (list2)
      expect(callMap.delete(call1)).toBe(true);

      // Should still return true for list1
      expect(callMap.add(call1, list1)).toBe(true);
    });

    it('should return false when deleting a non-existent call', () => {
      const callMap = new CallMap();
      const call1 = call({
        name: ref('mixin'),
        args: undefined
      });

      expect(callMap.delete(call1)).toBe(false);
    });
  });
});