import { makeDimension, makeList } from '@jesscss/core/value';
import type { Fn, ValueObj } from '@jesscss/core/value';
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
  body: (list, ctx): ValueObj => {
    const { width, height } = readImageDimensions(list, ctx);
    return makeList([makeDimension(width, 'px'), makeDimension(height, 'px')], ' ');
  },
};
