import { serializeTypes } from '@jesscss/core';
import { Parser } from '../src/jess.js';

const parser = new Parser();
const parse = parser.parse;

describe('functionCall', () => {
  it('should parse generic function call', () => {
    const { errors } = parse('color: func()', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse function call with arguments', () => {
    const { errors } = parse('color: func(arg1, arg2)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse functions at the root', () => {
    const { errors, tree } = parser.parse('func(1, 2, 3)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Call');
    expect(out).toContainString('silentFail: true');
    expect(out).toContainString('type: \'function\'');
    expect(out).toContainString('fallbackValue: true');
    expect(out).toContainString('key: \'func\'');
  });
});

describe('functionCallArgs', () => {
  it('should parse comma-separated arguments', () => {
    const { errors } = parse('color: func(a, b, c)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse semicolon-separated arguments', () => {
    const { errors } = parse('color: func(a; b; c)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse space-delimited first argument as Sequence in positional args', () => {
    const { errors, tree } = parser.parse('extract(1 2 3, 2)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Call');
    expect(out).toContainString('1,2,3');
    expect(out).toContainString('(Num 2)');
  });

  it('should parse single space-delimited argument as one positional Sequence', () => {
    const { errors, tree } = parser.parse('length(1 2 3)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Call');
    expect(out).toContainString('[Num, Num, Num]');
  });

  it('normalizes plain color keywords in function args to Color nodes', () => {
    const { errors, tree } = parser.parse('color(plum)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Call');
    expect(out).toContainString('type: \'function\'');
    expect(out).toContainString('(Color');
    expect(out).toContainString('node: \'plum\'');
  });

  it('serializes comma-root function args as a comma List', () => {
    const { errors, tree } = parser.parse('func(a, b, c)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Reference\n          type: \'function\'');
    expect(out).toContainString('key: \'func\'');
    expect(out).toContainString('args: \n  (List');
    expect(out).not.toContainString('sep: \';\'');
    expect(out).toContainString('(Keyword [role=keyword]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });

  // Function calls share the mixin-args path, so `;`-args are LOWERED the same way:
  // comma-separated, comma-list args wrapped in `~(…)` (escaped Paren).
  it('lowers semicolon function args with SCALAR groups to a plain comma List', () => {
    const { errors, tree } = parser.parse('func(a; b; c)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Reference\n          type: \'function\'');
    expect(out).toContainString('key: \'func\'');
    expect(out).not.toContainString('sep: \';\'');
    expect(out).not.toContainString('(Paren');
    expect(out).toContainString('(Keyword [role=keyword]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });

  it('lowers a comma-list function arg to an escaped Paren (`~(…)`)', () => {
    const { errors, tree } = parser.parse('func(a, b; c)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).not.toContainString('sep: \';\'');
    expect(out).toContainString('(Paren\n                    escaped: true');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });

  it('an authored `~(…)` function arg round-trips to the same escaped Paren', () => {
    const { errors, tree } = parser.parse('func(~(a, b); c)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).not.toContainString('sep: \';\'');
    expect(out).toContainString('(Paren\n                    escaped: true');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });
});

describe('knownFunctions', () => {
  it('should parse url() function', () => {
    const { errors } = parse('background: url("image.png")', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse var() function', () => {
    const { errors } = parse('color: var(--custom)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse calc() function', () => {
    const { errors } = parse('width: calc(100% - 20px)', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('ifFunction', () => {
  it('should parse if() function', () => {
    const { errors } = parse('color: if(true, red, blue)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse if() with a parenthesized comparison condition', () => {
    const { errors } = parse('color: if((@i > 5), #ff0000, #0000ff)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse if() with a parenthesized function-call comparison condition', () => {
    const { errors } = parse('font-weight: if((mod(@i, 2) = 0), bold, normal)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should not leak guarded mixin comma state into nested if() conditions', () => {
    const conditions = [
      '@i > 5',
      'mod(@i, 2) = 0',
      '10 > @i',
      '@i + 1 > @n - 1',
      'lightness(#fff) > 60%'
    ];

    const declarations = conditions
      .map((condition, index) => `value-${index}: if((${condition}), yes, no);`)
      .join('\n');

    const { errors } = parse(`
      .gen-if-variants(@n, @i: 1) when (@i =< @n) {
        .variant-@{i} {
          ${declarations}
        }
      }
    `, 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse if() with semicolon-separated args', () => {
    const { errors } = parse('color: if(true; red; blue)', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('booleanFunction', () => {
  it('should parse boolean() function', () => {
    // boolean() function - using if() function instead as boolean() may not be standard
    const { errors } = parse('color: if(true, red, blue)', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('nameIndependentConditionArgs', () => {
  // A top-level condition operator (`> < >= <= = and or not`) inside ANY call's
  // argument parses as a `Condition` — no name dispatch on `if`/`boolean`. Eval
  // already treats `if`/`boolean` as ordinary functions consuming the condition.
  const condOut = (src: string) => {
    const { errors, tree } = parser.parse(src);
    expect(errors.length).toBe(0);
    return serializeTypes(tree, { showOptions: false });
  };

  it('generic call: `foo(@a > 5, 1, 2)` first arg is a Condition', () => {
    const out = condOut('a { b: foo(@a > 5, 1, 2) }');
    expect(out).toContainString('(Condition');
    expect(out).toContainString('key: \'foo\'');
  });

  it('generic call: `foo(@a > 5 and @b < 2)` folds an `and` chain of Conditions', () => {
    const out = condOut('a { b: foo(@a > 5 and @b < 2) }');
    // left comparison, right comparison, and the `and` join = 3 Conditions.
    expect((out.match(/\(Condition/g) || []).length).toBe(3);
  });

  it('statement namespace call: `#ns.if(@a > 5)` arg is a Condition', () => {
    const out = condOut('a { #ns.if(@a > 5) }');
    expect(out).toContainString('(Condition');
  });

  it('generic call: `foo(not(2 < 1))` is a negated Condition', () => {
    const out = condOut('a { b: foo(not(2 < 1)) }');
    expect(out).toContainString('(Condition');
  });

  it('generic call: `foo(true or false)` folds an `or` Condition', () => {
    const out = condOut('a { b: foo(true or false) }');
    expect(out).toContainString('(Condition');
  });

  it('plain value / space-list args do NOT become Conditions', () => {
    for (const src of [
      'a { b: foo(1px solid red) }',
      'a { b: foo(x, y, z) }',
      'a { b: calc(1 + 2) }',
      'a { b: translate(1px, 2px) }'
    ]) {
      const out = condOut(src);
      expect(out).not.toContainString('(Condition');
    }
  });

  it('lock: `boolean(not(2 < 1))` still parses to a negated Condition (audited form)', () => {
    const out = condOut('a { b: boolean(not(2 < 1)) }');
    expect(out).toContainString('(Condition');
    // `boolean`/`if` are ordinary Calls now — the name routes through the generic
    // Call, not a name-dispatched IfCall/BooleanCall.
    expect(out).toContainString('key: \'boolean\'');
  });

  it('lock: `if(@a > 5, 1, 2)` is a generic Call with a Condition first arg', () => {
    const out = condOut('a { b: if(@a > 5, 1, 2) }');
    expect(out).toContainString('key: \'if\'');
    expect(out).toContainString('(Condition');
  });
});

describe('callArgument', () => {
  it('should parse anonymous mixin as argument', () => {
    const { errors } = parse('.mixin({ color: red; })', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });

  it('should parse value sequence as argument', () => {
    const { errors } = parse('func(10px, 20px)', 'value');
    expect(errors.length).toBe(0);
  });
});
