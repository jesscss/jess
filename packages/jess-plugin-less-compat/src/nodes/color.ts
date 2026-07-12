import { Color } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Color to a Less-compatible Color
 */
export function transformColorToLess(
  jessColor: Color,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessColor, cache, (prop, target) => {
    const color = target as Color;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(color.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'rgb' property
    if (prop === 'rgb') {
      return color.value.rgb || [0, 0, 0];
    }

    // Map 'alpha' property
    if (prop === 'alpha') {
      return color.value.alpha ?? 1;
    }

    // Map 'value' property (Less expects string representation)
    if (prop === 'value') {
      // Convert color to string representation
      // Less uses format like '#rrggbb' or 'rgba(r, g, b, a)'
      const rgb = color.value.rgb;
      const alpha = color.value.alpha;
      if (rgb && alpha !== undefined && alpha < 1) {
        return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
      }
      if (rgb) {
        // Convert to hex
        const hex = rgb.map((v) => {
          const h = Math.round(v).toString(16).padStart(2, '0');
          return h;
        }).join('');
        return `#${hex}`;
      }
      return '';
    }

    // Map 'accept' method for visitor traversal
    // Less's Visitor.visit() calls node.accept(this) to traverse children
    // Color nodes typically don't have children to traverse, so this is a no-op
    if (prop === 'accept') {
      return function(visitor: any) {
        // Color nodes don't have children to traverse
        // The visitor.visit() was already called by our plugin wrapper
      };
    }

    return undefined;
  });
}
