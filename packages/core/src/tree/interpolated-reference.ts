import { defineType, type LocationInfo } from './node.js';
import type { TreeContext } from '../context.js';
import { Reference } from './reference.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
export type InterpolatedReferenceOptions = {
  referenceType?: 'variable' | 'property';
};

type InterpolatedReferenceInput = string | { key: unknown };

const normalizeInterpolatedReferenceKey = (value: InterpolatedReferenceInput): string => {
  if (typeof value === 'string') {
    return value;
  }
  const key = value?.key;
  if (typeof key === 'string') {
    return key;
  }
  return String((key as { valueOf?: () => unknown } | undefined)?.valueOf?.() ?? key ?? '');
};

/**
 * A reference used specifically for interpolation key slots.
 * Serializes as `$[ident]`.
 */
export class InterpolatedReference extends Reference {
  override type = 'InterpolatedReference' as const;
  override shortType = 'iref' as const;

  constructor(value: InterpolatedReferenceInput, options?: InterpolatedReferenceOptions, location?: LocationInfo, treeContext?: TreeContext) {
    const referenceType = options?.referenceType ?? 'variable';
    super({ key: normalizeInterpolatedReferenceKey(value) }, { type: referenceType, role: 'ident' }, location, treeContext);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const key = this.value.key;
    w.add('$[');
    w.add(String(key), this);
    w.add(']');
    return w.getSince(mark);
  }
}

type Params = ConstructorParameters<typeof InterpolatedReference>;

export const iref = defineType(
  InterpolatedReference,
  'InterpolatedReference',
  'iref'
) as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => InterpolatedReference;
