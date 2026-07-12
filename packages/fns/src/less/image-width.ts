import { defineFunction, Dimension, Node } from '@jesscss/core';
import { readAsset } from '../util/file-resolution.js';
import { getImageDimensions } from '../util/image-dimensions.js';
import { serializeNodeValue } from '../util/serialize-node.js';

const imageWidth = defineFunction(
  'image-width',
  function(this: any, filePathNode: Node) {
    const rawPath = serializeNodeValue(filePathNode, this.context);
    const { contents } = readAsset(this.context, rawPath);
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
