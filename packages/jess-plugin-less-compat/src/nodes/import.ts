import { StyleImport, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformImportToLess = createFromAdapter<StyleImport>({
  fields: {
    path: (imp, cache) => {
      const path = imp.path;
      return path instanceof Node ? toLessNode(path, { cache }) : path;
    },
    options: imp => imp.options?.importOptions || {},
    currentFileInfo: (imp) => {
      const loc = imp.location;
      return loc.length ? loc : {};
    },
    index: (imp) => {
      const loc = imp.location;
      return loc.length ? loc[0] : undefined;
    }
  },
  accept: selfVisitAccept()
});
