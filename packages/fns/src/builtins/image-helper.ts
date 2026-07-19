import type { FnCtx, List } from '@jesscss/core/value';
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
export function readImageDimensions(list: List, ctx: FnCtx): ImageSize {
  const filePath = ctx.stringify(list.items[0]!).split('#')[0]!;
  const bytes = ctx.io?.readFile(filePath);
  if (!bytes) throw new Error(`image file not found: ${filePath}`);
  return getImageDimensions(Buffer.from(bytes));
}
