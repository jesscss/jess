import { defineFunction, makeDimension } from '@jesscss/core';
import type { Fn, Value } from '@jesscss/core';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { readImageDimensions } from './image-helper.js';

/**
 * Less `image-height()` — the intrinsic height of an image file, in pixels.
 * The evaluator retains the raw typed argument group and injects file IO.
 */
const imageHeight: Fn = defineFunction('image-height', {
  params: [{ type: 'any' }],
  variadic: true,
  body: (value, ctx): MaybePromise<Value> => {
    const dimensions = readImageDimensions(value, ctx);
    const finish = ({ height }: { height: number }): Value => makeDimension(height, 'px');
    return isThenable(dimensions) ? dimensions.then(finish) : finish(dimensions);
  }
});

export { imageHeight };
export default imageHeight;
