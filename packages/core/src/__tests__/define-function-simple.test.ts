import { describe, it, expect } from 'vitest';
import { defineFunction } from '../define-function.js';

describe('defineFunction - Simple Test', () => {
  // Test positional internal function signature
  const testFunc = defineFunction(
    'test',
    (name: string, value: number) => `${name}: ${value}`,
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
    expect(testFunc({ name: 'hello', value: 42 } as any)).toBe('hello: 42');
  });

  it('should work with hybrid arguments', () => {
    expect(testFunc('hello', { value: 42 } as any)).toBe('hello: 42');
  });

  it('should handle defaults', () => {
    const funcWithDefaults = defineFunction(
      'withDefaults',
      (name: string, value?: number) => `${name}: ${value ?? 0}`,
      {
        params: [
          { name: 'name', type: 'string' },
          { name: 'value', type: 'number', optional: true, default: 100 }
        ]
      }
    );

    expect(funcWithDefaults('test')).toBe('test: 100');
    expect(funcWithDefaults({ name: 'test' } as any)).toBe('test: 100');
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
