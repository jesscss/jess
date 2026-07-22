import { makeDimension, defineFunction } from '@jesscss/core/value';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { readImageDimensions } from './image-helper.js';

/**
 * `image-size('file')` — the intrinsic size of an image file as `width height`
 * (a default-spaced group of two `px` `Dimension`s). Reads the format header via the
 * injected IO capability (Less 4.x `functions/image-size.js`).
 */
export const imageSize: Fn = defineFunction('image-size', {
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (list, ctx): MaybePromise<ValueGroup> => {
    const dimensions = readImageDimensions(list, ctx);
    const finish = ({ width, height }: { width: number; height: number }): ValueGroup =>
      [makeDimension(width, 'px'), makeDimension(height, 'px')];
    return isThenable(dimensions) ? dimensions.then(finish) : finish(dimensions);
  }
});
