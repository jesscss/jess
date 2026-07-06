import type { Context } from '../../context.js';
import { Node } from '../node.js';
import { keyword } from '../any.js';
import { spaced } from '../sequence.js';
import { sourceSpanOf, setSourceSpan } from './provenance.js';
import { Dimension } from '../dimension.js';
import { Color } from '../color.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

/** `1px`, `.5em`, `-3`, `10%` — a numeric value with an optional unit. */
const NUMERIC_TERMINAL_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;

/**
 * Coerce a bare value-terminal string to its canonical node. Numeric/unit and
 * `#hex` strings become operable value nodes (Dimension/Color); everything else
 * is a `Keyword`. Keeps `1px * 5`-style math working when a value segment
 * arrives as a raw string terminal.
 */
function coerceStringTerminal(value: string): Node {
  if (value.startsWith('#')) {
    return new Color(value);
  }
  const match = NUMERIC_TERMINAL_RE.exec(value);
  if (match) {
    return new Dimension({ number: parseFloat(match[1]!), unit: match[2] });
  }
  return keyword(value);
}

/**
 * A parser value segment. Space-separated groups arrive as raw arrays and bare
 * value terminals as strings; both are structurally already-evaluated. Coerce
 * to the canonical node form (space `Sequence` / `Keyword`) matching
 * `Declaration.valueNode`, so the node-array evaluators stay node-only.
 */
export type NodeArrayItem = Node | string | NodeArrayItem[];

/**
 * Normalize a single parser value segment to its canonical node form: a bare
 * string terminal becomes a `Keyword`, a raw space-group array becomes a space
 * `Sequence`, and an existing `Node` passes through. Mirrors
 * `Declaration.valueNode`'s coalescing so downstream node-only machinery
 * (List/Paren/Operation eval) never sees a raw string or array.
 */
export function coerceValueNode(item: NodeArrayItem): Node {
  if (item instanceof Node) {
    return item;
  }
  if (typeof item === 'string') {
    return coerceStringTerminal(item);
  }
  // Drop empty-string spacing placeholders emitted by the parser.
  const items = item.filter(v => v !== '');
  if (items.length === 1) {
    return coerceValueNode(items[0]!);
  }
  const seq = spaced(items.map(coerceValueNode));
  // A raw space-group array may carry the segment span stamped by the parser's
  // value assembly; move it to the coerced Sequence so trivia lookup (which is
  // keyed by node span) can recover the authored comma-item whitespace.
  const span = sourceSpanOf(item as unknown as object);
  if (span && sourceSpanOf(seq) === undefined) {
    setSourceSpan(seq, span);
  }
  return seq;
}

/**
 * Normalize a parser value array into a plain `Node[]`, coercing space-group
 * arrays and bare string terminals to their canonical node form. Returns the
 * input untouched when every item is already a `Node` (the common case).
 */
export function coerceNodeArray(value: NodeArrayItem[]): Node[] {
  let out: Node[] | undefined;
  for (let i = 0; i < value.length; i++) {
    const item = value[i]!;
    // Only the parser's raw value shapes — string terminals and space-group
    // arrays — need coercion. A Node passes through; anything else is already a
    // resolved value (List is also used as a generic argument container) and
    // must not be run through value coercion.
    if (typeof item !== 'string' && !Array.isArray(item)) {
      if (out) {
        out[i] = item as Node;
      }
      continue;
    }
    if (!out) {
      out = value.slice(0, i) as Node[];
    }
    out[i] = coerceValueNode(item);
  }
  return out ?? (value as Node[]);
}

export function evaluateNodeArrayMaybe(
  context: Context,
  rawValue: NodeArrayItem[]
): MaybePromise<Node[]> {
  const value = coerceNodeArray(rawValue);
  let values: Node[] | undefined = value !== (rawValue as Node[]) ? value : undefined;
  for (let index = 0; index < value.length; index++) {
    const node = value[index]!;
    const out = node.eval(context);
    if (isThenable(out)) {
      return evaluateNodeArrayRest(context, value, values, index, out as Promise<Node>);
    }
    const evaluated = out as Node;
    if (values) {
      values[index] = evaluated;
    } else if (evaluated !== node) {
      values = new Array<Node>(value.length);
      for (let copyIndex = 0; copyIndex < index; copyIndex++) {
        values[copyIndex] = value[copyIndex]!;
      }
      values[index] = evaluated;
    }
  }
  return values ?? value;
}

async function evaluateNodeArrayRest(
  context: Context,
  value: Node[],
  values: Node[] | undefined,
  pendingIndex: number,
  pending: Promise<Node>
): Promise<Node[]> {
  const pendingValue = await pending;
  if (values) {
    values[pendingIndex] = pendingValue;
  } else if (pendingValue !== value[pendingIndex]) {
    values = new Array<Node>(value.length);
    for (let copyIndex = 0; copyIndex < pendingIndex; copyIndex++) {
      values[copyIndex] = value[copyIndex]!;
    }
    values[pendingIndex] = pendingValue;
  }
  for (let index = pendingIndex + 1; index < value.length; index++) {
    const node = value[index]!;
    const out = node.eval(context);
    const evaluated = isThenable(out) ? await out : out as Node;
    if (values) {
      values[index] = evaluated;
    } else if (evaluated !== node) {
      values = new Array<Node>(value.length);
      for (let copyIndex = 0; copyIndex < index; copyIndex++) {
        values[copyIndex] = value[copyIndex]!;
      }
      values[index] = evaluated;
    }
  }
  return values ?? value;
}
