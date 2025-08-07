import { describe, it, expect } from 'vitest';
import { defineFunction } from '../define-function';

describe('defineFunction - Simple Test', () => {
  // Test that the new record-type function signature works
  const testFunc = defineFunction(
    'test',
    (record: { name: string; value: number }) => `${record.name}: ${record.value}`,
    {
      params: [
        { name: 'name', type: 'string' },
        { name: 'value', type: 'number' }
      ]
    }
  );

  it('should work with positional arguments', () => {
    expect(testFunc('hello', 42)).toBe('hello: 42');
  });

  it('should work with record arguments', () => {
    expect(testFunc({ name: 'hello', value: 42 })).toBe('hello: 42');
  });

  it('should work with hybrid arguments', () => {
    expect(testFunc('hello', { value: 42 })).toBe('hello: 42');
  });

  it('should handle defaults', () => {
    const funcWithDefaults = defineFunction(
      'withDefaults',
      (record: { name: string; value?: number }) => `${record.name}: ${record.value ?? 0}`,
      {
        params: [
          { name: 'name', type: 'string' },
          { name: 'value', type: 'number', optional: true, default: 100 }
        ]
      }
    );

    expect(funcWithDefaults('test')).toBe('test: 100');
    expect(funcWithDefaults({ name: 'test' })).toBe('test: 100');
    expect(funcWithDefaults('test', 42)).toBe('test: 42');
  });

  it('should validate types correctly', () => {
    expect(() => {
      (testFunc as any)(123, 42);
    }).toThrow('Argument \'name\' must be of type \'string\'. Got: number');

    expect(() => {
      (testFunc as any)('hello', 'not-a-number');
    }).toThrow('Argument \'value\' must be of type \'number\'. Got: string');
  });
});
