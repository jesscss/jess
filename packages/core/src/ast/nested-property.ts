import { isValueSlotArray } from './css-grammar-helpers.js';
import { decl, interpolation } from './nodes.js';
import type { Declaration, Interpolation, NestedPropertyBlock, ValueSlot } from './nodes.js';

/** A declaration value that is an SCSS nested-property block. */
export function isNestedPropertyValue(value: ValueSlot): value is NestedPropertyBlock {
  return !isValueSlotArray(value) && value.type === 'NestedPropertyBlock';
}

/** Append literal text to an interpolation part list, coalescing adjacent literals. */
function appendInterpLiteral(parts: Interpolation['parts'], text: string): void {
  const previous = parts[parts.length - 1];
  if (previous !== undefined && 'lit' in previous) {
    parts[parts.length - 1] = { lit: previous.lit + text };
  } else {
    parts.push({ lit: text });
  }
}

/** Join an SCSS nested-property outer name and a leaf name with a literal `-`,
 * preserving interpolation structure when either side is an {@link Interpolation}. */
function joinNestedPropertyName(prefix: string | Interpolation, leaf: string | Interpolation): string | Interpolation {
  if (typeof prefix === 'string' && typeof leaf === 'string') {
    return `${prefix}-${leaf}`;
  }
  const parts: Interpolation['parts'] = [];
  const appendName = (name: string | Interpolation): void => {
    if (typeof name === 'string') {
      appendInterpLiteral(parts, name);
    } else {
      for (const part of name.parts) {
        if ('lit' in part) {
          appendInterpLiteral(parts, part.lit);
        } else {
          parts.push(part);
        }
      }
    }
  };
  appendName(prefix);
  appendInterpLiteral(parts, '-');
  appendName(leaf);
  return interpolation(parts);
}

/** [nested-property] Append one carrier level's declarations to `out`, recursing
 * through an entry that is itself a `{ … }` block (`font: { family: { weight: bold } }`). */
export function collectNestedProperty(
  name: string | Interpolation,
  block: NestedPropertyBlock,
  merge: Declaration['merge'],
  important: boolean,
  out: Declaration[]
): void {
  if (block.base !== null) {
    out.push(decl(name, block.base, merge, important));
  }
  for (const entry of block.entries) {
    const key = entry.key;
    const leaf = isValueSlotArray(key)
      ? null
      : key.type === 'Keyword' || key.type === 'Color' || key.type === 'Dimension' || key.type === 'Any'
        ? key.src
        : key.type === 'Quoted' ? key.interp ?? key.value : key.type === 'Interpolation' ? key : null;
    if (leaf === null) {
      continue;
    }
    const joined = joinNestedPropertyName(name, leaf);
    if (isNestedPropertyValue(entry.value)) {
      collectNestedProperty(joined, entry.value, entry.merge, entry.important, out);
    } else {
      out.push(decl(joined, entry.value, entry.merge, entry.important));
    }
  }
}
