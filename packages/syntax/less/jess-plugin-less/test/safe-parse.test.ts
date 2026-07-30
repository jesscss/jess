import { describe, expect, it } from "vitest";
import lessPlugin, { LessPluginResolver, prepareLessRootSource } from '../src/index.js';

describe("@jesscss/plugin-less", () => {
  it("returns a source-backed parser diagnostic for invalid Less", () => {
    const source = ".entry { color: red; }\n!broken";
    const result = lessPlugin().safeParse!("entry.less", source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([
      {
        code: "parse/syntax-error",
        phase: "parse",
        message: "Unexpected Less input after a complete stylesheet.",
        reason: expect.stringContaining("complete Less stylesheet"),
        fix: expect.stringContaining("valid Less syntax"),
        filePath: "entry.less",
        line: 2,
        column: 1,
        file: { source },
      },
    ]);
    expect(result.errors[0]?.lines?.[2]).toBe("!broken");
  });

  it("does not describe leading invalid input as trailing stylesheet text", () => {
    const source = "!broken";
    const result = lessPlugin().safeParse!("entry.less", source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([
      {
        code: "parse/syntax-error",
        phase: "parse",
        message: "Unexpected Less syntax.",
        reason: expect.stringContaining("start of a Less rule"),
        fix: expect.stringContaining("valid Less syntax"),
        filePath: "entry.less",
        line: 1,
        column: 1,
        file: { source },
      },
    ]);
    expect(result.errors[0]?.message).not.toContain("complete stylesheet");
  });

  it("reports the dynamic-charset policy at the authored statement", () => {
    const source = '@Eight: 8;\n@charset "UTF-@{Eight}";';
    const result = lessPlugin().safeParse!("entry.less", source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([
      {
        code: "parse/dynamic-charset",
        phase: "parse",
        message: "Interpolation is not valid in @charset.",
        fix: 'Use a static declaration such as @charset "UTF-8";',
        filePath: "entry.less",
        line: 2,
        column: 1,
        file: { source },
      },
    ]);
    expect(result.errors[0]?.lines?.[2]).toBe('@charset "UTF-@{Eight}";');
  });

  it("reports inline backtick JavaScript as recognized unsupported Less syntax", () => {
    const source = ".entry { value: `1 + 1`; }";
    const result = lessPlugin().safeParse!("entry.less", source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([
      {
        code: "parse/unsupported-inline-javascript",
        phase: "parse",
        message: "Inline backtick JavaScript is not supported.",
        reason: "Backtick JavaScript expressions are not evaluated.",
        fix: expect.stringContaining("@from/@-from"),
        filePath: "entry.less",
        line: 1,
        column: source.indexOf("`") + 1,
        file: { source },
      },
    ]);
    expect(result.errors[0]?.lines?.[1]).toBe(source);
  });

  it("reports removed bare variable interpolation with the @{name} fix", () => {
    const source = "@media @q { .card { color: red; } }";
    const result = lessPlugin().safeParse!("entry.less", source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([
      {
        code: "parse/unsupported-bare-variable-interpolation",
        phase: "parse",
        message: "Bare @variable interpolation is not valid here.",
        reason:
          "Bare @variable references are values; syntax and prelude interpolation must use @{variable}.",
        fix: "Use @{q} instead of @q.",
        filePath: "entry.less",
        line: 1,
        column: source.indexOf("@q") + 1,
        file: { source },
      },
    ]);
    expect(result.errors[0]?.lines?.[1]).toBe(source);
  });

  it('reports unsupported legacy Less variable names', () => {
    for (const { source, name } of [
      { source: '.entry { color: @1; }', name: '@1' },
      { source: '@-: red;', name: '@-' }
    ]) {
      const result = lessPlugin().safeParse!('entry.less', source);

      expect(result.document).toBeUndefined();
      expect(result.errors).toMatchObject([
        {
          code: 'parse/unsupported-variable-name',
          phase: 'parse',
          message: 'This Less variable name is not supported.',
          reason: 'Less variable names must not be numeric-leading or dash-only.',
          fix: expect.stringContaining('descriptive variable name'),
          filePath: 'entry.less',
          line: 1,
          column: source.indexOf(name) + 1,
          file: { source }
        }
      ]);
      expect(result.errors[0]?.lines?.[1]).toBe(source);
    }
  });

  it('reports unsupported legacy Less mixin names', () => {
    const source = '.-() { color: red; }';
    const result = lessPlugin().safeParse!('entry.less', source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([
      {
        code: 'parse/unsupported-mixin-name',
        phase: 'parse',
        message: 'This Less mixin name is not supported.',
        reason: 'Dash-only Less mixin names are not supported.',
        fix: expect.stringContaining('.mixin()'),
        filePath: 'entry.less',
        line: 1,
        column: 1,
        file: { source }
      }
    ]);
    expect(result.errors[0]?.lines?.[1]).toBe(source);
  });

  it("continues to accept a static CSS @charset statement", () => {
    const result = lessPlugin().safeParse!("entry.less", '@charset "UTF-8";');

    expect(result.errors).toEqual([]);
    expect(result.document).toMatchObject({
      type: "Stylesheet",
      rules: [{ type: 'AtRuleStatement', name: '@charset' }]
    });
  });

  it('reuses Less plugin instances by effective Less options', () => {
    const resolver = new LessPluginResolver();

    const first = resolver.getOrCreate({ mathMode: 'always' });
    const second = resolver.getOrCreate({ mathMode: 'always' });
    const third = resolver.getOrCreate({ mathMode: 'parens' });

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    resolver.dispose();
  });

  it('normalizes configured Less plugins with resolved language options', () => {
    const resolver = new LessPluginResolver();

    const configured = lessPlugin({ mathMode: 'always' });
    const normalized = resolver.normalizeConfiguredPlugin(configured, {
      optionsFor: () => ({ mathMode: 'parens' })
    });

    expect(normalized).not.toBe(configured);
    expect(normalized).toMatchObject({ name: 'less', mathMode: 'parens' });
    resolver.dispose();
  });

  it('prepares only Less root source with Less variable override options', () => {
    expect(prepareLessRootSource('.a { color: @tone; }', {
      language: 'less',
      activeOptions: {
        banner: '/* banner */',
        globalVars: { tone: 'red' },
        modifyVars: { tone: 'blue' }
      }
    })).toBe('/* banner */\n@tone: red;\n.a { color: @tone; }\n@tone: blue;');

    expect(prepareLessRootSource('.a { color: $tone; }', {
      language: 'scss',
      activeOptions: { banner: '/* banner */' }
    })).toBe('.a { color: $tone; }');
  });
});
