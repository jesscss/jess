import { describe, it } from 'vitest';
import { dimension, num, op } from '..';
import { Context } from '../../context.js';

describe('Preserve Mode Output Examples', () => {
  const context = new Context();
  context.opts.unitMode = 'preserve';

  it('shows actual calc() output for various operations', async () => {
    // Adding incompatible units
    const addOp = op([dimension([10, 'px']), '+', dimension([2, 'rem'])]);
    const addResult = await addOp.eval(context);
    console.log('10px + 2rem =', addResult.toString());

    // Dividing a number by a unit
    const divOp = op([num(10), '/', dimension([2, 'px'])]);
    const divResult = await divOp.eval(context);
    console.log('10 / 2px =', divResult.toString());

    // Multiplying double units
    const multOp = op([dimension([10, 'px']), '*', dimension([2, 'px'])]);
    const multResult = await multOp.eval(context);
    console.log('10px * 2px =', multResult.toString());

    // Dividing incompatible units
    const divIncompatOp = op([dimension([10, 'px']), '/', dimension([2, 's'])]);
    const divIncompatResult = await divIncompatOp.eval(context);
    console.log('10px / 2s =', divIncompatResult.toString());

    // Multiplying incompatible units
    const multIncompatOp = op([dimension([10, 'px']), '*', dimension([2, 'em'])]);
    const multIncompatResult = await multIncompatOp.eval(context);
    console.log('10px * 2em =', multIncompatResult.toString());

    // Compatible units multiplication (same group, different units)
    const multCompatOp = op([dimension([10, 'px']), '*', dimension([2, 'cm'])]);
    const multCompatResult = await multCompatOp.eval(context);
    console.log('10px * 2cm =', multCompatResult.toString());

    // Compatible units division (same group, different units)
    const divCompatOp = op([dimension([10, 'px']), '/', dimension([2, 'cm'])]);
    const divCompatResult = await divCompatOp.eval(context);
    console.log('10px / 2cm =', divCompatResult.toString());

    // Same units division (should cancel)
    const sameDivOp = op([dimension([10, 'px']), '/', dimension([2, 'px'])]);
    const sameDivResult = await sameDivOp.eval(context);
    console.log('10px / 2px =', sameDivResult.toString(), '(units cancel)');
  });
});
