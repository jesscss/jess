/* eslint-disable @typescript-eslint/naming-convention -- `__jessBridge` is the fixed cross-worker wire tag. */
import {
  coerceNamedColorKeyword,
  makeColorRgb,
  makeDimension,
  makeKeyword,
  makeList,
  makeQuoted,
  sniffLiteral,
  HEX,
  type PluginDetachedRuleset,
  type ValueGroup,
  type Value
} from '@jesscss/core';

export type JsBridgeDeclaration = { name: string; value: JsBridgeValue };

export type JsBridgeValue =
  | { __jessBridge: true; kind: 'scalar'; value: string | number | boolean }
  | { __jessBridge: true; kind: 'dimension'; value: number; unit?: string }
  | { __jessBridge: true; kind: 'color'; rgb: [number, number, number]; alpha?: number; bytes?: string }
  | { __jessBridge: true; kind: 'quoted'; value: string; quote?: '"' | '\''; escaped?: boolean }
  | { __jessBridge: true; kind: 'keyword'; value: string }
  | { __jessBridge: true; kind: 'anonymous'; value: string; raw?: true }
  | { __jessBridge: true; kind: 'list'; items: JsBridgeValue[]; separator: ',' | '/' | ';' }
  | { __jessBridge: true; kind: 'expression'; items: JsBridgeValue[] }
  | { __jessBridge: true; kind: 'mixin'; rules: JsBridgeDeclaration[] };

type BridgeRecord = Record<string, unknown>;
type LegacyNil = { readonly type: 'Nil'; readonly value: '' };
type LegacyMixin = {
  readonly type: 'Mixin';
  readonly name: LegacyNil;
  readonly args: LegacyNil;
  readonly ruleset: { readonly rules: readonly { readonly type: 'Declaration'; readonly name: string; readonly value: unknown; eval(): unknown }[] };
  eval(): LegacyMixin;
};

const isRecord = (value: unknown): value is BridgeRecord =>
  typeof value === 'object'
  && value !== null;

const isBridgeValue = (value: unknown): value is JsBridgeValue =>
  isRecord(value)
  && value.__jessBridge === true
  && typeof value.kind === 'string';

const isValueNode = (value: unknown): value is Value =>
  isRecord(value)
  && typeof value.type === 'string'
  && typeof value.bytes === 'string';

const isDetached = (value: unknown): value is PluginDetachedRuleset =>
  isRecord(value)
  && value.type === 'DetachedRuleset'
  && Array.isArray(value.rules);

function encodeBridgeChildValue(value: unknown): JsBridgeValue {
  const encoded = encodeBridgeValue(value);
  if (isBridgeValue(encoded)) {
    return encoded;
  }
  return { __jessBridge: true, kind: 'scalar', value: String(encoded) };
}

function encodeFacadeValue(value: BridgeRecord): JsBridgeValue | undefined {
  switch (value.type) {
    case 'Dimension':
      return typeof value.value === 'number'
        ? { __jessBridge: true, kind: 'dimension', value: value.value, unit: typeof value.unit === 'string' ? value.unit : undefined }
        : undefined;
    case 'Color':
      return Array.isArray(value.rgb) && value.rgb.length === 3
        ? {
            __jessBridge: true,
            kind: 'color',
            rgb: [value.rgb[0], value.rgb[1], value.rgb[2]],
            alpha: typeof value.alpha === 'number' ? value.alpha : undefined,
            bytes: typeof value.bytes === 'string' ? value.bytes : undefined
          }
        : undefined;
    case 'Quoted':
      return typeof value.value === 'string'
        ? { __jessBridge: true, kind: 'quoted', value: value.value, quote: value.quote === '\'' ? '\'' : '"', escaped: value.escaped === true }
        : undefined;
    case 'Anonymous':
    case 'Keyword':
      return typeof value.value === 'string'
        ? { __jessBridge: true, kind: value.type === 'Keyword' ? 'keyword' : 'anonymous', value: value.value }
        : undefined;
    case 'Expression':
      return Array.isArray(value.value)
        ? { __jessBridge: true, kind: 'expression', items: value.value.map(encodeBridgeChildValue) }
        : undefined;
    case 'Value':
      return Array.isArray(value.value)
        ? {
            __jessBridge: true,
            kind: 'list',
            items: value.value.map(encodeBridgeChildValue),
            separator: value.separator === '/' || value.separator === ';' ? value.separator : ','
          }
        : undefined;
    case 'Mixin': {
      const ruleset = value.ruleset;
      if (!isRecord(ruleset) || !Array.isArray(ruleset.rules)) {
        return undefined;
      }
      const rules: JsBridgeDeclaration[] = [];
      for (const rule of ruleset.rules) {
        if (!isRecord(rule)) {
          continue;
        }
        if (rule.type === 'Declaration' && typeof rule.name === 'string') {
          rules.push({ name: rule.name, value: encodeBridgeChildValue(rule.value) });
        }
      }
      return { __jessBridge: true, kind: 'mixin', rules };
    }
    default:
      return undefined;
  }
}

export function encodeBridgeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { __jessBridge: true, kind: 'expression', items: value.map(encodeBridgeChildValue) } satisfies JsBridgeValue;
  }
  if (isValueNode(value)) {
    // A named colour (`white`) is a Color to a Less 4.x plugin (`{ rgb: [r, g, b] }`).
    const node = coerceNamedColorKeyword(value);
    switch (node.type) {
      case 'Dimension': return { __jessBridge: true, kind: 'dimension', value: node.number, unit: node.unit } satisfies JsBridgeValue;
      case 'Color': return { __jessBridge: true, kind: 'color', rgb: [node.rgb[0], node.rgb[1], node.rgb[2]], alpha: node.alpha, bytes: node.bytes } satisfies JsBridgeValue;
      case 'Quoted': return { __jessBridge: true, kind: 'quoted', value: node.value, quote: node.quote === '\'' ? '\'' : '"', escaped: node.escaped } satisfies JsBridgeValue;
      case 'Keyword': return { __jessBridge: true, kind: 'keyword', value: node.bytes } satisfies JsBridgeValue;
      case 'List':
        return node.sep === ',' || node.sep === '/'
          ? { __jessBridge: true, kind: 'list', items: node.value.map(encodeBridgeChildValue), separator: node.sep } satisfies JsBridgeValue
          : { __jessBridge: true, kind: 'anonymous', value: node.bytes } satisfies JsBridgeValue;
      default:
        return { __jessBridge: true, kind: 'anonymous', value: node.bytes } satisfies JsBridgeValue;
    }
  }
  if (isDetached(value)) {
    return {
      __jessBridge: true,
      kind: 'mixin',
      rules: value.rules.map(rule => ({ name: rule.name, value: encodeBridgeChildValue(rule.value) }))
    } satisfies JsBridgeValue;
  }
  if (isRecord(value)) {
    return encodeFacadeValue(value) ?? value;
  }
  return value;
}

function decodeValue(value: JsBridgeValue): ValueGroup {
  switch (value.kind) {
    case 'scalar': return typeof value.value === 'number' ? makeDimension(value.value) : sniffLiteral(String(value.value));
    case 'dimension': return makeDimension(value.value, value.unit ?? '');

    /*
     * A colour that crosses the bridge unmodified (a looked-up `@white: #fff`
     * returned by `color-yiq`) keeps its spelling as `src`, so the short form
     * survives, exactly as less.js preserves a passed-through colour's spelling;
     * its channels stay the raw ones it crossed with (ledger V5), never a
     * re-parse of the 8-bit spelling. A colour the plugin BUILDS has no
     * spelling and serializes from its channels.
     */
    case 'color': return makeColorRgb(value.rgb, value.alpha ?? 1, HEX, value.bytes === undefined ? undefined : { src: value.bytes });
    case 'quoted': return makeQuoted(value.value, value.quote ?? '"', value.escaped === true);

    /*
     * A Less `Anonymous`/`Keyword` result is BYTES. Sniffing them back into a
     * typed literal is what lets `darken(theme-color(primary), 15%)` see a
     * colour instead of an opaque keyword — the same materialization the engine
     * performs on any other computed byte string.
     */
    case 'keyword':
    case 'anonymous': return sniffLiteral(value.value);
    case 'expression': return value.items.map(decodeValue);
    case 'list': return makeList(value.items.map(decodeValue), value.separator === ';' ? ',' : value.separator);
    case 'mixin': return makeKeyword('');
  }
}

function decodeMixin(value: Extract<JsBridgeValue, { kind: 'mixin' }>): LegacyMixin {
  const nil: LegacyNil = { type: 'Nil', value: '' };
  const rules = value.rules.map(rule => ({
    type: 'Declaration' as const,
    name: rule.name,
    value: decodeValue(rule.value),
    eval() {
      return this;
    }
  }));
  const mixin: LegacyMixin = {
    type: 'Mixin',
    name: nil,
    args: nil,
    ruleset: { rules },
    eval() {
      return mixin;
    }
  };
  return mixin;
}

/**
 * A legacy `@plugin` function's RESULT. A true `Anonymous` result (the worker
 * marks it `raw`) stays the Less facade shape so the one Less 4.x result
 * conversion (`fromNativeLessResult` in `@jesscss/plugin-less-compat`) makes it
 * raw text, as it does for an in-process plugin; everything else decodes as a
 * value.
 */
export function decodeBridgeResult(value: unknown): unknown {
  return isBridgeValue(value) && value.kind === 'anonymous' && value.raw === true
    ? { type: 'Anonymous', value: value.value }
    : decodeBridgeValue(value);
}

export function decodeBridgeValue(value: unknown): unknown {
  if (!isBridgeValue(value)) {
    return value;
  }
  return value.kind === 'mixin' ? decodeMixin(value) : decodeValue(value);
}

export function encodeBridgeArgs(args: readonly unknown[]): unknown[] {
  return args.map(encodeBridgeValue);
}
