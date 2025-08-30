import { type Context, UnitMode } from '../context';
import { Color, ColorFormat } from './color';
import {
  Node,
  type LocationInfo,
  type NodeOptions,
  type TreeContext,
  defineType
} from './node';
import { type Operator, calculate } from './util/calculate';
import { logger } from '../logger';
import round from 'lodash-es/round';
import { type PrintOptions, getPrintOptions } from './util/print';

// import type { Context } from '../context'
// import type { OutputCollector } from '../output'

export type DimensionValue = {
  number: number;
  unit?: string;
};

const { isArray } = Array;

type LengthUnit = 'm' | 'cm' | 'mm' | 'in' | 'px' | 'pt' | 'pc';
type DurationUnit = 's' | 'ms';
type AngleUnit = 'rad' | 'deg' | 'grad' | 'turn';
type ConversionUnit = LengthUnit | DurationUnit | AngleUnit;
type UnitMapEntries = Array<[ConversionUnit, ConversionGroup]>;

export interface Dimension extends Node<DimensionValue> {
  eval(context: Context): Dimension;
}

/**
 * A number or dimension
 */
export class Dimension extends Node<DimensionValue> {
  type = 'Dimension';
  shortType = 'dimension';
  // Dimensions are static and don't need evaluation

  private _unitToGroup: Map<string, ConversionGroup> | undefined;
  get unitToGroup() {
    let unitToGroup = this._unitToGroup;
    if (!unitToGroup) {
      const lengthEntries: UnitMapEntries = ['m', 'cm', 'mm', 'in', 'px', 'pt', 'pc'].map(unit => [unit as LengthUnit, ConversionGroup.Length]);
      const durationEntries: UnitMapEntries = ['s', 'ms'].map(unit => [unit as DurationUnit, ConversionGroup.Duration]);
      const angleEntries: UnitMapEntries = ['rad', 'deg', 'grad', 'turn'].map(unit => [unit as AngleUnit, ConversionGroup.Angle]);
      const entries = lengthEntries.concat(durationEntries).concat(angleEntries);
      this._unitToGroup = unitToGroup = new Map(entries);
    }
    return unitToGroup;
  }

  override valueOf() {
    let { number, unit } = this.value;
    return unit ? `${number}${unit}` : number;
  }

  override operate(b: Node, op: Operator, context?: Context | undefined): Dimension | Color {
    if (!(b instanceof Dimension || b instanceof Color)) {
      throw new TypeError(`Cannot operate on ${b.type}`);
    }
    let unitToGroup = this.unitToGroup;
    if (b instanceof Color) {
      let { number, unit } = this.value;
      if (unit) {
        throw new TypeError(`Cannot convert "${this}" to a color`);
      }
      let thisColor = new Color({ format: ColorFormat.RGB }).inherit(this);
      thisColor.rgb = [number, number, number];
      return thisColor.operate(b, op, context).inherit(this);
    }
    let { number: aVal, unit: aUnit } = this.value;
    let { number: bVal, unit: bUnit } = b.value;
    let isStrictMode = context?.opts.unitMode === UnitMode.STRICT;

    if (bVal === 0 && op === '/') {
      throw new TypeError('Cannot divide by zero');
    }
    if (!aUnit || !bUnit) {
      let outUnit = aUnit ?? bUnit;
      /** One or both doesn't have a unit, so just calculate the number */
      if (isStrictMode && bUnit && op === '/') {
        throw new TypeError('Cannot divide a number by a unit');
      }
      return new Dimension({ number: calculate(aVal, op, bVal), unit: outUnit }).inherit(this);
    }

    if (aUnit === bUnit) {
      /** Both units match, so the now we have some choices */
      if (op === '+' || op === '-') {
        return new Dimension({ number: calculate(aVal, op, bVal), unit: aUnit }).inherit(this);
      }
      if (isStrictMode) {
        if (op === '*') {
          throw new TypeError('Cannot multiply two units together');
        } else {
          /** Cancel units during division */
          return new Dimension({ number: calculate(aVal, op, bVal) }).inherit(this);
        }
      } else {
        return new Dimension({ number: calculate(aVal, op, bVal), unit: aUnit }).inherit(this);
      }
    }
    const aGroup = unitToGroup.get(aUnit);
    const bGroup = unitToGroup.get(bUnit);

    if (aGroup === undefined || bGroup === undefined || aGroup !== bGroup) {
      if (isStrictMode) {
        /** Units don't match, and can't be converted */
        throw new TypeError('Incompatible units. Change the units or use the unit function');
      }
      /** Just coerce to the left-hand unit */
      return new Dimension({ number: calculate(aVal, op, bVal), unit: aUnit }).inherit(this);
    }
    const group = conversions[bGroup];
    // @ts-expect-error - set up proper indexing later
    let atomicUnit = group[aUnit] as number;
    // @ts-expect-error - set up proper indexing later
    let targetUnit = group[bUnit] as number;

    bVal = bVal / (atomicUnit / targetUnit);
    return new Dimension({ number: calculate(aVal, op, bVal), unit: aUnit }).inherit(this);
  }

  override compare(b: Node, context: Context): 0 | 1 | -1 | undefined {
    if (!(b instanceof Dimension || b instanceof Color)) {
      /** Do a string comparison */
      return super.compare(b, context);
    }
    let unitToGroup = this.unitToGroup;
    let isStrictMode = context?.opts.unitMode === UnitMode.STRICT;
    let { number: aVal, unit: aUnit } = this.value;
    if (b instanceof Color) {
      if (aUnit) {
        let msg = `Cannot convert "${this}" to a color`;
        if (isStrictMode) {
          throw new TypeError(msg);
        } else {
          logger.warn(msg);
        }
        return super.compare(b, context);
      }
      let thisColor = new Color({ format: ColorFormat.RGB }).inherit(this);
      thisColor.rgb = [aVal, aVal, aVal];
      return thisColor.compare(b);
    }
    let { number: bVal, unit: bUnit } = b.value;

    if (
      (!aUnit && !bUnit)
      || (aUnit && bUnit)
    ) {
      /** These are the only truly comparable dimensions */
      if (!aUnit) {
        return Node.numericCompare(aVal, bVal);
      }
      const aGroup = unitToGroup.get(aUnit);
      const bGroup = unitToGroup.get(bUnit!);

      if (aGroup === undefined || bGroup === undefined || aGroup !== bGroup) {
        if (isStrictMode) {
          /** Units don't match, and can't be converted */
          throw new TypeError('Incompatible units. Change the units or use the unit function');
        }
        /** Just compare numbers but not units */
        return Node.numericCompare(aVal, bVal);
      }
      const group = conversions[bGroup];
      // @ts-expect-error - set up proper indexing later
      let atomicUnit = group[aUnit] as number;
      // @ts-expect-error - set up proper indexing later
      let targetUnit = group[bUnit] as number;

      bVal = bVal / (atomicUnit / targetUnit);

      return Node.numericCompare(aVal, bVal);
    } else {
      return super.compare(b, context);
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { number, unit = '' } = this.value;
    const numberStr = `${round(number, 8)}`.toLowerCase();
    w.add(numberStr, this);
    if (unit) {
      w.add(unit);
    }
    return w.getSince(mark);
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add(this.toString(), this.location)
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const pre = context.pre
  //   out.add('$J.num({\n' +
  //     `  ${pre}value: ${this.value},\n` +
  //     `  ${pre}unit: "${this.unit ?? ''}"\n` +
  //     `${pre}})`
  //   , this.location)
  // }
}

const enum ConversionGroup {
  Length = 0,
  Duration = 1,
  Angle = 2
}

const conversions = {
  [ConversionGroup.Length]: {
    m: 1,
    cm: 0.01,
    mm: 0.001,
    in: 0.0254,
    px: 0.0254 / 96,
    pt: 0.0254 / 72,
    pc: 0.0254 / 72 * 12
  } satisfies Record<LengthUnit, number>,
  [ConversionGroup.Duration]: {
    s: 1,
    ms: 0.001
  } satisfies Record<DurationUnit, number>,
  [ConversionGroup.Angle]: {
    rad: 1 / (2 * Math.PI),
    deg: 1 / 360,
    grad: 1 / 400,
    turn: 1
  } satisfies Record<AngleUnit, number>
};

defineType(Dimension, 'Dimension');

export const dimension = (
  value: DimensionValue | [number, string] | number,
  options?: NodeOptions,
  location?: LocationInfo,
  treeContext?: TreeContext
) => {
  if (isArray(value)) {
    let [number, unit] = value;
    return new Dimension({ number, unit }, options, location, treeContext);
  }
  return new Dimension(typeof value === 'number' ? { number: value } : value, options, location, treeContext);
};