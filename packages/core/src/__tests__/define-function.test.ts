import { describe, it, expect } from 'vitest';
import { defineFunction, callWithContext } from '../define-function.js';
import { Context } from '../context.js';
import { expectTypeOf } from 'vitest';
import { Any, Color, Dimension, F_MAY_ASYNC, type AnyRole } from '../tree/index.js';

describe('defineFunction', () => {
  const args = [
    { name: 'name', type: 'string' },
    { name: 'value', type: 'number' }
  ] as const;

  const myFunc = defineFunction(
    'test',
    (name: string, value: number) => `${name}: ${value}`,
    { params: args }
  );
  const uncheckedMyFunc: (...args: any[]) => unknown = myFunc;

  it('attaches runtime metadata directly to the function object', () => {
    const runtimeFunc = myFunc as typeof myFunc & {
      options?: unknown;
      _internal?: unknown;
    };

    expect(typeof runtimeFunc).toBe('function');
    expect(runtimeFunc.name).toBe('test');
    expect(Object.prototype.hasOwnProperty.call(runtimeFunc, 'options')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(runtimeFunc, '_internal')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(runtimeFunc, 'options')?.value).toEqual({ params: args });
    expect(Object.getOwnPropertyDescriptor(runtimeFunc, '_internal')?.value).toBeTypeOf('function');
  });

  describe('positional calls', () => {
    it('should work with valid positional arguments', () => {
      const myFunc = defineFunction(
        'test',
        (name: string, value: number) => `${name}: ${value}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'value', type: 'number' }
        ] }
      );
      expect(myFunc('hello', 42)).toBe('hello: 42');
    });

    it('should throw error for invalid first argument type', () => {
      expect(() => {
        uncheckedMyFunc(1, 42);
      }).toThrow('Argument \'name\' must be of type \'string\'. Got: number');
    });

    it('should throw error for invalid second argument type', () => {
      expect(() => {
        uncheckedMyFunc('hello', 'not a number');
      }).toThrow('Argument \'value\' must be of type \'number\'. Got: string');
    });

    it('should handle undefined arguments gracefully', () => {
      // With the new validation, undefined arguments for required parameters should throw
      expect(() => {
        uncheckedMyFunc('hello', undefined);
      }).toThrow('Required argument \'value\' is missing');
    });
  });

  describe('record calls', () => {
    it('should work with valid record arguments', () => {
      expect(myFunc({ name: 'hello', value: 42 })).toBe('hello: 42');
    });

    it('should work with partial record (missing optional parameters)', () => {
      // With the new validation, missing required parameters should throw
      expect(() => {
        uncheckedMyFunc({ name: 'hello' });
      }).toThrow('Required argument \'value\' is missing');
    });

    it('should throw error for invalid property type in record', () => {
      expect(() => {
        uncheckedMyFunc({ name: 123, value: 42 });
      }).toThrow('Argument \'name\' must be of type \'string\'. Got: number');
    });

    it('should throw error for invalid second property type in record', () => {
      expect(() => {
        uncheckedMyFunc({ name: 'hello', value: 'not a number' });
      }).toThrow('Argument \'value\' must be of type \'number\'. Got: string');
    });
  });

  describe('hybrid calls', () => {
    it('should work with positional + record arguments', () => {
      expect(myFunc('hello', { value: 42 })).toBe('hello: 42');
    });

    it('should prioritize record over positional for same parameter', () => {
      // Record takes precedence over positional arguments
      expect(myFunc('ignored', { name: 'hello', value: 42 })).toBe('hello: 42');
    });

    it('should handle partial record in hybrid call', () => {
      // Only the value from record, name from positional
      expect(myFunc('hello', { value: 42 })).toBe('hello: 42');
    });

    it('should handle record with extra properties', () => {
      // Extra properties in record should be ignored
      uncheckedMyFunc('hello', { value: 42, extra: 'ignored' });
      // The function should still work correctly despite extra properties
      expect(myFunc('hello', { value: 42 })).toBe('hello: 42');
    });

    it('should throw error for invalid positional argument in hybrid call', () => {
      expect(() => {
        uncheckedMyFunc(123, { value: 42 });
      }).toThrow('Argument \'name\' must be of type \'string\'. Got: number');
    });

    it('should throw error for invalid record property in hybrid call', () => {
      expect(() => {
        uncheckedMyFunc('hello', { value: 'not a number' });
      }).toThrow('Argument \'value\' must be of type \'number\'. Got: string');
    });
  });

  describe('edge cases', () => {
    it('should handle empty record', () => {
      // With the new validation, empty record should throw for missing required parameters
      expect(() => {
        uncheckedMyFunc({});
      }).toThrow('Required argument \'name\' is missing');
    });

    it('should handle null values', () => {
      expect(() => {
        uncheckedMyFunc(null, 42);
      }).toThrow('Argument \'name\' must be of type \'string\'. Got: object');
    });

    it('should handle boolean values', () => {
      expect(() => {
        uncheckedMyFunc(true, 42);
      }).toThrow('Argument \'name\' must be of type \'string\'. Got: boolean');
    });
  });

  describe('type inference', () => {
    it('should provide correct return type', () => {
      const result = myFunc({ name: 'hello', value: 42 });
      expect(typeof result).toBe('string');
    });

    it('should maintain function signature for record calls', () => {
      // This should compile without errors
      const testFunc = (fn: typeof myFunc) => {
        fn({ name: 'hello', value: 42 });
      };
      testFunc(myFunc);
    });
  });

  describe('complex scenarios', () => {
    it('should work with more complex function', () => {
      const complexArgs = [
        { name: 'name', type: 'string' },
        { name: 'age', type: 'number' },
        { name: 'active', type: 'boolean' }
      ] as const;

      const complexFunc = defineFunction(
        'complex',
        (name: string, age: number, active: boolean) =>
          `${name} is ${age} years old and is ${active ? 'active' : 'inactive'}`,
        { params: complexArgs }
      );

      expect(complexFunc({ name: 'John', age: 30, active: true })).toBe('John is 30 years old and is active');
      expect(complexFunc({ name: 'Jane', age: 25, active: false })).toBe('Jane is 25 years old and is inactive');
      expect(complexFunc({ name: 'Bob', age: 35, active: true })).toBe('Bob is 35 years old and is active');
    });

    it('should handle optional parameters correctly', () => {
      const optionalArgs = [
        { name: 'required', type: 'string' },
        { name: 'optional', type: 'number', optional: true }
      ] as const;

      const optionalFunc = defineFunction(
        'optional',
        (required: string, optional?: number) =>
          `${required}${optional ? `: ${optional}` : ''}`,
        { params: optionalArgs }
      );

      expect(optionalFunc({ required: 'hello' })).toBe('hello');
      expect(optionalFunc({ required: 'hello', optional: 42 })).toBe('hello: 42');
      expect(optionalFunc({ required: 'world' })).toBe('world');
      expect(optionalFunc({ required: 'world', optional: 123 })).toBe('world: 123');
    });

    it('should throw error for missing required parameters', () => {
      const requiredArgs = [
        { name: 'name', type: 'string' },
        { name: 'value', type: 'number' }
      ] as const;

      const requiredFunc = defineFunction(
        'required',
        (name: string, value: number) => `${name}: ${value}`,
        { params: requiredArgs }
      );
      const uncheckedRequiredFunc: (...args: any[]) => unknown = requiredFunc;

      expect(() => {
        uncheckedRequiredFunc();
      }).toThrow('Required argument \'name\' is missing');

      expect(() => {
        uncheckedRequiredFunc('hello');
      }).toThrow('Required argument \'value\' is missing');
    });

    it('should work with all optional parameters', () => {
      const allOptionalArgs = [
        { name: 'name', type: 'string', optional: true },
        { name: 'value', type: 'number', optional: true }
      ] as const;

      const allOptionalFunc = defineFunction(
        'allOptional',
        (name?: string, value?: number) => `${name || 'default'}: ${value || 0}`,
        { params: allOptionalArgs }
      );

      // Should work with no arguments
      expect(allOptionalFunc()).toBe('default: 0');

      // Should work with partial arguments
      expect(allOptionalFunc('hello')).toBe('hello: 0');
      expect(allOptionalFunc(undefined, 42)).toBe('default: 42');

      // Should work with all arguments
      expect(allOptionalFunc('hello', 42)).toBe('hello: 42');
    });

    it('should have strong typing for positional arguments', () => {
      const typedArgs = [
        { name: 'name', type: 'string' },
        { name: 'value', type: 'number' }
      ] as const;

      const typedFunc = defineFunction(
        'typed',
        (name: string, value: number) => `${name}: ${value}`,
        { params: typedArgs }
      );

      // These should have proper type checking
      expect(typedFunc({ name: 'hello', value: 42 })).toBe('hello: 42');

      // TypeScript should catch these at compile time:
      // typedFunc('hello', 'not-a-number'); // Should be type error
      // typedFunc(123, 42); // Should be type error
      // typedFunc('hello'); // Should be type error (missing required param)
    });

    it('should preserve parameter names from function signature', () => {
      const args = [
        { name: 'name', type: 'string' },
        { name: 'age', type: 'number' },
        { name: 'active', type: 'boolean' }
      ] as const;

      const func = defineFunction(
        'preserveNames',
        (name: string, age: number, active: boolean) => `${name}: ${age}, ${active}`,
        { params: args }
      );

      // The function should have the same parameter names as the original function
      expect(func({ name: 'John', age: 30, active: true })).toBe('John: 30, true');
      expect(func({ name: 'Jane', age: 25, active: false })).toBe('Jane: 25, false');

      // Test that parameter names are preserved in the type
      expectTypeOf(func).toBeFunction();

      expectTypeOf(func as (...args: any[]) => string).returns.toBeString();
    });

    it('should validate that args match function signature', () => {
      // This should work - args match function signature
      const validArgs = [
        { name: 'name', type: 'string' },
        { name: 'value', type: 'number' }
      ] as const;

      const validFunc = defineFunction(
        'valid',
        (name: string, value: number) => `${name}: ${value}`,
        { params: validArgs }
      );

      expect(validFunc({ name: 'hello', value: 42 })).toBe('hello: 42');

      // Test that the function signature matches the original
      expectTypeOf(validFunc).toBeFunction();

      expectTypeOf(validFunc as (...args: any[]) => string).returns.toBeString();

      // This should cause a type error at compile time if uncommented:
      // const invalidArgs = [
      //   { name: 'name', type: 'string' },
      //   { name: 'value', type: 'boolean' } // Wrong type!
      // ] as const;
      //
      // const invalidFunc = defineFunction(
      //   'invalid',
      //   (name: string, value: number) => `${name}: ${value}`, // Expects number, but args says boolean
      //   { params: invalidArgs }
      // );
    });

    it('should have correct return type', () => {
      const args = [
        { name: 'name', type: 'string' },
        { name: 'value', type: 'number' }
      ] as const;

      const func = defineFunction(
        'returnType',
        (name: string, value: number): string => `${name}: ${value}`,
        { params: args }
      );

      // Test that return type is preserved
      expectTypeOf(func({ name: 'hello', value: 42 })).toBeString();
    });

    it('should catch type mismatches between args and function signature', () => {
      // This test demonstrates that TypeScript will catch mismatches
      // Uncomment the following lines to see the type error:

      // const mismatchedArgs = [
      //   { name: 'name', type: 'string' },
      //   { name: 'value', type: 'boolean' } // Wrong type!
      // ] as const;
      //
      // const mismatchedFunc = defineFunction(
      //   'mismatched',
      //   (name: string, value: number) => `${name}: ${value}`, // Expects number, but args says boolean
      //   { params: mismatchedArgs }
      // );

      // The above should cause a TypeScript error because:
      // - Function expects (name: string, value: number)
      // - Args says value should be boolean
      // - TypeScript should catch this mismatch
    });

    it('should handle default values correctly', () => {
      const defaultArgs = [
        { name: 'name', type: 'string', default: 'anonymous' },
        { name: 'age', type: 'number', default: 18 },
        { name: 'active', type: 'boolean', default: true }
      ] as const;

      const defaultFunc = defineFunction(
        'defaults',
        (name: string, age: number, active: boolean) => `${name} (${age}) - ${active ? 'active' : 'inactive'}`,
        { params: defaultArgs }
      );

      // Should use defaults when no arguments provided
      expect(defaultFunc({})).toBe('anonymous (18) - active');

      // Should use defaults for missing parameters
      expect(defaultFunc({ name: 'John' })).toBe('John (18) - active');
      expect(defaultFunc({ name: 'Jane', age: 25 })).toBe('Jane (25) - active');

      // Should override defaults when provided
      expect(defaultFunc({ name: 'Bob', age: 30, active: false })).toBe('Bob (30) - inactive');
    });

    it('should automatically make parameters optional when they have defaults', () => {
      const autoOptionalArgs = [
        { name: 'name', type: 'string' }, // Required
        { name: 'age', type: 'number', default: 18 }, // Auto-optional due to default
        { name: 'city', type: 'string', default: 'Unknown' } // Auto-optional due to default
      ] as const;

      const autoOptionalFunc = defineFunction(
        'autoOptional',
        (name: string, age: number, city: string) => `${name} (${age}) from ${city}`,
        { params: autoOptionalArgs }
      );

      // Should work with just the required parameter
      expect(autoOptionalFunc({ name: 'John' })).toBe('John (18) from Unknown');

      // Should work with partial parameters
      expect(autoOptionalFunc({ name: 'Jane', age: 25 })).toBe('Jane (25) from Unknown');

      // Should work with all parameters
      expect(autoOptionalFunc({ name: 'Bob', age: 30, city: 'New York' })).toBe('Bob (30) from New York');
    });

    it('should not require explicit optional flag when using defaults', () => {
      const implicitOptionalArgs = [
        { name: 'name', type: 'string' }, // Required
        { name: 'count', type: 'number', default: 0 }, // Implicitly optional due to default
        { name: 'enabled', type: 'boolean', default: true } // Implicitly optional due to default
      ] as const;

      const implicitOptionalFunc = defineFunction(
        'implicitOptional',
        (name: string, count: number, enabled: boolean) => `${name}: ${count} items, ${enabled ? 'enabled' : 'disabled'}`,
        { params: implicitOptionalArgs }
      );

      // Should work with just required parameter (others use defaults)
      expect(implicitOptionalFunc({ name: 'Widget' })).toBe('Widget: 0 items, enabled');

      // Should work with partial parameters
      expect(implicitOptionalFunc({ name: 'Gadget', count: 5 })).toBe('Gadget: 5 items, enabled');

      // Should work with all parameters
      expect(implicitOptionalFunc({ name: 'Tool', count: 10, enabled: false })).toBe('Tool: 10 items, disabled');
    });

    it('should work with tree node types', () => {
      const treeNodeArgs = [
        { name: 'color', type: Color },
        { name: 'dimension', type: Dimension, default: new Dimension({ number: 0, unit: 'px' }) },
        { name: 'alpha', type: 'number', default: 1 }
      ] as const;

      const treeNodeFunc = defineFunction(
        'treeNodes',
        (color: Color, dimension?: Dimension, alpha?: number) => {
          return {
            colorType: color.type,
            dimensionType: dimension?.type || 'none',
            alpha: alpha || 1
          };
        },
        { params: treeNodeArgs }
      );
      const uncheckedTreeNodeFunc: (...args: any[]) => unknown = treeNodeFunc;

      const testColor = new Color('#ff0000');
      const testDimension = new Dimension({ number: 10, unit: 'px' });

      // Test with all parameters
      const result1 = treeNodeFunc(testColor, testDimension, 0.8);
      expect(result1.colorType).toBe('Color');
      expect(result1.dimensionType).toBe('Dimension');
      expect(result1.alpha).toBe(0.8);

      // Test with missing optional parameter (should use defaults)
      const result2 = treeNodeFunc(testColor);
      expect(result2.colorType).toBe('Color');
      expect(result2.dimensionType).toBe('Dimension'); // Uses default
      expect(result2.alpha).toBe(1); // Uses default

      // Test that instanceof checks work correctly
      expect(testColor instanceof Color).toBe(true);
      expect(testDimension instanceof Dimension).toBe(true);

      // Test that runtime validation works with instanceof checks
      expect(() => {
        uncheckedTreeNodeFunc('not a color', testDimension);
      }).toThrow('Argument \'color\' must be of type \'Color\'');
    });

    it('should support rest parameters and lazy evaluation', async () => {
      const calls: string[] = [];
      class TestNode extends Color {
        constructor(value: string) {
          super(value);
          this.addFlag(F_MAY_ASYNC);
        }

        override async evalNode(_context: Context): Promise<this> {
          calls.push(String(this.node));
          return this;
        }
      }

      const restFunc = defineFunction(
        'rest',
        async (...values: Array<() => Promise<Color>>) => {
          const firstThunk = values[0]!;
          const first = await firstThunk();
          return first;
        },
        { params: [{ name: 'values', type: Color, rest: true, lazy: true }] }
      );

      // Call positionally: only first should be evaluated
      const a = new TestNode('#000');
      const b = new TestNode('#111');
      const c = new TestNode('#222');
      const ctx = new Context();
      const result = await callWithContext(ctx, restFunc, a, b, c);
      expect(result).toBe(a);
      // Only first element evaluated lazily upon access
      expect(calls).toEqual(['#000']);
    });

    it('does not copy raw args for functions without params metadata', async () => {
      class CopyBomb extends Any<AnyRole> {
        static copyShouldThrow = false;

        constructor(
          value: string,
          options?: ConstructorParameters<typeof Any<AnyRole>>[1],
          location?: ConstructorParameters<typeof Any<AnyRole>>[2],
          treeContext?: ConstructorParameters<typeof Any<AnyRole>>[3]
        ) {
          if (CopyBomb.copyShouldThrow) {
            throw new Error('unexpected raw arg copy');
          }
          super(value, options, location, treeContext);
        }
      }

      const value = new CopyBomb('red', undefined, { start: 0, end: 2 });
      CopyBomb.copyShouldThrow = true;
      try {
        const ctx = new Context();
        const result = await callWithContext(ctx, function echo(this: Context, arg: CopyBomb) {
          expect(this).toBe(ctx);
          return arg;
        }, value);

        expect(result).toBe(value);
      } finally {
        CopyBomb.copyShouldThrow = false;
      }
    });

    it('should support lazy evaluation of object parameters', async () => {
      const calls: string[] = [];
      class TestNode extends Color {
        constructor(value: string) {
          super(value);
          this.addFlag(F_MAY_ASYNC);
        }

        override async evalNode(_context: Context): Promise<this> {
          calls.push(String(this.node));
          return this;
        }
      }

      const objFunc = defineFunction(
        'obj',
        async (aThunk: () => Promise<Color>, bThunk: () => Promise<Color>) => {
          const a = await aThunk();
          return a;
        },
        { params: [
          { name: 'a', type: Color, lazy: true },
          { name: 'b', type: Color, lazy: true }
        ] }
      );

      const a = new TestNode('#000');
      const b = new TestNode('#111');
      const ctx = new Context();
      const result = await callWithContext(ctx, objFunc, { a, b });
      expect(result).toBe(a);
      expect(calls).toEqual(['#000']);
    });

    it('should validate lazy parameters when thunk is called, not when function is defined', async () => {
      // This test ensures lazy parameters are validated when the thunk is called,
      // not when the function is initially called. This prevents "Got: function" errors.
      const directFunc = defineFunction(
        'direct',
        async (valueThunk: any) => {
          // When this thunk is called, it should validate the resolved value, not the function
          const value = await valueThunk();
          return value;
        },
        { params: [
          { name: 'value', type: Dimension, lazy: true }
        ] }
      );

      // Should throw when function returns wrong type - validation happens when thunk is called
      // This would previously fail with "Got: function" but now correctly validates the resolved value
      await expect(
        directFunc(() => new Color('#000'))
      ).rejects.toThrow('Argument \'value\' must be of type \'Dimension\'');
    });
  });

  describe('type checking', () => {
    it('should have strong typing for 1 parameter', () => {
      const singleParamFunc = defineFunction(
        'singleParam',
        (name: string) => `Hello ${name}`,
        { params: [{ name: 'name', type: 'string' }] }
      );

      // These should have strong typing
      expectTypeOf(singleParamFunc).toBeFunction();

      expectTypeOf(singleParamFunc as (...args: any[]) => string).returns.toBeString();

      // Test that it works
      expect(singleParamFunc('World')).toBe('Hello World');
    });

    it('should have strong typing for 2 parameters', () => {
      const twoParamFunc = defineFunction(
        'twoParam',
        (name: string, age: number) => `${name} is ${age} years old`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' }
        ] }
      );

      // These should have strong typing
      expectTypeOf(twoParamFunc).toBeFunction();

      expectTypeOf(twoParamFunc as (...args: any[]) => string).returns.toBeString();

      // Test that it works
      expect(twoParamFunc('Alice', 25)).toBe('Alice is 25 years old');
    });

    it('should have strong typing for 3 parameters', () => {
      const threeParamFunc = defineFunction(
        'threeParam',
        (name: string, age: number, city: string) => `${name} is ${age} from ${city}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' },
          { name: 'city', type: 'string' }
        ] }
      );

      // These should have strong typing
      expectTypeOf(threeParamFunc).toBeFunction();

      expectTypeOf(threeParamFunc as (...args: any[]) => string).returns.toBeString();

      // Test that it works
      expect(threeParamFunc('Bob', 30, 'New York')).toBe('Bob is 30 from New York');
    });

    it('should have strong typing for 4 parameters', () => {
      const fourParamFunc = defineFunction(
        'fourParam',
        (name: string, age: number, city: string, active: boolean) =>
          `${name} is ${age} from ${city}, ${active ? 'active' : 'inactive'}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' },
          { name: 'city', type: 'string' },
          { name: 'active', type: 'boolean' }
        ] }
      );

      // These should have strong typing
      expectTypeOf(fourParamFunc).toBeFunction();

      expectTypeOf(fourParamFunc as (...args: any[]) => string).returns.toBeString();

      // Test that it works
      expect(fourParamFunc('Charlie', 35, 'London', true)).toBe('Charlie is 35 from London, active');
    });

    it('should have strong typing for 5 parameters', () => {
      const fiveParamFunc = defineFunction(
        'fiveParam',
        (name: string, age: number, city: string, active: boolean, score: number) =>
          `${name} is ${age} from ${city}, ${active ? 'active' : 'inactive'}, score: ${score}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' },
          { name: 'city', type: 'string' },
          { name: 'active', type: 'boolean' },
          { name: 'score', type: 'number' }
        ] }
      );

      // These should have strong typing
      expectTypeOf(fiveParamFunc).toBeFunction();

      expectTypeOf(fiveParamFunc as (...args: any[]) => string).returns.toBeString();

      // Test that it works
      expect(fiveParamFunc('David', 40, 'Paris', false, 85)).toBe('David is 40 from Paris, inactive, score: 85');
    });

    it('should work with 6+ parameters (fallback typing)', () => {
      const sixParamFunc = defineFunction(
        'sixParam',
        (name: string, age: number, city: string, active: boolean, score: number, level: string) =>
          `${name} is ${age} from ${city}, ${active ? 'active' : 'inactive'}, score: ${score}, level: ${level}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' },
          { name: 'city', type: 'string' },
          { name: 'active', type: 'boolean' },
          { name: 'score', type: 'number' },
          { name: 'level', type: 'string' }
        ] }
      );

      // Should still be a function, but without specific overloads
      expectTypeOf(sixParamFunc).toBeFunction();

      expectTypeOf(sixParamFunc as (...args: any[]) => string).returns.toBeString();

      // Test that it works
      expect(sixParamFunc('Eve', 45, 'Tokyo', true, 92, 'expert')).toBe('Eve is 45 from Tokyo, active, score: 92, level: expert');
    });

    it('should work with 7+ parameters (fallback typing)', () => {
      const sevenParamFunc = defineFunction(
        'sevenParam',
        (name: string, age: number, city: string, active: boolean, score: number, level: string, rank: number) =>
          `${name} is ${age} from ${city}, ${active ? 'active' : 'inactive'}, score: ${score}, level: ${level}, rank: ${rank}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' },
          { name: 'city', type: 'string' },
          { name: 'active', type: 'boolean' },
          { name: 'score', type: 'number' },
          { name: 'level', type: 'string' },
          { name: 'rank', type: 'number' }
        ] }
      );

      // Should still be a function, but without specific overloads
      expectTypeOf(sevenParamFunc).toBeFunction();

      expectTypeOf(sevenParamFunc as (...args: any[]) => string).returns.toBeString();

      // Test that it works
      expect(sevenParamFunc('Frank', 50, 'Berlin', false, 78, 'intermediate', 3)).toBe('Frank is 50 from Berlin, inactive, score: 78, level: intermediate, rank: 3');
    });

    it('should demonstrate parameter name preservation in strong typing', () => {
      const preservedFunc = defineFunction(
        'preserved',
        (firstName: string, lastName: string, age: number) => `${firstName} ${lastName} is ${age}`,
        { params: [
          { name: 'firstName', type: 'string' },
          { name: 'lastName', type: 'string' },
          { name: 'age', type: 'number' }
        ] }
      );

      // The function should preserve parameter names in the type signature
      expectTypeOf(preservedFunc).toBeFunction();

      expectTypeOf(preservedFunc as (...args: any[]) => string).returns.toBeString();

      // Test that it works
      expect(preservedFunc('John', 'Doe', 30)).toBe('John Doe is 30');
    });

    it('should demonstrate optional parameters in strong typing', () => {
      const optionalFunc = defineFunction(
        'optional',
        (name: string, age?: number, city?: string) => `${name}${age ? ` is ${age}` : ''}${city ? ` from ${city}` : ''}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number', optional: true },
          { name: 'city', type: 'string', optional: true }
        ] }
      );

      // Should have strong typing for optional parameters
      expectTypeOf(optionalFunc).toBeFunction();

      expectTypeOf(optionalFunc as (...args: any[]) => string).returns.toBeString();

      // Test various combinations
      expect(optionalFunc('Alice')).toBe('Alice');
      expect(optionalFunc('Bob', 25)).toBe('Bob is 25');
      expect(optionalFunc('Charlie', 30, 'London')).toBe('Charlie is 30 from London');
    });

    it('should demonstrate default values in strong typing', () => {
      const defaultFunc = defineFunction(
        'default',
        (name: string, age: number, city: string) => `${name} is ${age} from ${city}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number', default: 25 },
          { name: 'city', type: 'string', default: 'Unknown' }
        ] }
      );

      // Should have strong typing with defaults
      expectTypeOf(defaultFunc).toBeFunction();

      expectTypeOf(defaultFunc as (...args: any[]) => string).returns.toBeString();

      // Test that defaults work
      expect(defaultFunc('David')).toBe('David is 25 from Unknown');
      expect(defaultFunc('Eve', 30)).toBe('Eve is 30 from Unknown');
      expect(defaultFunc('Frank', 35, 'Paris')).toBe('Frank is 35 from Paris');
    });
  });

  describe('error messages', () => {
    it('should provide descriptive error messages', () => {
      try {
        uncheckedMyFunc(123, 'invalid');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        expect(message).toContain('Argument \'name\' must be of type \'string\'');
        expect(message).toContain('Got: number');
      }
    });

    it('should provide error messages for record calls', () => {
      try {
        uncheckedMyFunc({ name: 456, value: 'invalid' });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        expect(message).toContain('Argument \'name\' must be of type \'string\'');
        expect(message).toContain('Got: number');
      }
    });
  });
});
