import { Comment } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';

export const transformCommentToLess = createFromAdapter<Comment>({
  fields: {
    value: (c) => c.value,
    silent: () => false
  },
  accept: selfVisitAccept()
});
