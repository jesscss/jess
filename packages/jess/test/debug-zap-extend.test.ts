import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { serializeTypes } from '@jesscss/core/tree/util/serialize-types';

describe('Debug .zap extend parsing', () => {
  it('should parse .zap:extend(.ext8 + .ext9 all) and show the target', async () => {
    const compiler = new Compiler({
      compile: {
        plugins: [lessPlugin()]
      }
    });
    
    const code = `.zap:extend(.ext8 + .ext9 all) {}`;
    const context = compiler.createContext();
    const { node } = await context.parseString(code, { type: 'less' });
    
    console.log('Tree:', serializeTypes(node));
    
    // Find the extend node manually
    function findExtends(n: any): any[] {
      const results: any[] = [];
      if (n.type === 'Extend') {
        results.push(n);
      }
      if (n.value) {
        if (Array.isArray(n.value)) {
          for (const child of n.value) {
            results.push(...findExtends(child));
          }
        } else if (n.value.rules?.value) {
          for (const child of n.value.rules.value) {
            results.push(...findExtends(child));
          }
        }
      }
      return results;
    }
    
    const extendNodes = findExtends(node);
    console.log('Extend nodes found:', extendNodes.length);
    
    for (const extend of extendNodes) {
      console.log('Extend node:', serializeTypes(extend));
      console.log('Extend target:', extend.value.target?.valueOf());
      console.log('Extend target type:', extend.value.target?.type);
      console.log('Extend target S-expr:', serializeTypes(extend.value.target));
      
      // Check if combinator is present
      if (extend.value.target) {
        const targetStr = extend.value.target.valueOf();
        console.log('Target string:', targetStr);
        console.log('Has + combinator:', targetStr.includes('+'));
        console.log('Has > combinator:', targetStr.includes('>'));
        console.log('Has space combinator:', targetStr.includes(' ') && !targetStr.includes('+') && !targetStr.includes('>'));
      }
    }
    
    expect(context.errors.length).toBe(0);
  });
});
