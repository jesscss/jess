/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-unsafe-type-assertion */
import {
  Any,
  Color,
  ColorFormat,
  Dimension,
  List,
  Node,
  Quoted,
  Sequence
} from '@jesscss/core';

export type JsBridgeValue =
  | { __jessBridge: true; kind: 'scalar'; value: string | number | boolean }
  | { __jessBridge: true; kind: 'dimension'; value: number; unit?: string }
  | { __jessBridge: true; kind: 'color'; rgb: [number, number, number]; alpha?: number; format?: string }
  | { __jessBridge: true; kind: 'quoted'; value: string; quote?: '"' | '\''; escaped?: boolean }
  | { __jessBridge: true; kind: 'keyword'; value: string }
  | { __jessBridge: true; kind: 'anonymous'; value: string }
  | { __jessBridge: true; kind: 'list'; items: JsBridgeValue[]; separator?: ',' | ';' | '/' }
  | { __jessBridge: true; kind: 'sequence'; items: JsBridgeValue[] };

type BridgeRecord = Record<string, unknown> & { __jessBridge?: unknown; kind?: unknown };

const isBridgeValue = (value: unknown): value is JsBridgeValue =>
  typeof value === 'object'
  && value !== null
  && (value as BridgeRecord).__jessBridge === true
  && typeof (value as BridgeRecord).kind === 'string';

const colorFormatFromString = (value: string | undefined): ColorFormat | undefined => {
  if (!value) {
    return undefined;
  }
  if (value in ColorFormat) {
    return ColorFormat[value as keyof typeof ColorFormat];
  }
  if (Object.values(ColorFormat).includes(value as ColorFormat)) {
    return value as ColorFormat;
  }
  return undefined;
};

function encodeBridgeChildValue(value: unknown): JsBridgeValue {
  const encoded = encodeBridgeValue(value);
  if (isBridgeValue(encoded)) {
    return encoded;
  }
  return {
    __jessBridge: true,
    kind: 'scalar',
    value: typeof encoded === 'string' || typeof encoded === 'number' || typeof encoded === 'boolean'
      ? encoded
      : String(encoded)
  };
}

export function encodeBridgeValue(value: unknown): unknown {
  if (value instanceof Dimension) {
    return {
      __jessBridge: true,
      kind: 'dimension',
      value: value.number,
      unit: value.unit
    } satisfies JsBridgeValue;
  }
  if (value instanceof Color) {
    return {
      __jessBridge: true,
      kind: 'color',
      rgb: value.rgb,
      alpha: value.alpha,
      format: value.options.format === undefined ? undefined : ColorFormat[value.options.format]
    } satisfies JsBridgeValue;
  }
  if (value instanceof Quoted) {
    return {
      __jessBridge: true,
      kind: 'quoted',
      value: String(value.value),
      quote: value.quote,
      escaped: value.escaped
    } satisfies JsBridgeValue;
  }
  if (value instanceof Any) {
    return {
      __jessBridge: true,
      kind: value.role === 'keyword' ? 'keyword' : 'anonymous',
      value: value.value
    } satisfies JsBridgeValue;
  }
  if (value instanceof List) {
    return {
      __jessBridge: true,
      kind: 'list',
      items: value.value.map(encodeBridgeChildValue),
      separator: value.options.sep
    } satisfies JsBridgeValue;
  }
  if (value instanceof Sequence) {
    return {
      __jessBridge: true,
      kind: 'sequence',
      items: value.value.map(encodeBridgeChildValue)
    } satisfies JsBridgeValue;
  }
  return value;
}

export function decodeBridgeValue(value: unknown): unknown {
  if (!isBridgeValue(value)) {
    return value;
  }
  switch (value.kind) {
    case 'scalar':
      return new Any(String(value.value));
    case 'dimension':
      return new Dimension({ number: value.value, unit: value.unit });
    case 'color':
      return new Color(
        { rgb: value.rgb, alpha: value.alpha },
        { format: colorFormatFromString(value.format) }
      );
    case 'quoted':
      return new Quoted(value.value, {
        quote: value.quote,
        escaped: value.escaped
      });
    case 'keyword':
      return new Any(value.value, { role: 'keyword' });
    case 'anonymous':
      return new Any(value.value);
    case 'list':
      return new List(
        value.items.map(item => decodeBridgeValue(item) as Node),
        { sep: value.separator }
      );
    case 'sequence':
      return new Sequence(value.items.map(item => decodeBridgeValue(item) as Node));
  }
}

export function encodeBridgeArgs(args: unknown[]): unknown[] {
  return args.map(encodeBridgeValue);
}
