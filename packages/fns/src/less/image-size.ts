import { defineFunction, Dimension, Node, Sequence } from '@jesscss/core';
import { readAsset } from '../util/file-resolution.js';
import { getImageDimensions } from '../util/image-dimensions.js';
import { serializeNodeValue } from '../util/serialize-node.js';

async function readSize(context: any, filePathNode: Node) {
  const rawPath = await serializeNodeValue(filePathNode, context);
  const { contents } = await readAsset(context, rawPath);
  return getImageDimensions(contents);
}

/**
 * Less `image-size()` — the intrinsic size of an image file as `width height`.
 * @param filePathNode path to the image
 * @returns a `Sequence` of two `px` `Dimension`s (width, height)
 */
const imageSize = defineFunction(
  'image-size',
  async function(this: any, filePathNode: Node) {
    const size = await readSize(this.context, filePathNode);
    return new Sequence([
      new Dimension({ number: size.width, unit: 'px' }),
      new Dimension({ number: size.height, unit: 'px' })
    ]);
  },
  {
    params: [{
      name: 'filePathNode',
      type: Node
    }]
  }
);

export default imageSize;
