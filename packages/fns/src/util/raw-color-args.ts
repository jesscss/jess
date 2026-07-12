import { Dimension } from '@jesscss/core';

export function collectRawDimensions(node: unknown, out: Dimension[]): void {
  if (!node) {
    return;
  }
  if (node instanceof Dimension) {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(child => collectRawDimensions(child, out));
    return;
  }
  if (typeof node !== 'object') {
    return;
  }

  const fields = node as {
    value?: unknown;
    left?: unknown;
    right?: unknown;
  };

  if (Array.isArray(fields.value)) {
    fields.value.forEach(child => collectRawDimensions(child, out));
  }
  if (fields.left !== undefined) {
    collectRawDimensions(fields.left, out);
  }
  if (fields.right !== undefined) {
    collectRawDimensions(fields.right, out);
  }
}
