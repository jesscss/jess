import { describe, it, expect } from 'vitest';
import { defineFunction } from '../define-function';

describe('defineFunction with positional functions', () => {
  // Test positional internal function signature
  const recordFunc = defineFunction(
    'recordTest',
    (name: string, value: number) => `${name}: ${value}`,
    {
      params: [
        { name: 'name', type: 'string' },
        { name: 'value', type: 'number' }
      ]
    }
  );

  it('should work with positional arguments', () => {
    const result = recordFunc('hello', 42);
    expect(result).toBe('hello: 42');
  });

  it('should work with record arguments', () => {
    const result = recordFunc({ name: 'hello', value: 42 } as any);
    expect(result).toBe('hello: 42');
  });

  it('should work with hybrid arguments', () => {
    const result = recordFunc('hello', { value: 42 } as any);
    expect(result).toBe('hello: 42');
  });

  it('should handle defaults properly', () => {
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
      (recordFunc as any)(123, 42);
    }).toThrow('Argument \'name\' must be of type \'string\'. Got: number');

    expect(() => {
      (recordFunc as any)('hello', 'not a number');
    }).toThrow('Argument \'value\' must be of type \'number\'. Got: string');
  });
});
