import { defineFunction, Dimension, Node } from '@jesscss/core';
import { readAsset } from '../util/file-resolution.js';
import { getImageDimensions } from '../util/image-dimensions.js';
import { serializeNodeValue } from '../util/serialize-node.js';

/**
 * Less `image-width()` — the intrinsic width of an image file, in pixels.
 * @param filePathNode path to the image
 * @returns the width as a `px` `Dimension`
 */
const imageWidth = defineFunction(
  'image-width',
  async function(this: any, filePathNode: Node) {
    const rawPath = await serializeNodeValue(filePathNode, this.context);
    const { contents } = await readAsset(this.context, rawPath);
    const size = getImageDimensions(contents);
    return new Dimension({ number: size.width, unit: 'px' });
  },
  {
    params: [{
      name: 'filePathNode',
      type: Node
    }]
  }
);

export default imageWidth;
