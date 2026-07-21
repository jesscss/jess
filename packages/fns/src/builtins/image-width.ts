import { makeDimension } from '@jesscss/core/value';
import type { Fn, ValueObj } from '@jesscss/core/value';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { readImageDimensions } from './image-helper.js';

/** `image-width('file')` — the intrinsic width of an image file as a `px` `Dimension`. */
export const imageWidth: Fn = {
  name: 'image-width',
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (list, ctx): MaybePromise<ValueObj> => {
    const dimensions = readImageDimensions(list, ctx);
    const finish = ({ width }: { width: number }): ValueObj => makeDimension(width, 'px');
    return isThenable(dimensions) ? dimensions.then(finish) : finish(dimensions);
  },
};
