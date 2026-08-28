import { defineFunction, makeDimension } from '@jesscss/core';
import type { Fn, ValueGroup } from '@jesscss/core';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { readImageDimensions } from './image-helper.js';

/**
 * Less `image-size()` — the intrinsic size of an image file as `width height`.
 * Receives the raw typed argument group and injected file-read capability from
 * the canonical evaluator; it never evaluates or resolves a tree node itself.
 */
const imageSize: Fn = defineFunction('image-size', {
  params: [{ type: 'any' }],
  variadic: true,
  body: (value, ctx): MaybePromise<ValueGroup> => {
    const dimensions = readImageDimensions(value, ctx);
    const finish = ({ width, height }: { width: number; height: number }): ValueGroup => [
      makeDimension(width, 'px'),
      makeDimension(height, 'px')
    ];
    return isThenable(dimensions) ? dimensions.then(finish) : finish(dimensions);
  }
});

export { imageSize };
export default imageSize;
