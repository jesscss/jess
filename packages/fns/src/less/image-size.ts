import { defineFunction, Dimension, Node, Sequence } from '@jesscss/core';
import { readAsset } from '../util/file-resolution.js';
import { getImageDimensions } from '../util/image-dimensions.js';
import { serializeNodeValue } from '../util/serialize-node.js';

async function readSize(context: any, filePathNode: Node) {
  const rawPath = await serializeNodeValue(filePathNode, context);
  const { contents } = readAsset(context, rawPath);
  return getImageDimensions(contents);
}

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
