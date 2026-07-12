import { Any, Node, Quoted } from '@jesscss/core';

export function serializeNodeValue(value: Node, context: any): string {
  if (value instanceof Quoted || value instanceof Any) {
    return value.valueOf();
  }
  return value.toTrimmedString({ context });
}
