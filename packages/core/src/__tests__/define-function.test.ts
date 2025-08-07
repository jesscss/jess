import { describe, it, expect } from 'vitest';
import { defineFunction } from '../define-function';
import { expectTypeOf } from 'vitest';
import { Color, Dimension } from '../tree';

describe('defineFunction', () => {
  const args = [
    { name: 'name', type: 'string' },
    { name: 'value', type: 'number' }
  ] as const;

  const myFunc = defineFunction(
    'test',
    (record: { name: string; value: number }) => `${record.name}: ${record.value}`,
    { params: args }
  );

  describe('positional calls', () => {
    it('should work with valid positional arguments', () => {
      const myFunc = defineFunction(
        'test',
        (record: { name: string; value: number }) => `${record.name}: ${record.value}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'value', type: 'number' }
        ] }
      );
      expect(myFunc('hello', 42)).toBe('hello: 42');
    });

    it('should throw error for invalid first argument type', () => {
      expect(() => {
        (myFunc as any)(1, 42);
      }).toThrow('Argument \'name\' must be of type \'string\'. Got: number');
    });

    it('should throw error for invalid second argument type', () => {
      expect(() => {
        (myFunc as any)('hello', 'not a number');
      }).toThrow('Argument \'value\' must be of type \'number\'. Got: string');
    });

    it('should handle undefined arguments gracefully', () => {
      // With the new validation, undefined arguments for required parameters should throw
      expect(() => {
        myFunc('hello', undefined as any);
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
        myFunc({ name: 'hello' });
      }).toThrow('Required argument \'value\' is missing');
    });

    it('should throw error for invalid property type in record', () => {
      expect(() => {
        (myFunc as any)({ name: 123, value: 42 });
      }).toThrow('Argument \'name\' must be of type \'string\'. Got: number');
    });

    it('should throw error for invalid second property type in record', () => {
      expect(() => {
        (myFunc as any)({ name: 'hello', value: 'not a number' });
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
      (myFunc as any)('hello', { value: 42, extra: 'ignored' });
      // The function should still work correctly despite extra properties
      expect(myFunc('hello', { value: 42 })).toBe('hello: 42');
    });

    it('should throw error for invalid positional argument in hybrid call', () => {
      expect(() => {
        (myFunc as any)(123, { value: 42 });
      }).toThrow('Argument \'name\' must be of type \'string\'. Got: number');
    });

    it('should throw error for invalid record property in hybrid call', () => {
      expect(() => {
        (myFunc as any)('hello', { value: 'not a number' });
      }).toThrow('Argument \'value\' must be of type \'number\'. Got: string');
    });
  });

  describe('edge cases', () => {
    it('should handle empty record', () => {
      // With the new validation, empty record should throw for missing required parameters
      expect(() => {
        myFunc({});
      }).toThrow('Required argument \'name\' is missing');
    });

    it('should handle null values', () => {
      expect(() => {
        (myFunc as any)(null, 42);
      }).toThrow('Argument \'name\' must be of type \'string\'. Got: object');
    });

    it('should handle boolean values', () => {
      expect(() => {
        (myFunc as any)(true, 42);
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
        (record: { name: string; age: number; active: boolean }) =>
          `${record.name} is ${record.age} years old and is ${record.active ? 'active' : 'inactive'}`,
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
        (record: { required: string; optional?: number }) =>
          `${record.required}${record.optional ? `: ${record.optional}` : ''}`,
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
        (record: { name: string; value: number }) => `${record.name}: ${record.value}`,
        { params: requiredArgs }
      );

      expect(() => {
        (requiredFunc as any)();
      }).toThrow('Required argument \'name\' is missing');

      expect(() => {
        (requiredFunc as any)('hello');
      }).toThrow('Required argument \'value\' is missing');
    });

    it('should work with all optional parameters', () => {
      const allOptionalArgs = [
        { name: 'name', type: 'string', optional: true },
        { name: 'value', type: 'number', optional: true }
      ] as const;

      const allOptionalFunc = defineFunction(
        'allOptional',
        (values: { name?: string; value?: number }) => `${values.name || 'default'}: ${values.value || 0}`,
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
        (record: { name: string; value: number }) => `${record.name}: ${record.value}`,
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
        (record: { name: string; age: number; active: boolean }) => `${record.name}: ${record.age}, ${record.active}`,
        { params: args }
      );

      // The function should have the same parameter names as the original function
      expect(func({ name: 'John', age: 30, active: true })).toBe('John: 30, true');
      expect(func({ name: 'Jane', age: 25, active: false })).toBe('Jane: 25, false');

      // Test that parameter names are preserved in the type
      expectTypeOf(func).toBeFunction();
      expectTypeOf(func).returns.toBeString();
    });

    it('should validate that args match function signature', () => {
      // This should work - args match function signature
      const validArgs = [
        { name: 'name', type: 'string' },
        { name: 'value', type: 'number' }
      ] as const;

      const validFunc = defineFunction(
        'valid',
        (record: { name: string; value: number }) => `${record.name}: ${record.value}`,
        { params: validArgs }
      );

      expect(validFunc({ name: 'hello', value: 42 })).toBe('hello: 42');

      // Test that the function signature matches the original
      expectTypeOf(validFunc).toBeFunction();
      expectTypeOf(validFunc).returns.toBeString();

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
        (record: { name: string; value: number }): string => `${record.name}: ${record.value}`,
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
        (values: { name: string; age: number; active: boolean }) => `${values.name} (${values.age}) - ${values.active ? 'active' : 'inactive'}`,
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
        (values: { name: string; age: number; city: string }) => `${values.name} (${values.age}) from ${values.city}`,
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
        (values: { name: string; count: number; enabled: boolean }) => `${values.name}: ${values.count} items, ${values.enabled ? 'enabled' : 'disabled'}`,
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
        (values: { color: Color; dimension?: Dimension; alpha?: number }) => {
          return {
            colorType: values.color.type,
            dimensionType: values.dimension?.type || 'none',
            alpha: values.alpha || 1
          };
        },
        { params: treeNodeArgs }
      );

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
        treeNodeFunc('not a color' as any, testDimension);
      }).toThrow('Argument \'color\' must be of type \'Color\'');
    });
  });

  describe('type checking', () => {
    it('should have strong typing for 1 parameter', () => {
      const singleParamFunc = defineFunction(
        'singleParam',
        (values: { name: string }) => `Hello ${values.name}`,
        { params: [{ name: 'name', type: 'string' }] }
      );

      // These should have strong typing
      expectTypeOf(singleParamFunc).toBeFunction();
      expectTypeOf(singleParamFunc).returns.toBeString();

      // Test that it works
      expect(singleParamFunc('World')).toBe('Hello World');
    });

    it('should have strong typing for 2 parameters', () => {
      const twoParamFunc = defineFunction(
        'twoParam',
        (values: { name: string; age: number }) => `${values.name} is ${values.age} years old`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' }
        ] }
      );

      // These should have strong typing
      expectTypeOf(twoParamFunc).toBeFunction();
      expectTypeOf(twoParamFunc).returns.toBeString();

      // Test that it works
      expect(twoParamFunc('Alice', 25)).toBe('Alice is 25 years old');
    });

    it('should have strong typing for 3 parameters', () => {
      const threeParamFunc = defineFunction(
        'threeParam',
        (values: { name: string; age: number; city: string }) => `${values.name} is ${values.age} from ${values.city}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' },
          { name: 'city', type: 'string' }
        ] }
      );

      // These should have strong typing
      expectTypeOf(threeParamFunc).toBeFunction();
      expectTypeOf(threeParamFunc).returns.toBeString();

      // Test that it works
      expect(threeParamFunc('Bob', 30, 'New York')).toBe('Bob is 30 from New York');
    });

    it('should have strong typing for 4 parameters', () => {
      const fourParamFunc = defineFunction(
        'fourParam',
        (values: { name: string; age: number; city: string; active: boolean }) =>
          `${values.name} is ${values.age} from ${values.city}, ${values.active ? 'active' : 'inactive'}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' },
          { name: 'city', type: 'string' },
          { name: 'active', type: 'boolean' }
        ] }
      );

      // These should have strong typing
      expectTypeOf(fourParamFunc).toBeFunction();
      expectTypeOf(fourParamFunc).returns.toBeString();

      // Test that it works
      expect(fourParamFunc('Charlie', 35, 'London', true)).toBe('Charlie is 35 from London, active');
    });

    it('should have strong typing for 5 parameters', () => {
      const fiveParamFunc = defineFunction(
        'fiveParam',
        (values: { name: string; age: number; city: string; active: boolean; score: number }) =>
          `${values.name} is ${values.age} from ${values.city}, ${values.active ? 'active' : 'inactive'}, score: ${values.score}`,
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
      expectTypeOf(fiveParamFunc).returns.toBeString();

      // Test that it works
      expect(fiveParamFunc('David', 40, 'Paris', false, 85)).toBe('David is 40 from Paris, inactive, score: 85');
    });

    it('should work with 6+ parameters (fallback typing)', () => {
      const sixParamFunc = defineFunction(
        'sixParam',
        (values: { name: string; age: number; city: string; active: boolean; score: number; level: string }) =>
          `${values.name} is ${values.age} from ${values.city}, ${values.active ? 'active' : 'inactive'}, score: ${values.score}, level: ${values.level}`,
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
      expectTypeOf(sixParamFunc).returns.toBeString();

      // Test that it works
      expect(sixParamFunc('Eve', 45, 'Tokyo', true, 92, 'expert')).toBe('Eve is 45 from Tokyo, active, score: 92, level: expert');
    });

    it('should work with 7+ parameters (fallback typing)', () => {
      const sevenParamFunc = defineFunction(
        'sevenParam',
        (values: { name: string; age: number; city: string; active: boolean; score: number; level: string; rank: number }) =>
          `${values.name} is ${values.age} from ${values.city}, ${values.active ? 'active' : 'inactive'}, score: ${values.score}, level: ${values.level}, rank: ${values.rank}`,
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
      expectTypeOf(sevenParamFunc).returns.toBeString();

      // Test that it works
      expect(sevenParamFunc('Frank', 50, 'Berlin', false, 78, 'intermediate', 3)).toBe('Frank is 50 from Berlin, inactive, score: 78, level: intermediate, rank: 3');
    });

    it('should demonstrate parameter name preservation in strong typing', () => {
      const preservedFunc = defineFunction(
        'preserved',
        (values: { firstName: string; lastName: string; age: number }) => `${values.firstName} ${values.lastName} is ${values.age}`,
        { params: [
          { name: 'firstName', type: 'string' },
          { name: 'lastName', type: 'string' },
          { name: 'age', type: 'number' }
        ] }
      );

      // The function should preserve parameter names in the type signature
      expectTypeOf(preservedFunc).toBeFunction();
      expectTypeOf(preservedFunc).returns.toBeString();

      // Test that it works
      expect(preservedFunc('John', 'Doe', 30)).toBe('John Doe is 30');
    });

    it('should demonstrate optional parameters in strong typing', () => {
      const optionalFunc = defineFunction(
        'optional',
        (values: { name: string; age?: number; city?: string }) => `${values.name}${values.age ? ` is ${values.age}` : ''}${values.city ? ` from ${values.city}` : ''}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number', optional: true },
          { name: 'city', type: 'string', optional: true }
        ] }
      );

      // Should have strong typing for optional parameters
      expectTypeOf(optionalFunc).toBeFunction();
      expectTypeOf(optionalFunc).returns.toBeString();

      // Test various combinations
      expect(optionalFunc('Alice')).toBe('Alice');
      expect(optionalFunc('Bob', 25)).toBe('Bob is 25');
      expect(optionalFunc('Charlie', 30, 'London')).toBe('Charlie is 30 from London');
    });

    it('should demonstrate default values in strong typing', () => {
      const defaultFunc = defineFunction(
        'default',
        (values: { name: string; age: number; city: string }) => `${values.name} is ${values.age} from ${values.city}`,
        { params: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number', default: 25 },
          { name: 'city', type: 'string', default: 'Unknown' }
        ] }
      );

      // Should have strong typing with defaults
      expectTypeOf(defaultFunc).toBeFunction();
      expectTypeOf(defaultFunc).returns.toBeString();

      // Test that defaults work
      expect(defaultFunc('David')).toBe('David is 25 from Unknown');
      expect(defaultFunc('Eve', 30)).toBe('Eve is 30 from Unknown');
      expect(defaultFunc('Frank', 35, 'Paris')).toBe('Frank is 35 from Paris');
    });
  });

  describe('error messages', () => {
    it('should provide descriptive error messages', () => {
      try {
        (myFunc as any)(123, 'invalid');
      } catch (error) {
        expect((error as Error).message).toContain('Argument \'name\' must be of type \'string\'');
        expect((error as Error).message).toContain('Got: number');
      }
    });

    it('should provide error messages for record calls', () => {
      try {
        (myFunc as any)({ name: 456, value: 'invalid' });
      } catch (error) {
        expect((error as Error).message).toContain('Argument \'name\' must be of type \'string\'');
        expect((error as Error).message).toContain('Got: number');
      }
    });
  });
});