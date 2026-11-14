#!/usr/bin/env node
/*
 * Control for jesscss/jess#645: does a grammar fingerprint change only because
 * of reducer-local `const node = …` bindings?
 *
 * The guardrails fingerprint a combinator site by the definitions its closure
 * reads, and `grammarDefinitions` indexes reducer-local consts by name. A
 * reducer that binds `const node = …` therefore lands in the closure of every
 * site that calls parseman's `node(`, so a reducer-only edit can move a site's
 * fingerprint while the grammar it reads is unchanged.
 *
 * This script fingerprints one grammar file at a base ref and in the working
 * tree twice: as written, and with every reducer-local `node` binding (and its
 * references inside the declaring block) renamed. It prints the sites whose
 * fingerprint moved in each case and exits 1 if any site still moves after the
 * rename, which would mean the change reads different grammar.
 *
 * Run:  node scripts/probe/fingerprint-local-node-control.mjs [base-ref] [grammar-file]
 *       (defaults: origin/dev, packages/syntax/less/less-parser/src/grammar.ts)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { GRAMMAR_SOURCE, grammarDefinitions, scanGrammarSource } from '../grammar-guardrails.mjs';

const ts = createRequire(import.meta.url)('@typescript/typescript6/lib/typescript.js');
const baseRef = process.argv[2] ?? 'origin/dev';
const target = process.argv[3] ?? 'packages/syntax/less/less-parser/src/grammar.ts';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function sourcesAt(ref) {
  const rels = (ref ? git('ls-tree', '-r', '--name-only', ref) : git('ls-files')).split('\n').filter(rel => GRAMMAR_SOURCE.test(rel));
  return new Map(rels.map(rel => [rel, ref ? git('show', `${ref}:${rel}`) : readFileSync(rel, 'utf8')]));
}

/** Renames each `node` declared inside a function, across the block that declares it. */
function renameLocalNode(text) {
  const file = ts.createSourceFile(target, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = new Set();
  const isPropertyName = id =>
    (ts.isPropertyAccessExpression(id.parent) && id.parent.name === id)
    || (ts.isPropertyAssignment(id.parent) && id.parent.name === id);
  const collect = (id) => {
    if (ts.isIdentifier(id) && id.text === 'node' && !isPropertyName(id)) {
      edits.add(id.getStart(file));
    }
    ts.forEachChild(id, collect);
  };
  const visit = (n, inFunction) => {
    if (ts.isVariableDeclaration(n) && inFunction && ts.isIdentifier(n.name) && n.name.text === 'node') {
      let block = n.parent;
      while (block && !ts.isBlock(block)) {
        block = block.parent;
      }
      collect(block);
    }
    ts.forEachChild(n, child => visit(child, inFunction || ts.isFunctionLike(n)));
  };
  visit(file, false);
  let out = text;
  for (const at of [...edits].sort((a, b) => b - a)) {
    out = `${out.slice(0, at)}localNode${out.slice(at + 'node'.length)}`;
  }
  return { text: out, renamed: edits.size };
}

function fingerprints(sources) {
  const defs = new Map();
  for (const [rel, text] of sources) {
    for (const [name, inits] of grammarDefinitions(ts, rel, text)) {
      defs.set(name, [...(defs.get(name) ?? []), ...inits]);
    }
  }
  return scanGrammarSource(ts, target, sources.get(target), defs).filter(site => site.resolved);
}

function moved(before, after) {
  if (before.length !== after.length) {
    return [`site count ${before.length} -> ${after.length}`];
  }
  return before.flatMap((site, i) =>
    site.resolved === after[i].resolved ? [] : [`${site.rule}  ${site.const}  ${site.resolved} -> ${after[i].resolved}`]
  );
}

const base = sourcesAt(baseRef);
const head = sourcesAt(undefined);
const asWritten = moved(fingerprints(base), fingerprints(head));
const baseRenamed = renameLocalNode(base.get(target));
const headRenamed = renameLocalNode(head.get(target));
const renamed = moved(
  fingerprints(new Map(base).set(target, baseRenamed.text)),
  fingerprints(new Map(head).set(target, headRenamed.text))
);

console.log(`${target}: ${baseRef} vs working tree, ${fingerprints(head).length} resolved sites`);
console.log(`as written: ${asWritten.length} moved`);
for (const line of asWritten) {
  console.log(`  ${line}`);
}
console.log(`local \`node\` renamed (${baseRenamed.renamed} / ${headRenamed.renamed} identifiers): ${renamed.length} moved`);
for (const line of renamed) {
  console.log(`  ${line}`);
}
process.exitCode = renamed.length === 0 ? 0 : 1;
