import { groupItems } from '@jesscss/core/value';
import type { FnCtx, ValueGroup } from '@jesscss/core/value';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { getImageDimensions } from '../util/image-dimensions.js';

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Read an image file's intrinsic pixel dimensions from its header (shared by
 * `image-size`/`image-width`/`image-height`). Resolves the first arg to a path via
 * the serialize hook (dropping any `#fragment`), reads the bytes through the
 * injected IO capability, and parses the format header (`../util/image-dimensions`).
 * Throws when IO is absent, the file is unreadable, or the format is unsupported —
 * the evaluator catches that and emits the call verbatim (graceful, never a crash).
 */
export function readImageDimensions(value: ValueGroup, ctx: FnCtx): MaybePromise<ImageSize> {
  const filePath = ctx.stringify(groupItems(value)[0]!).split('#')[0]!;
  const bytes = ctx.io?.readFile(filePath);
  const finish = (value: Uint8Array | null): ImageSize => {
    if (!value) {
      throw new Error(`image file not found: ${filePath}`);
    }
    return getImageDimensions(Buffer.from(value));
  };
  return bytes && isThenable(bytes) ? bytes.then(finish) : finish(bytes ?? null);
}
