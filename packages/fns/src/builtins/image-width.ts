import { makeDimension } from '@jesscss/core/value';
import type { Fn, ValueObj } from '@jesscss/core/value';
import { readImageDimensions } from './image-helper.js';

/** `image-width('file')` — the intrinsic width of an image file as a `px` `Dimension`. */
export const imageWidth: Fn = {
  name: 'image-width',
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (list, ctx): ValueObj => makeDimension(readImageDimensions(list, ctx).width, 'px'),
};
