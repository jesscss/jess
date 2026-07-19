import { makeDimension } from '@jesscss/core/value';
import type { Fn, ValueObj } from '@jesscss/core/value';
import { readImageDimensions } from './image-helper.js';

/** `image-height('file')` — the intrinsic height of an image file as a `px` `Dimension`. */
export const imageHeight: Fn = {
  name: 'image-height',
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (list, ctx): ValueObj => makeDimension(readImageDimensions(list, ctx).height, 'px'),
};
