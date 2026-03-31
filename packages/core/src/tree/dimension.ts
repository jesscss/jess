import type { Class } from 'type-fest';
import { type Context } from '../context.js';
import { Color, ColorFormat } from './color.js';
import {
  Node,
  F_STATIC,
  type OptionalLocation,
  type NodeOptions,
  type TreeContext,
  defineType
} from './node.js';
import { type Operator, calculate } from './util/calculate.js';
import { logger } from '../logger.js';
import round from 'lodash-es/round.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

// import type { Context } from '../context.js'
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
  type: 'Dimension' | 'Num';
  shortType: 'dimension' | 'num';
  eval(context: Context): Dimension;
}

/**
 * A number or dimension
 */
export class Dimension extends Node<DimensionValue> {
  static override childKeys = null as null;

  readonly number!: number;
  readonly unit: string | undefined;

  constructor(
    value: DimensionValue,
    options?: NodeOptions,
    location?: OptionalLocation,
    treeContext?: TreeContext
  ) {
    super(value, options, location, treeContext);
    this.number = value.number;
    this.unit = value.unit;
    this.addFlag(F_STATIC);
  }

  /** Compatibility — synthesizes the legacy .data shape from instance fields */

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

  override clone(deep?: boolean): this {
    const options = this._meta?.options;
    const newNode = new (this.constructor as Class<this>)(
      { number: this.number, unit: this.unit },
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    );
    newNode.inherit(this);
    return newNode;
  }

  override valueOf() {
    const { number, unit } = this;
    return unit ? `${number}${unit}` : number;
  }

  override operate(b: Node, op: Operator, context?: Context | undefined): Dimension | Color {
    if (!(b instanceof Dimension || b instanceof Color)) {
      throw new TypeError(`Cannot operate on ${b.type}`);
    }
    let unitToGroup = this.unitToGroup;
    if (b instanceof Color) {
      let { number, unit } = this;
      const unitMode = context?.opts?.unitMode ?? 'loose';
      const isStrictLikeMode = unitMode === 'strict' || unitMode === 'preserve';
      if (unit && isStrictLikeMode) {
        throw new TypeError(`Cannot convert "${this}" to a color`);
      }
      let thisColor = new Color(
        { rgb: [number, number, number] },
        { format: b.options?.format ?? ColorFormat.RGB }
      ).inherit(this);
      return thisColor.operate(b, op, context).inherit(this);
    }
    let { number: aVal, unit: aUnit } = this;
    let { number: bVal, unit: bUnit } = b;
    let unitMode = context?.opts.unitMode ?? 'loose';
    let isStrictMode = unitMode === 'strict';
    let isPreserveMode = unitMode === 'preserve';

    if (bVal === 0 && op === '/') {
      throw new TypeError('Cannot divide by zero');
    }
    if (!aUnit || !bUnit) {
      let outUnit = aUnit ?? bUnit;
      /** One or both doesn't have a unit, so just calculate the number */
      if ((isStrictMode || isPreserveMode) && bUnit && op === '/') {
        if (isPreserveMode) {
          return new Dimension({
            number: calculate(aVal, op, bVal),
            unit: `1/${bUnit}`
          }).inherit(this);
        }
        throw new TypeError('Cannot divide a number by a unit');
      }
      return new Dimension({ number: calculate(aVal, op, bVal), unit: outUnit }).inherit(this);
    }

    if (aUnit === bUnit) {
      /** Both units match, so the now we have some choices */
      if (op === '+' || op === '-') {
        return new Dimension({ number: calculate(aVal, op, bVal), unit: aUnit }).inherit(this);
      }
      if (isStrictMode || isPreserveMode) {
        if (op === '*') {
          if (isPreserveMode) {
            return new Dimension({
              number: calculate(aVal, op, bVal),
              unit: `${aUnit}*${bUnit}`
            }).inherit(this);
          }
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
      if (isStrictMode || isPreserveMode) {
        if (isPreserveMode) {
          return new Dimension({
            number: calculate(aVal, op, bVal),
            unit: (
              op === '+' || op === '-'
                ? `${aUnit}±${bUnit}`
                : `${aUnit}${op}${bUnit}`
            )
          }).inherit(this);
        }
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

    if (isPreserveMode && (op === '*' || op === '/')) {
      return new Dimension({
        number: calculate(aVal, op, bVal),
        unit: `${aUnit}${op}${bUnit}`
      }).inherit(this);
    }

    bVal = bVal / (atomicUnit / targetUnit);
    return new Dimension({ number: calculate(aVal, op, bVal), unit: aUnit }).inherit(this);
  }

  override compare(b: Node, context?: Context): 0 | 1 | -1 | undefined {
    if (b.type === 'Any') {
      const text = String(('value' in b ? b.value : '') ?? '').trim();
      if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
        return undefined;
      }
      return this.number === Number(text) ? 0 : undefined;
    }
    if (b.type === 'Quoted') {
      return undefined;
    }
    if (b.type === 'Bool') {
      return undefined;
    }
    if (!(b instanceof Dimension || b instanceof Color)) {
      return undefined;
    }
    let unitToGroup = this.unitToGroup;
    let unitMode = context?.opts?.unitMode ?? 'loose';
    let isStrictMode = unitMode === 'strict';
    let isPreserveMode = unitMode === 'preserve';
    let { number: aVal, unit: aUnit } = this;

    /** Normalize percentages to a number for numerical comparison */
    if (aUnit === '%') {
      aVal = aVal / 100;
      aUnit = undefined;
    }
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
      let thisColor = new Color({ rgb: [aVal, aVal, aVal] }, { format: ColorFormat.RGB }).inherit(this);
      return thisColor.compare(b);
    }
    let { number: bVal, unit: bUnit } = b;
    if (bUnit === '%') {
      bVal = bVal / 100;
      bUnit = undefined;
    }

    if (!aUnit && !bUnit) {
      return Node.numericCompare(aVal, bVal);
    }
    if (!aUnit || !bUnit) {
      // Less guards allow unitless numbers to compare directly with dimensions.
      return Node.numericCompare(aVal, bVal);
    }
    if (aUnit && bUnit) {
      /** These are the only truly comparable dimensions */
      if (!aUnit) {
        return Node.numericCompare(aVal, bVal);
      }
      const aGroup = unitToGroup.get(aUnit);
      const bGroup = unitToGroup.get(bUnit!);

      if (aGroup === undefined || bGroup === undefined || aGroup !== bGroup) {
        if (isStrictMode || isPreserveMode) {
          /** Units don't match, and can't be converted */
          throw new TypeError('Incompatible units. Change the units or use the unit function');
        }
        return undefined;
      }
      const group = conversions[bGroup];
      // @ts-expect-error - set up proper indexing later
      let atomicUnit = group[aUnit] as number;
      // @ts-expect-error - set up proper indexing later
      let targetUnit = group[bUnit] as number;

      bVal = bVal / (atomicUnit / targetUnit);

      return Node.numericCompare(aVal, bVal);
    }
    return super.compare(b, context);
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { number, unit = '' } = this;

    // Check if unit is compound (contains '/', '*', or '±')
    const isCompoundUnit = unit && (unit.includes('/') || unit.includes('*') || unit.includes('±'));

    if (isCompoundUnit) {
      // Output as calc() for compound units
      // Parse the compound unit to reconstruct a valid calc() expression
      w.add('calc(', this);
      const numberStr = `${round(number, 8)}`.toLowerCase();

      // Parse compound unit to create calc expression
      if (unit.includes('/')) {
        // Division: "px/s" or "1/s" → calc(number * 1px / 1s) or calc(number / 1s)
        const parts = unit.split('/');
        const numerator = parts[0] || '1';
        const denominator = parts[1] || '1';
        if (numerator === '1') {
          // Special case: "1/s" means number / unit → calc(number / 1s)
          w.add(`${numberStr} / 1${denominator}`);
        } else {
          // General case: "px/s" → calc(number * 1px / 1s)
          w.add(`${numberStr} * 1${numerator} / 1${denominator}`);
        }
      } else if (unit.includes('*')) {
        // Multiplication: "px*em" → calc(number * 1px * 1em)
        // Example: 10px * 2em → 20 with unit "px*em" → calc(20 * 1px * 1em)
        const parts = unit.split('*');
        const units = parts.map(u => `1${u}`).join(' * ');
        w.add(`${numberStr} * ${units}`);
      } else if (unit.includes('±')) {
        // Addition/subtraction: "px±em" → calc(1px ± 1em)
        // Note: We don't have the original values, so this is approximate
        // The actual operation would be calc(aVal * 1px ± bVal * 1em)
        const parts = unit.split('±');
        const unit1 = parts[0] || '';
        const unit2 = parts[1] || '';
        // Output as calc(1unit1 + 1unit2) - approximation since we don't have original values
        w.add(`1${unit1} + 1${unit2}`);
      } else {
        // Fallback - shouldn't happen
        w.add(`${numberStr} * 1${unit}`);
      }
      w.add(')');
    } else {
      // Normal unit output
      const numberStr = `${round(number, 8)}`.toLowerCase();
      w.add(numberStr, this);
      if (unit) {
        w.add(unit);
      }
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
  //     `  ${pre}value: ${this.data},\n` +
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
  location?: OptionalLocation,
  treeContext?: TreeContext
) => {
  if (isArray(value)) {
    let [number, unit] = value;
    return new Dimension({ number, unit }, options, location, treeContext);
  }
  return new Dimension(typeof value === 'number' ? { number: value } : value, options, location, treeContext);
};