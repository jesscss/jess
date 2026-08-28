import { defineFunction, makeDimension } from '@jesscss/core';
import type { Fn, Value } from '@jesscss/core';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { readImageDimensions } from './image-helper.js';

/**
 * Less `image-width()` — the intrinsic width of an image file, in pixels.
 * The evaluator retains the raw typed argument group and injects file IO.
 */
const imageWidth: Fn = defineFunction('image-width', {
  params: [{ type: 'any' }],
  variadic: true,
  body: (value, ctx): MaybePromise<Value> => {
    const dimensions = readImageDimensions(value, ctx);
    const finish = ({ width }: { width: number }): Value => makeDimension(width, 'px');
    return isThenable(dimensions) ? dimensions.then(finish) : finish(dimensions);
  }
});

export { imageWidth };
export default imageWidth;
