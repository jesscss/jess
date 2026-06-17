import { Any, type Context, Node, Quoted } from '@jesscss/core';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

export function serializeNodeValue(value: Node, context?: Context): MaybePromise<string> {
  if (value instanceof Quoted || value instanceof Any) {
    return value.valueOf();
  }
  return context ? value.render(context) : value.toTrimmedString();
}
