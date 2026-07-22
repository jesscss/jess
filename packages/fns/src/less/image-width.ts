import { defineFunction, makeDimension } from '@jesscss/core/value';
import type { Fn, ValueObj } from '@jesscss/core/value';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { readImageDimensions } from './image-helper.js';

/**
 * Less `image-width()` — the intrinsic width of an image file, in pixels.
 * The evaluator retains the raw typed argument group and injects file IO.
 */
const imageWidth: Fn = defineFunction('image-width', {
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (value, ctx): MaybePromise<ValueObj> => {
    const dimensions = readImageDimensions(value, ctx);
    const finish = ({ width }: { width: number }): ValueObj => makeDimension(width, 'px');
    return isThenable(dimensions) ? dimensions.then(finish) : finish(dimensions);
  }
});

export { imageWidth };
export default imageWidth;
