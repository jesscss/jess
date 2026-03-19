import { test } from 'vitest';
import { CssParser } from '../src/index.js';
test('nesting', () => {
  const p = new CssParser();
  try {
    const r = p.parse('.foo { .bar { color: red; } }');
  } catch(e: any) {
    console.log(e.stack?.split('\n').slice(0,15).join('\n'));
  }
});
