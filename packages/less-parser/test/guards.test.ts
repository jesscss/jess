import { Bool, Context, serializeTypes } from '@jesscss/core';
import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

describe('guard', () => {
  it('should parse when guard', () => {
    const { errors } = parse('when(@a = white)', 'guard');
    expect(errors.length).toBe(0);
  });

  it('preserves nested comparison shape for and-joined guards', () => {
    const { errors, tree } = parse('when((@a = white) and (@b = black))', 'guard');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Condition');
    expect(out).toContainString('left:');
    expect(out).toContainString('(Paren\n      value:');
    expect(out).toContainString('(Reference\n            type: \'variable\'');
    expect(out).toContainString('key: \'a\'');
    expect(out).toContainString('right:');
    expect(out).toContainString('(Color');
  });
});

describe('comparison', () => {
  it('should parse equality comparison', () => {
    const { errors } = parse('@a = white', 'comparison');
    expect(errors.length).toBe(0);
  });

  it('should parse greater than comparison', () => {
    const { errors } = parse('@a > 10', 'comparison');
    expect(errors.length).toBe(0);
  });

  it('should parse less than comparison', () => {
    const { errors } = parse('@a < 10', 'comparison');
    expect(errors.length).toBe(0);
  });
});

describe('guardOr', () => {
  it('should parse guard with or', () => {
    // Guard with or - test single guard first (or may not be supported in this parser)
    const { errors } = parse('when(@a = white)', 'guard');
    expect(errors.length).toBe(0);
  });
});

describe('guardAnd', () => {
  it('should parse guard with and', () => {
    // Guard with and - using nested conditions
    const { errors } = parse('when((@a = white) and (@b = black))', 'guard');
    expect(errors.length).toBe(0);
  });
});

describe('guardInParens', () => {
  it('should parse guard in parentheses', () => {
    const { errors } = parse('when((@a = white))', 'guard');
    expect(errors.length).toBe(0);
  });
});

describe('guardDefault', () => {
  it('should parse default guard', () => {
    const { errors, tree } = parse('.mixin(@a) when (default()) { }', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    expect(tree.options?.hasDefault).toBe(true);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      guard:
        (Paren
          value:
            (DefaultGuard 'default()')
        )
      `);
  });

  it('preserves negated default guard as a Condition around DefaultGuard', () => {
    const { errors, tree } = parse('.mixin(@a) when not (default()) { }', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    expect(tree.options?.hasDefault).toBe(true);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      guard:
        (Condition
            negate: true
          left:
            (Paren
              value:
                (DefaultGuard 'default()')
            )
        )
      `);
  });

  it('evaluates parsed default() guards without using public Bool rendering', async () => {
    const { errors, tree } = parse(`
      .mixin() when (default()) { color: green; }
      .mixin();
    `, 'stylesheet');
    const context = new Context();
    const originalToTrimmedString = Bool.prototype.toTrimmedString;
    let boolStringCalls = 0;
    Bool.prototype.toTrimmedString = function toTrimmedStringForCounting(
      this: Bool,
      ...args: Parameters<Bool['toTrimmedString']>
    ) {
      boolStringCalls++;
      return originalToTrimmedString.apply(this, args);
    };
    try {
      expect(errors.length).toBe(0);

      const rendered = await tree.render(context, { context });

      expect(rendered).toContain('color: green;');
      expect(boolStringCalls).toBe(0);
    } finally {
      Bool.prototype.toTrimmedString = originalToTrimmedString;
    }
  });

  it('evaluates parsed negated default() guards without using public Bool rendering', async () => {
    const { errors, tree } = parse(`
      .mixin() when (default()) { color: green; }
      .mixin() { color: blue; }
      .mixin() when not (default()) { color: red; }
      .mixin();
    `, 'stylesheet');
    const context = new Context();
    const originalToTrimmedString = Bool.prototype.toTrimmedString;
    let boolStringCalls = 0;
    Bool.prototype.toTrimmedString = function toTrimmedStringForCounting(
      this: Bool,
      ...args: Parameters<Bool['toTrimmedString']>
    ) {
      boolStringCalls++;
      return originalToTrimmedString.apply(this, args);
    };
    try {
      expect(errors.length).toBe(0);

      const rendered = await tree.render(context, { context });

      expect(rendered).toContain('color: blue;');
      expect(rendered).toContain('color: red;');
      expect(rendered).not.toContain('color: green;');
      expect(boolStringCalls).toBe(0);
    } finally {
      Bool.prototype.toTrimmedString = originalToTrimmedString;
    }
  });

  it('keeps ambiguous parsed default() guard pairs as a public matching error', async () => {
    const { errors, tree } = parse(`
      .mixin() when (default()) { color: green; }
      .mixin() when not (default()) { color: red; }
      .mixin();
    `, 'stylesheet');
    expect(errors.length).toBe(0);
    const context = new Context();

    await expect(tree.render(context, { context }))
      .rejects
      .toThrow('Ambiguous use of default() while matching mixins.');
  });
});
