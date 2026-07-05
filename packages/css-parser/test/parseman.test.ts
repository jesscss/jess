import { describe, it, expect } from 'vitest';
import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { parseCssFn } from '../src/functional-parser.js';
import { Ruleset, Declaration } from '@jesscss/core';

describe('CssParser (Parséman)', () => {
  it('parses a simple ruleset', () => {
    const doc = parseCssFn('a { color: red; }');
    expect(doc.errors).toHaveLength(0);
    expect(doc.tree).not.toBeNull();
    const rules = doc.tree!;
    expect(rules.type).toBe('Rules');
  });

  it('parses declaration with value', () => {
    const doc = parseCssFn('p { color: red; font-size: 16px; }');
    expect(doc.errors).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const rules = doc.tree! as any;
    const nodes: any[] = rules.rules;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('Ruleset');
  });

  it('parses a selector list', () => {
    const doc = parseCssFn('h1, h2, h3 { margin: 0; }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses descendant combinator', () => {
    const doc = parseCssFn('div p { color: blue; }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses explicit combinators', () => {
    const doc = parseCssFn('a > b + c ~ d { }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses class and id selectors', () => {
    const doc = parseCssFn('.foo #bar { }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses pseudo-selectors', () => {
    const doc = parseCssFn('a:hover, p::before { color: red; }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses nth-child', () => {
    const doc = parseCssFn('li:nth-child(2n+1) { }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses attribute selectors', () => {
    const doc = parseCssFn('[data-foo="bar"] { }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses custom properties', () => {
    const doc = parseCssFn(':root { --color-primary: #fff; }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses @import statement', () => {
    const doc = parseCssFn('@import url("foo.css");');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses @media block', () => {
    const doc = parseCssFn('@media (max-width: 600px) { a { color: red; } }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses dimension values', () => {
    const doc = parseCssFn('div { width: 100px; height: 50%; font-size: 1.5em; }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses color values', () => {
    const doc = parseCssFn('a { color: #fff; background: #aabbcc; }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses function calls', () => {
    const doc = parseCssFn('div { background: rgba(0, 0, 0, 0.5); transform: translateX(10px); }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses url()', () => {
    const doc = parseCssFn('div { background: url("image.png"); }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses !important', () => {
    const doc = parseCssFn('a { color: red !important; }');
    expect(doc.errors).toHaveLength(0);
  });

  it('parses multiple rulesets', () => {
    const doc = parseCssFn('a { color: red; } b { font-size: 16px; }');
    expect(doc.errors).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect((doc.tree! as any).rules).toHaveLength(2);
  });

  it('parses empty ruleset', () => {
    const doc = parseCssFn('a { }');
    expect(doc.errors).toHaveLength(0);
  });
});

describe('CssParser (Parséman) — CSS fixture files', () => {
  const baseDir = path.join(__dirname, 'css');
  glob.sync(path.join(baseDir, '**/*.css'))
    .filter(f => !f.includes('errors'))
    .sort()
    .forEach((file) => {
      it(path.relative(baseDir, file), () => {
        const contents = fs.readFileSync(file, 'utf8');
        const result = parseCssFn(contents);
        expect(result.tree).not.toBeNull();
        expect(result.errors).toHaveLength(0);
      });
    });
});
