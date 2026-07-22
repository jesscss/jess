import { defineFunction, makeDimension } from '@jesscss/core/value';
import type { Fn, ValueObj } from '@jesscss/core/value';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { readImageDimensions } from './image-helper.js';

/**
 * Less `image-height()` — the intrinsic height of an image file, in pixels.
 * The evaluator retains the raw typed argument group and injects file IO.
 */
const imageHeight: Fn = defineFunction('image-height', {
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (value, ctx): MaybePromise<ValueObj> => {
    const dimensions = readImageDimensions(value, ctx);
    const finish = ({ height }: { height: number }): ValueObj => makeDimension(height, 'px');
    return isThenable(dimensions) ? dimensions.then(finish) : finish(dimensions);
  }
});

export { imageHeight };
export default imageHeight;
