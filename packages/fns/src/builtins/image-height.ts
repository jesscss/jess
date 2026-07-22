import { makeDimension, defineFunction } from '@jesscss/core/value';
import type { Fn, ValueObj } from '@jesscss/core/value';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { readImageDimensions } from './image-helper.js';

/** `image-height('file')` — the intrinsic height of an image file as a `px` `Dimension`. */
export const imageHeight: Fn = defineFunction('image-height', {
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (list, ctx): MaybePromise<ValueObj> => {
    const dimensions = readImageDimensions(list, ctx);
    const finish = ({ height }: { height: number }): ValueObj => makeDimension(height, 'px');
    return isThenable(dimensions) ? dimensions.then(finish) : finish(dimensions);
  }
});
