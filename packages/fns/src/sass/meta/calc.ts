import type { FunctionCall, ValueGroup } from '@jesscss/core/value';
import { checkAny, define, emitValue, groupItems, isMathFunctionName, isValueGroupArray, makeKeyword, makeList, makeQuoted } from '@jesscss/core/value';
import { exactArgs } from './args.js';
import { describeValue } from './inspect.js';

/**
 * A Sass calculation: a call to a css-values-4 math function that the value
 * still is (`calc(var(--c))`, `min(1px, 2em)`), written or built by the
 * compile around math it kept (`var(--a) + 1px`). One the compile reduced
 * (`calc(1px)`) is already the number. The test is the one `negatedCall`
 * (`math-operand.ts`) reads a math call by.
 */
export const isCalculation = (value: ValueGroup): value is FunctionCall =>
  !isValueGroupArray(value) && value.type === 'FunctionCall' && (value.computed ? value.result === 'numeric' : isMathFunctionName(value.name));

/*
 * A `calc()` inside another math function's arguments is, to Sass, what it
 * holds (Dart Sass simplifies it away): a nested calculation is itself, an
 * operation (`clamp(1px, 2em + 1px, 3em)`, `calc(2em + 1px)`) is its text, and
 * anything else (`calc(var(--c))`) is its text in parentheses, `(var(--c))`.
 * Each text is a string.
 */
function calcArgument(value: ValueGroup): ValueGroup {
  if (isValueGroupArray(value) || value.type !== 'FunctionCall' || value.name.toLowerCase() !== 'calc') {
    return value;
  }
  const inner = value.args;
  if (isCalculation(inner)) {
    return inner;
  }
  const text = emitValue(inner);
  return makeKeyword(!isValueGroupArray(inner) && inner.type === 'Arithmetic' ? text : `(${text})`);
}

function calculation(items: readonly ValueGroup[]): FunctionCall {
  exactArgs(items, ['calc']);
  const calc = items[0]!;
  if (!isCalculation(calc)) {
    throw new TypeError(`$calc: ${describeValue(calc)} is not a calculation.`);
  }
  return calc;
}

/** Sass `meta.calc-name($calc)`: a calculation's name, as a quoted string (`"clamp"`). */
const calcName = define('calc-name', {
  params: [{ name: 'calc', type: 'any', check: checkAny }] as const,
  variadic: true,
  body: items => makeQuoted(calculation(items).name.toLowerCase(), '"', false)
});

/**
 * Sass `meta.calc-args($calc)`: a calculation's arguments, as a comma list. A
 * number or a nested calculation stays itself; an operation (`1px + 1em`), a
 * `var()` or an interpolation is a string, which each already is to `type-of`,
 * and a nested `calc()` is read as {@link calcArgument} reads it.
 */
const calcArgs = define('calc-args', {
  params: [{ name: 'calc', type: 'any', check: checkAny }] as const,
  variadic: true,
  body: (items) => {
    const calc = calculation(items);
    return makeList(calc.name.toLowerCase() === 'calc' ? [calc.args] : groupItems(calc.args).map(calcArgument), ',');
  }
});

export { calcName, calcArgs };
