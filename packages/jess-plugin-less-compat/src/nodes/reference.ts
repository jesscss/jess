import { Reference, sourceSpanOf } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';

export const transformReferenceToLess = createFromAdapter<Reference>({
  lessType: (ref) => {
    const refType = ref.options?.type || 'variable';
    if (refType === 'property') {
      return 'Property';
    }
    if (refType === 'function' || refType === 'mixin') {
      return 'VariableCall';
    }
    return 'Variable';
  },
  fields: {
    name: (ref) => {
      const refType = ref.options?.type || 'variable';
      const lessType = refType === 'property'
        ? 'Property'
        : (refType === 'function' || refType === 'mixin')
            ? 'VariableCall'
            : 'Variable';
      const key = ref.key;
      if (typeof key === 'string') {
        if (lessType === 'Variable' && !key.startsWith('@')) {
          return `@${key}`;
        }
        return key;
      }
      return String(key);
    },
    value: (ref) => {
      const refType = ref.options?.type || 'variable';
      if (refType === 'function' || refType === 'mixin') {
        return ref;
      }
      return undefined;
    },
    index: ref => sourceSpanOf(ref)?.start,
    currentFileInfo: () => ({})
  }
});
