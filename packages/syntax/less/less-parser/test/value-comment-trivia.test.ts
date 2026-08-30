import { describe, expect, it } from "vitest";
import { parse } from "@jesscss/less-parser";
import { serialize } from "../../../../core/src/ast/serialize.js";
import { triviaMapOf } from "../../../../core/src/ast/provenance.js";

describe("Less ordinary value comments", () => {
  it("keeps value comments in public trivia without creating Comment value nodes", () => {
    const source =
      ".card { border: solid/* keep */black; shadow: fn(alpha/* inner */beta); }";
    const document = parse(source);
    const trivia = triviaMapOf(document);
    const comments = trivia
      ?.commentRuns()
      .map((run) => source.slice(run.start, run.end));
    const rendered = serialize(document).css;

    expect(JSON.stringify(document)).not.toContain('"type":"Comment"');
    expect(comments).toEqual(
      expect.arrayContaining(["/* keep */", "/* inner */"])
    );
    expect(rendered).toContain("border: solid/* keep */black;");
    expect(rendered).toContain("shadow: fn(alpha/* inner */beta);");
  });

  it("keeps trailing value comments inline before the declaration semicolon", () => {
    const source =
      ".card { a: yes /* comment */; b: red/* tight */; @c: yes /* private */; c: @c; }";
    const document = parse(source);
    const rendered = serialize(document).css;

    expect(JSON.stringify(document)).not.toContain('"type":"Comment"');
    expect(rendered).toContain("a: yes /* comment */;");
    expect(rendered).toContain("b: red/* tight */;");
    expect(rendered).toContain("c: yes;");
    expect(rendered).not.toContain("a: yes;\n  /* comment */");
    expect(rendered).not.toContain("b: red;\n  /* tight */");
    expect(rendered).not.toContain("/* private */");
  });

  /* A list separator is matched by `sepBy`/`oneOrMoreSep` and contributes no
   * `children` entry, but a trivia insert index addresses `rawChildren`, where
   * the separator is still present. Reading the index against `children` drops
   * exactly the comments that sit either side of a separator — silently, with a
   * successful parse — so pin one comment on each side of each list form. */
  it('keeps comments sitting either side of a list separator', () => {
    const source = [
      '.bg { background-image: linear-gradient(#333 /* before */, /* after */ #111); }',
      '.sel { color: grey /* before */, /* after */ orange; }',
      '@media screen /* before */, /* after */ print, handheld { body { font-size: 12pt; } }'
    ].join('\n');
    const rendered = serialize(parse(source)).css;

    expect(rendered).toContain('linear-gradient(#333 /* before */, /* after */ #111)');
    expect(rendered).toContain('color: grey /* before */, /* after */ orange;');
    expect(rendered).toContain('@media screen /* before */, /* after */ print, handheld');
  });

  it("keeps newline-bearing value layout as parser trivia", () => {
    const source = [
      ".card {",
      "  grid-template-areas:",
      "    \"header header\"",
      "    \"body body\";",
      "  border: 2px",
      "          solid",
      "          black;",
      "  background-position: 45",
      "    -23;",
      "}",
    ].join("\n");
    const rendered = serialize(parse(source)).css;

    expect(rendered).toContain(
      'grid-template-areas:\n    "header header"\n    "body body";'
    );
    expect(rendered).toContain("border: 2px\n          solid\n          black;");
    expect(rendered).toContain("background-position: 45\n    -23;");
  });
});
