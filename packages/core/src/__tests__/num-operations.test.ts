import { describe, it, expect } from 'vitest';
import { Num } from '../tree/number.js';
import { Dimension } from '../tree/dimension.js';

describe('Num operations', () => {
  it('should return Num instances when operating on Num with Num', () => {
    const n1 = new Num(3);
    const n2 = new Num(1);

    // Addition should return Num
    const addResult = n1.operate(n2, '+');
    expect(addResult).toBeInstanceOf(Num);
    expect(addResult.type).toBe('Num');
    expect(addResult.number).toBe(4);
    expect(addResult.unit).toBeUndefined();

    // Subtraction should return Num
    const subResult = n1.operate(n2, '-');
    expect(subResult).toBeInstanceOf(Num);
    expect(subResult.type).toBe('Num');
    expect(subResult.number).toBe(2);
    expect(subResult.unit).toBeUndefined();

    // Multiplication should return Num
    const mulResult = n1.operate(n2, '*');
    expect(mulResult).toBeInstanceOf(Num);
    expect(mulResult.type).toBe('Num');
    expect(mulResult.number).toBe(3);
    expect(mulResult.unit).toBeUndefined();

    // Division should return Num
    const divResult = n1.operate(n2, '/');
    expect(divResult).toBeInstanceOf(Num);
    expect(divResult.type).toBe('Num');
    expect(divResult.number).toBe(3);
    expect(divResult.unit).toBeUndefined();
  });

  it('should return Dimension instances when operating on Num with Dimension', () => {
    const n1 = new Num(3);
    const d1 = new Dimension({ number: 2, unit: 'px' });

    // Addition should return Dimension
    const addResult = n1.operate(d1, '+');
    expect(addResult).toBeInstanceOf(Dimension);
    expect(addResult.type).toBe('Dimension');
    expect((addResult as Dimension).number).toBe(5);
    expect((addResult as Dimension).unit).toBe('px');

    // Subtraction should return Dimension
    const subResult = n1.operate(d1, '-');
    expect(subResult).toBeInstanceOf(Dimension);
    expect(subResult.type).toBe('Dimension');
    expect((subResult as Dimension).number).toBe(1);
    expect((subResult as Dimension).unit).toBe('px');
  });

  it('should return Num instances when operating on Num with Dimension that has no unit', () => {
    const n1 = new Num(3);
    const d1 = new Dimension({ number: 2 }); // No unit

    // Addition should return Num (because result has no unit)
    const addResult = n1.operate(d1, '+');
    expect(addResult).toBeInstanceOf(Num);
    expect(addResult.type).toBe('Num');
    expect(addResult.number).toBe(5);
    expect(addResult.unit).toBeUndefined();

    // Subtraction should return Num (because result has no unit)
    const subResult = n1.operate(d1, '-');
    expect(subResult).toBeInstanceOf(Num);
    expect(subResult.type).toBe('Num');
    expect(subResult.number).toBe(1);
    expect(subResult.unit).toBeUndefined();
  });

  it('should handle complex operations correctly', () => {
    const n1 = new Num(10);
    const n2 = new Num(2);
    const n3 = new Num(3);

    // Complex operation: (10 + 2) * 3
    const step1 = n1.operate(n2, '+') as Num;
    expect(step1).toBeInstanceOf(Num);
    expect(step1.number).toBe(12);

    const step2 = step1.operate(n3, '*');
    expect(step2).toBeInstanceOf(Num);
    expect(step2.number).toBe(36);
  });
});
