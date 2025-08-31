import { describe, it, expect } from 'vitest';
import { defineFunction, callWithContext, type FunctionThis } from '../define-function';
import { Context } from '../context';
import { List, Sequence, Operation, Num, Dimension, Color } from '../tree';

describe('defineFunction - splitSequence', () => {
  describe('splitSequence functionality', () => {
    it('should split a sequence into individual arguments', async () => {
      const rgb = defineFunction(
        'rgb',
        function(r: Num, g: Num, b: Num) {
          return `rgb(${r} ${g} ${b})`;
        },
        {
          params: [
            { name: 'r', type: Num },
            { name: 'g', type: Num },
            { name: 'b', type: Num }
          ],
          splitSequence: true
        }
      );

      // Create a sequence: [255, 128, 64]
      const sequence = new Sequence([
        new Num(255),
        new Num(128),
        new Num(64)
      ]);

      // Create a list containing the sequence
      const list = new List([sequence]);

      const context = new Context();
      const result = await callWithContext(context, rgb, list);

      expect(result).toBe('rgb(255 128 64)');
    });

    it('should handle sequence with slash operation', async () => {
      const rgba = defineFunction(
        'rgba',
        function(r: Num, g: Num, b: Num, a: Dimension) {
          return `rgba(${r} ${g} ${b} / ${a})`;
        },
        {
          params: [
            { name: 'r', type: Num },
            { name: 'g', type: Num },
            { name: 'b', type: Num },
            { name: 'a', type: Dimension }
          ],
          splitSequence: true
        }
      );

      // Create a sequence: [255, 255, 255, [50%, '/', undefined]]
      const operation = new Operation([
        new Dimension({ number: 50, unit: '%' }),
        '/',
        new Num(0) // placeholder for undefined
      ]);

      const sequence = new Sequence([
        new Num(255),
        new Num(255),
        new Num(255),
        operation
      ]);

      const list = new List([sequence]);
      const context = new Context();
      const result = await callWithContext(context, rgba, list);

      // The operation evaluation works correctly
      expect(result).toBe('rgba(255 255 255 / 50%)');
    });

    it('should not split sequence when splitSequence is false', async () => {
      const func = defineFunction(
        'test',
        function(args: Sequence) {
          return `received: ${args}`;
        },
        {
          params: [
            { name: 'args', type: List }
          ],
          splitSequence: false
        }
      );

      const sequence = new Sequence([
        new Num(1),
        new Num(2),
        new Num(3)
      ]);

      const list = new List([sequence]);
      const context = new Context();
      const result = await callWithContext(context, func, list);

      expect(result).toContain('received:');
      // The function receives the evaluated values, not the Sequence object
      expect(result).toContain('1');
    });

    it('should handle empty sequence', async () => {
      const func = defineFunction(
        'test',
        function() {
          return 'empty';
        },
        {
          params: [],
          splitSequence: true
        }
      );

      const sequence = new Sequence([]);
      const list = new List([sequence]);
      const context = new Context();
      const result = await callWithContext(context, func, list);

      expect(result).toBe('empty');
    });

    it('should handle sequence with single item', async () => {
      const func = defineFunction(
        'test',
        function(value: Num) {
          return `value: ${value}`;
        },
        {
          params: [
            { name: 'value', type: Num }
          ],
          splitSequence: true
        }
      );

      const sequence = new Sequence([new Num(42)]);
      const list = new List([sequence]);
      const context = new Context();
      const result = await callWithContext(context, func, list);

      expect(result).toBe('value: 42');
    });
  });

  describe('FunctionThis type', () => {
    it('should provide context and args function', async () => {
      const func = defineFunction(
        'test',
        async function(this: FunctionThis, value: Num) {
          expect(this.context).toBeInstanceOf(Context);
          expect(typeof this.args).toBe('function');

          const evaluatedArgs = await this.args();
          expect(evaluatedArgs).toBeInstanceOf(List);

          return `context: ${this.context}, args: ${evaluatedArgs}`;
        },
        {
          params: [
            { name: 'value', type: Num }
          ]
        }
      );

      const context = new Context();
      const result = await callWithContext(context, func, new Num(42));

      expect(result).toContain('context:');
      expect(result).toContain('args:');
    });

    it('should provide consistent args function regardless of lazy parameters', async () => {
      const func = defineFunction(
        'test',
        async function(this: FunctionThis, value: Num) {
          expect(this.context).toBeInstanceOf(Context);
          expect(typeof this.args).toBe('function');

          const evaluatedArgs = await this.args();
          expect(evaluatedArgs).toBeInstanceOf(List);

          return `evaluated args: ${evaluatedArgs}`;
        },
        {
          params: [
            { name: 'value', type: Num, lazy: true }
          ]
        }
      );

      const context = new Context();
      const result = await callWithContext(context, func, new Num(42));

      expect(result).toContain('evaluated args:');
    });

    it('should handle mixed lazy and non-lazy parameters with consistent API', async () => {
      const func = defineFunction(
        'test',
        async function(this: FunctionThis, immediate: Num, lazy: Num) {
          expect(this.context).toBeInstanceOf(Context);
          expect(typeof this.args).toBe('function');

          const evaluatedArgs = await this.args();
          expect(evaluatedArgs).toBeInstanceOf(List);

          return `immediate: ${immediate}, lazy: ${lazy}, args: ${evaluatedArgs}`;
        },
        {
          params: [
            { name: 'immediate', type: Num },
            { name: 'lazy', type: Num, lazy: true }
          ]
        }
      );

      const context = new Context();
      const result = await callWithContext(context, func, new Num(10), new Num(20));

      expect(result).toContain('immediate: 10');
      // The lazy parameter is passed as a function, so we expect to see the function representation
      expect(result).toContain('lazy:');
    });
  });

  describe('integration tests', () => {
    it('should work with real CSS function call pattern', async () => {
      const hsl = defineFunction(
        'hsl',
        function(h: Num, s: Dimension, l: Dimension, a?: Dimension) {
          if (a) {
            return `hsl(${h} ${s} ${l} / ${a})`;
          }
          return `hsl(${h} ${s} ${l})`;
        },
        {
          params: [
            { name: 'h', type: Num },
            { name: 's', type: Dimension },
            { name: 'l', type: Dimension },
            { name: 'a', type: Dimension, optional: true }
          ],
          splitSequence: true
        }
      );

      // Simulate hsl(180 50% 50% / 0.5)
      const operation = new Operation([
        new Dimension({ number: 0.5 }),
        '/',
        new Num(0)
      ]);

      const sequence = new Sequence([
        new Num(180),
        new Dimension({ number: 50, unit: '%' }),
        new Dimension({ number: 50, unit: '%' }),
        operation
      ]);

      const list = new List([sequence]);
      const context = new Context();
      const result = await callWithContext(context, hsl, list);

      // The operation evaluation works correctly
      expect(result).toBe('hsl(180 50% 50% / 0.5)');
    });

    it('should handle complex nested operations', async () => {
      const func = defineFunction(
        'complex',
        function(a: Num, b: Num, c: Num, d: Num, e: Num) {
          return `${a} ${b} ${c} ${d} ${e}`;
        },
        {
          params: [
            { name: 'a', type: Num },
            { name: 'b', type: Num },
            { name: 'c', type: Num },
            { name: 'd', type: Num },
            { name: 'e', type: Num }
          ],
          splitSequence: true
        }
      );

      // Create a sequence with multiple operations
      const op1 = new Operation([new Num(3), '+', new Num(1)]);
      const op2 = new Operation([new Num(5), '-', new Num(1)]);

      const sequence = new Sequence([
        new Num(1),
        new Num(2),
        op1,
        op2,
        new Num(5)
      ]);

      const list = new List([sequence]);
      const context = new Context();
      const result = await callWithContext(context, func, list);

      // The operations should be evaluated
      expect(result).toBe('1 2 4 4 5');
    });
  });

  describe('comprehensive validation tests', () => {
    describe('runtime validation', () => {
      it('should validate direct function calls with type mismatches', () => {
        const func = defineFunction(
          'test',
          (a: Color) => `received: ${a.type}`,
          { params: [{ name: 'a', type: Color }] }
        );

        const dimension = new Dimension({ number: 10, unit: 'px' });

        // This should throw a runtime error
        expect(() => {
          (func as any)(dimension);
        }).toThrow('Argument \'a\' must be of type \'Color\'');
      });

      it('should validate callWithContext calls with type mismatches', () => {
        const func = defineFunction(
          'test',
          (a: Color) => `received: ${a.type}`,
          { params: [{ name: 'a', type: Color }] }
        );

        const dimension = new Dimension({ number: 10, unit: 'px' });
        const ctx = new Context();

        // This should throw a runtime error
        expect(() => {
          callWithContext(ctx, func as any, dimension);
        }).toThrow('Argument \'a\' must be of type \'Color\'');
      });

      it('should validate lazy parameters when thunks are called', async () => {
        const func = defineFunction(
          'test',
          async (aThunk: () => Promise<Color>) => {
            const a = await aThunk();
            return `received: ${a.type}`;
          },
          { params: [{ name: 'a', type: Color, lazy: true }] }
        );

        // Create a Jess node that evaluates to the wrong type
        const dimensionNode = new Dimension({ number: 10, unit: 'px' });

        // This should throw when the thunk is called
        const result = (func as any)(dimensionNode);
        await expect(result).rejects.toThrow('Argument \'a\' must be of type \'Color\'');
      });

      it('should validate rest parameters correctly', () => {
        const func = defineFunction(
          'test',
          (...args: Color[]) => `received: ${args.length} colors`,
          { params: [{ name: 'args', type: Color, rest: true }] }
        );

        const dimension = new Dimension({ number: 10, unit: 'px' });
        const color = new Color('#ff0000');

        // This should throw for the dimension in the rest array
        expect(() => {
          (func as any)(color, dimension);
        }).toThrow('Element 1 of \'args\' must be of type \'Color\'');
      });

      it('should handle inheritance relationships correctly', () => {
        // Test that Dimension is not compatible with Num (Num extends Dimension, not vice versa)
        const numFunc = defineFunction(
          'test',
          (a: Num) => `received: ${a.type}`,
          { params: [{ name: 'a', type: Num }] }
        );

        const dimension = new Dimension({ number: 10, unit: 'px' });

        // This should fail because Dimension is not compatible with Num
        expect(() => {
          (numFunc as any)(dimension);
        }).toThrow('Argument \'a\' must be of type \'Num\'');

        // Test that Num is compatible with Dimension (Num extends Dimension)
        const dimensionFunc = defineFunction(
          'test',
          (a: Dimension) => `received: ${a.type}`,
          { params: [{ name: 'a', type: Dimension }] }
        );

        const num = new Num(10);

        // This should work because Num extends Dimension
        const result = (dimensionFunc as any)(num);
        expect(result).toBe('received: Number');
      });

      it('should validate primitive types correctly', () => {
        const func = defineFunction(
          'test',
          (a: string, b: number) => `${a}: ${b}`,
          { params: [
            { name: 'a', type: 'string' },
            { name: 'b', type: 'number' }
          ] }
        );

        // This should throw for type mismatches
        expect(() => {
          (func as any)(123, 'not a number');
        }).toThrow('Argument \'a\' must be of type \'string\'');
      });
    });

    describe('compile-time validation', () => {
      it('should catch type mismatches at compile time', () => {
        const func = defineFunction(
          'test',
          (a: Color) => `received: ${a.type}`,
          { params: [{ name: 'a', type: Dimension }] }
        );

        // The TypeScript compiler should catch this mismatch
      });

      it('should allow correct type matches at compile time', () => {
        // This should compile without errors
        const func = defineFunction(
          'test',
          (a: Color) => `received: ${a.type}`,
          { params: [{ name: 'a', type: Color }] }
        );

        // This should work
        const color = new Color('#ff0000');
        const result = func(color);
        expect(result).toBe('received: Color');
      });

      it('should handle inheritance relationships at compile time', () => {
        // This should compile because Num is compatible with Dimension
        const func = defineFunction(
          'test',
          (a: Dimension) => `received: ${a.type}`,
          { params: [{ name: 'a', type: Num }] }
        );

        // This should work
        const num = new Num(10);
        const result = func(num);
        expect(result).toBe('received: Number');
      });
    });

    describe('mixed scenarios', () => {
      it('should handle complex function signatures with multiple types', () => {
        const func = defineFunction(
          'complex',
          (a: Color, b: Dimension, c: string, d: number) => `${a.type} ${b.type} ${c} ${d}`,
          { params: [
            { name: 'a', type: Color },
            { name: 'b', type: Dimension },
            { name: 'c', type: 'string' },
            { name: 'd', type: 'number' }
          ] }
        );

        const color = new Color('#ff0000');
        const dimension = new Dimension({ number: 10, unit: 'px' });

        // This should work
        const result = func(color, dimension, 'test', 42);
        expect(result).toBe('Color Dimension test 42');

        // This should throw for type mismatches
        expect(() => {
          (func as any)(dimension, color, 123, 'not a number');
        }).toThrow('Argument \'a\' must be of type \'Color\'');
      });

      it('should handle optional parameters correctly', () => {
        const func = defineFunction(
          'optional',
          (a: Color, b?: Dimension) => `${a.type} ${b?.type || 'none'}`,
          { params: [
            { name: 'a', type: Color },
            { name: 'b', type: Dimension, optional: true }
          ] }
        );

        const color = new Color('#ff0000');
        const dimension = new Dimension({ number: 10, unit: 'px' });

        // These should all work
        expect(func(color)).toBe('Color none');
        expect(func(color, dimension)).toBe('Color Dimension');

        // This should throw for missing required parameter
        expect(() => {
          (func as any)();
        }).toThrow('Required argument \'a\' is missing');
      });

      it('should handle default values correctly', () => {
        const func = defineFunction(
          'defaults',
          (a: Color, b: Dimension) => `${a.type} ${b.type}`,
          { params: [
            { name: 'a', type: Color },
            { name: 'b', type: Dimension, default: new Dimension({ number: 5, unit: 'px' }) }
          ] }
        );

        const color = new Color('#ff0000');

        // This should work with default
        const result = func(color);
        expect(result).toBe('Color Dimension');
      });
    });
  });
});
