import { Any, type Context, Node, Quoted } from '@jesscss/core';

export function serializeNodeValue(value: Node, context?: Context): string {
  if (value instanceof Quoted || value instanceof Any) {
    return value.valueOf();
  }
  return context ? value.render(context) : value.toTrimmedString();
}
