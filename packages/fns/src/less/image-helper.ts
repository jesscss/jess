import { groupItems } from '@jesscss/core/value';
import type { FnCtx, ValueGroup } from '@jesscss/core/value';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { getImageDimensions } from '../util/image-dimensions.js';

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Read one image header through the typed function IO capability. Path
 * resolution stays in Context; this function only turns the already-authored
 * first argument into a specifier and parses returned bytes.
 */
export function readImageDimensions(value: ValueGroup, ctx: FnCtx): MaybePromise<ImageSize> {
  const filePath = ctx.stringify(groupItems(value)[0]!).split('#')[0]!;
  const bytes = ctx.io?.readFile(filePath);
  const finish = (contents: Uint8Array | null): ImageSize => {
    if (!contents) {
      throw new Error(`image file not found: ${filePath}`);
    }
    return getImageDimensions(Buffer.from(contents));
  };
  return bytes && isThenable(bytes) ? bytes.then(finish) : finish(bytes ?? null);
}
