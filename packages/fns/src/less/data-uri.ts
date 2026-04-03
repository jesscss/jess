import { defineFunction, Node, Quoted, Url } from '@jesscss/core';
import { serializeNodeValue } from '../util/serialize-node.js';
import { lookupMime, readAsset } from '../util/file-resolution.js';

function toFallbackUrl(node: Node, context: any): Url {
  const raw = serializeNodeValue(node, context);
  return new Url(new Quoted(raw, { quote: '"' }));
}

const dataUri = defineFunction(
  'data-uri',
  function(this: any, mimetypeNode: Node, filePathNode?: Node) {
    let mimeNode = filePathNode ? mimetypeNode : undefined;
    let pathNode = filePathNode ?? mimetypeNode;
    const rawPath = serializeNodeValue(pathNode, this.context);

    let fragment = '';
    let filePath = rawPath;
    const fragmentStart = rawPath.indexOf('#');
    if (fragmentStart !== -1) {
      fragment = rawPath.slice(fragmentStart);
      filePath = rawPath.slice(0, fragmentStart);
    }

    let mimeType = mimeNode ? serializeNodeValue(mimeNode, this.context) : undefined;
    let useBase64 = false;

    if (!mimeType) {
      const guessed = lookupMime(filePath);
      mimeType = guessed.type;
      useBase64 = !guessed.ascii;
      if (useBase64) {
        mimeType += ';base64';
      }
    } else {
      useBase64 = /;base64$/i.test(mimeType);
    }

    try {
      const { contents } = readAsset(this.context, filePath);
      const encoded = useBase64
        ? contents.toString('base64')
        : encodeURIComponent(contents.toString('utf8'));
      const uri = `data:${mimeType},${encoded}${fragment}`;
      return new Url(new Quoted(uri, { quote: '"' }));
    } catch {
      return toFallbackUrl(pathNode, this.context);
    }
  },
  {
    params: [{
      name: 'mimetype',
      type: Node
    }, {
      name: 'filePath',
      type: Node,
      optional: true
    }]
  }
);

export default dataUri;
