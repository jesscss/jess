import { dimension, num } from './src/tree/index.js';
import { Context } from './src/context.js';
const context = new Context();
context.opts.unitMode = 'preserve';
console.log('=== Preserve Mode Output Examples ===\n');
// Adding incompatible units
const addResult = dimension([10, 'px']).operate(dimension([2, 'rem']), '+', context);
console.log('10px + 2rem =', addResult.toString());
// Dividing a number by a unit
const divResult = num(10).operate(dimension([2, 'px']), '/', context);
console.log('10 / 2px =', divResult.toString());
// Multiplying double units
const multResult = dimension([10, 'px']).operate(dimension([2, 'px']), '*', context);
console.log('10px * 2px =', multResult.toString());
// Dividing incompatible units
const divIncompatResult = dimension([10, 'px']).operate(dimension([2, 's']), '/', context);
console.log('10px / 2s =', divIncompatResult.toString());
// Multiplying incompatible units
const multIncompatResult = dimension([10, 'px']).operate(dimension([2, 'em']), '*', context);
console.log('10px * 2em =', multIncompatResult.toString());
// Compatible units multiplication (same group, different units)
const multCompatResult = dimension([10, 'px']).operate(dimension([2, 'cm']), '*', context);
console.log('10px * 2cm =', multCompatResult.toString());
// Compatible units division (same group, different units)
const divCompatResult = dimension([10, 'px']).operate(dimension([2, 'cm']), '/', context);
console.log('10px / 2cm =', divCompatResult.toString());
// Same units division (should cancel)
const sameDivResult = dimension([10, 'px']).operate(dimension([2, 'px']), '/', context);
console.log('10px / 2px =', sameDivResult.toString(), '(units cancel)');
