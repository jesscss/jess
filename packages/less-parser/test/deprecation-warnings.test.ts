import { Parser } from '../src/index.js';

const parser = new Parser();

describe('Deprecation warnings', () => {
  describe('mixin-call-no-parens', () => {
    it('should warn when calling a mixin without parentheses', () => {
      const { warnings } = parser.parse('.mixin;');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain('Calling a mixin without parentheses is deprecated');
      expect(warnings[0]?.deprecation).toBe('mixin-call-no-parens');
    });

    it('should not warn when calling a mixin with parentheses', () => {
      const { warnings } = parser.parse('.mixin();');
      expect(warnings).toHaveLength(0);
    });

    it('should not warn for mixin definitions', () => {
      const { warnings } = parser.parse('.mixin { color: red; }');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('digit-leading-variable', () => {
    it('parses a digit-leading variable name but warns it is deprecated', () => {
      const { errors, warnings } = parser.parse('.a { @3: red; color: @3; }');
      expect(errors).toHaveLength(0);   // still valid (Less.js accepts [\w-]+)
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain('starts with a digit');
      expect(warnings[0]?.deprecation).toBe('digit-leading-variable');
    });

    it('does not warn for a normal variable name', () => {
      const { warnings } = parser.parse('.a { @ok: red; color: @ok; }');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('mixin-call-whitespace', () => {
    it('should warn when there is whitespace between mixin name and parentheses', () => {
      const { warnings } = parser.parse('.mixin ();');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain('Whitespace between a mixin name and parentheses');
      expect(warnings[0]?.deprecation).toBe('mixin-call-whitespace');
    });

    it('should not warn when there is no whitespace', () => {
      const { warnings } = parser.parse('.mixin();');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('dot-slash-operator', () => {
    it('should warn when using ./ operator', () => {
      const { warnings } = parser.parse('a { value: 10 ./ 2; }');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain('./ operator is deprecated');
      expect(warnings[0]?.deprecation).toBe('dot-slash-operator');
    });

    it('should not warn for regular division', () => {
      const { warnings } = parser.parse('a { value: 10 / 2; }');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('variable-in-unknown-value', () => {
    it('should warn for un-interpolated @ident in custom property values', () => {
      const { warnings } = parser.parse('.foo { --custom: @var; }');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain('"@var" in custom property values is treated as literal text');
      expect(warnings[0]?.message).toContain('@{var}');
      expect(warnings[0]?.deprecation).toBe('variable-in-unknown-value');
    });

    it('should warn for un-interpolated @ident in Value tokens in custom properties', () => {
      const { warnings } = parser.parse('.foo { --custom: some @var text; }');
      expect(warnings.length).toBeGreaterThan(0);
      const varWarning = warnings.find(w => w.deprecation === 'variable-in-unknown-value');
      expect(varWarning).toBeDefined();
      expect(varWarning?.message).toContain('"@var" in custom property values');
    });

    it('should not warn for interpolated @{ident} in custom property values', () => {
      const { warnings } = parser.parse('.foo { --custom: @{var}; }');
      const varWarning = warnings.find(w => w.deprecation === 'variable-in-unknown-value');
      expect(varWarning).toBeUndefined();
    });

    it('should not warn for @ident in regular declarations', () => {
      const { warnings } = parser.parse('.foo { color: @var; }');
      const varWarning = warnings.find(w => w.deprecation === 'variable-in-unknown-value');
      expect(varWarning).toBeUndefined();
    });
  });

  describe('property-in-unknown-value', () => {
    it('should warn for un-interpolated $ident in custom property values', () => {
      const { warnings } = parser.parse('.foo { --custom: $prop; }');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain('"$prop" in custom property values is treated as literal text');
      expect(warnings[0]?.message).toContain('${prop}');
      expect(warnings[0]?.deprecation).toBe('property-in-unknown-value');
    });

    it('should warn for un-interpolated $ident in Value tokens in custom properties', () => {
      const { warnings } = parser.parse('.foo { --custom: some $prop text; }');
      expect(warnings.length).toBeGreaterThan(0);
      const propWarning = warnings.find(w => w.deprecation === 'property-in-unknown-value');
      expect(propWarning).toBeDefined();
      expect(propWarning?.message).toContain('"$prop" in custom property values');
    });

    it('should not warn for interpolated ${ident} in custom property values', () => {
      const { warnings } = parser.parse('.foo { --custom: ${prop}; }');
      const propWarning = warnings.find(w => w.deprecation === 'property-in-unknown-value');
      expect(propWarning).toBeUndefined();
    });

    it('should not warn for $ident in regular declarations', () => {
      const { warnings } = parser.parse('.foo { color: $prop; }');
      const propWarning = warnings.find(w => w.deprecation === 'property-in-unknown-value');
      expect(propWarning).toBeUndefined();
    });
  });

  describe('multiple warnings', () => {
    it('should collect multiple different deprecation warnings', () => {
      const { warnings } = parser.parse(`
        .mixin;
        .other ();
        .foo { --custom: @var $prop; }
      `);
      expect(warnings.length).toBeGreaterThanOrEqual(3);
      expect(warnings.some(w => w.deprecation === 'mixin-call-no-parens')).toBe(true);
      expect(warnings.some(w => w.deprecation === 'mixin-call-whitespace')).toBe(true);
      expect(warnings.some(w => w.deprecation === 'variable-in-unknown-value')).toBe(true);
      expect(warnings.some(w => w.deprecation === 'property-in-unknown-value')).toBe(true);
    });
  });

  describe('at-rule-prelude-variable', () => {
    it('should warn for bare @ident in at-rule preludes', () => {
      const { warnings } = parser.parse('@media @mode { .foo { color: red; } }');
      const warning = warnings.find(w => w.deprecation === 'at-rule-prelude-variable');

      expect(warning).toBeDefined();
      expect(warning?.message).toContain('"@mode" in at-rule preludes is deprecated');
      expect(warning?.message).toContain('@{mode}');
    });

    it('should warn for bare @ident inside media feature values', () => {
      const { warnings } = parser.parse('@media (min-width: @size) { .foo { color: red; } }');
      const warning = warnings.find(w => w.deprecation === 'at-rule-prelude-variable');

      expect(warning).toBeDefined();
      expect(warning?.message).toContain('"@size" in at-rule preludes is deprecated');
      expect(warning?.message).toContain('@{size}');
    });

    it('should not warn for interpolated @{ident} in at-rule preludes', () => {
      const { warnings } = parser.parse('@media @{mode} { .foo { color: red; } }');
      const warning = warnings.find(w => w.deprecation === 'at-rule-prelude-variable');

      expect(warning).toBeUndefined();
    });
  });

  describe('at-rule-variable', () => {
    it('should warn for a known at-rule name called as an empty-parens variable', () => {
      const { errors, warnings } = parser.parse('a { @media(); }');
      expect(errors.length).toBe(0);
      const warning = warnings.find(w => w.deprecation === 'at-rule-variable');

      expect(warning).toBeDefined();
      expect(warning?.message).toContain('Using known at-rule names as variables is deprecated');
    });

    it('should not warn for a non-at-rule name called as a variable', () => {
      const { errors, warnings } = parser.parse('a { @foo(); }');
      expect(errors.length).toBe(0);
      const warning = warnings.find(w => w.deprecation === 'at-rule-variable');

      expect(warning).toBeUndefined();
    });
  });
});
