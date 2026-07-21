import { makeDimension, makeList } from '@jesscss/core/value';
import type { Fn, ValueObj } from '@jesscss/core/value';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { readImageDimensions } from './image-helper.js';

/**
 * `image-size('file')` — the intrinsic size of an image file as `width height`
 * (a space `List` of two `px` `Dimension`s). Reads the format header via the
 * injected IO capability (Less 4.x `functions/image-size.js`).
 */
export const imageSize: Fn = {
  name: 'image-size',
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (list, ctx): MaybePromise<ValueObj> => {
    const dimensions = readImageDimensions(list, ctx);
    const finish = ({ width, height }: { width: number; height: number }): ValueObj =>
      makeList([makeDimension(width, 'px'), makeDimension(height, 'px')], ' ');
    return isThenable(dimensions) ? dimensions.then(finish) : finish(dimensions);
  },
};
