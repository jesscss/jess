import { Comment } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Comment to a Less-compatible Comment
 */
export function transformCommentToLess(
  jessComment: Comment,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessComment, cache, (prop, target) => {
    const comment = target as Comment;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(comment.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'value' property
    if (prop === 'value') {
      return comment.value;
    }

    // Map 'silent' property (Less uses this for /* */ vs // comments)
    if (prop === 'silent') {
      // Jess doesn't distinguish, default to false (block comment)
      return false;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessComment = transformCommentToLess(comment, cache);
        const result = visitor.visit(lessComment);
        if (result !== lessComment) {
          return fromLessNode(result, { cache });
        }
        return comment;
      };
    }

    return undefined;
  });
}
