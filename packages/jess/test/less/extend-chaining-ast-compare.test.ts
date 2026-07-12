/**
 * Compare AST from Jess parsing extend-chaining.less vs the AST constructed in
 * core extend-eval-integration for the media-extend case. Use serializeTypes
 * to see exactly what is parsed so we can align core's constructed tree (or
 * fix registration) when extend-chaining fails in Jess.
 *
 * AST comparison (see __snapshots__/extend-chaining-ast-compare.test.ts.snap):
 *
 * Parsed (Less/Jess) media block:
 * - Root rulesets use (BasicSelector '.a') directly; core test uses
 *   (SelectorList [ (ComplexSelector [ (BasicSelector '.a') ]) ]).
 * - .ma:extend(...) in parsed tree has ONE (Extend target: (SelectorList [.a, .b, ..., .md]) flag: 1);
 *   core test has TWO separate (Extend target: (BasicSelector '.a')) and (Extend target: (BasicSelector '.md')).
 * - @media prelude: parsed has (Paren (QueryCondition [ (Keyword 'tv') ])); core has (Any '(tv)').
 *
 * Diagnostic tests confirm that after eval, getAccessibleRoots(context.root) has size > 1,
 * .ma is findable in some accessible root with el('.ma').keySet, and the .mb:extend(.ma)
 * extend entry finds .ma when doing the same lookup as processExtends. So registration
 * and lookup work after eval; the failure may be timing (processExtends seeing stale
 * state) or a different code path when running from Jess.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { createRequire } from 'module';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import {
  serializeTypes,
  rules,
  ruleset,
  atrule,
  extend,
  el,
  decl,
  any,
  sellist,
  sel,
  Context,
  type Rules,
  isNode,
  N
} from '@jesscss/core';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));
const extendChainingLess = path.join(testData, 'tests-unit/extend-chaining/extend-chaining.less');

const serializeOpts = { showValues: true, maxStringLength: 120 };

describe.todo('extend-chaining AST: parsed vs constructed (serializeTypes comparison)', () => {
  it('serializes AST from Jess parsing extend-chaining.less before output eval', async () => {
    const compiler = new Compiler({
      compile: { plugins: [lessPlugin()] },
      output: { collapseNesting: false }
    });
    const context = compiler.createContext(extendChainingLess);
    const { node: parsedTree } = await context.getTree(extendChainingLess);
    const serialized = serializeTypes(parsedTree, serializeOpts);
    expect(typeof serialized).toBe('string');
    // Snapshot so we can diff against the constructed tree snapshot
    expect(serialized).toMatchSnapshot();
  });

  it('serializes AST from Jess parsing extend-chaining.less (post-eval)', async () => {
    const compiler = new Compiler({
      compile: { plugins: [lessPlugin()] },
      output: { collapseNesting: false }
    });
    const context = compiler.createContext(extendChainingLess);
    const { node } = await context.getTree(extendChainingLess);
    const evald = await node.eval(context);
    const serialized = serializeTypes(evald, serializeOpts);
    expect(typeof serialized).toBe('string');
    expect(serialized).toMatchSnapshot();
  });

  it('after parsing extend-chaining.less and eval, accessible roots from document root include @media', async () => {
    const compiler = new Compiler({
      compile: { plugins: [lessPlugin()] },
      output: { collapseNesting: false }
    });
    const context = compiler.createContext(extendChainingLess);
    const { node } = await context.getTree(extendChainingLess);
    await node.eval(context);
    const accessible = context.extendRoots.getAccessibleRoots(context.root!);
    expect(accessible.has(context.root!)).toBe(true);
    expect(accessible.size).toBeGreaterThan(1);
  });

  it('after parsing extend-chaining.less and eval, .ma is findable in some accessible root', async () => {
    const compiler = new Compiler({
      compile: { plugins: [lessPlugin()] },
      output: { collapseNesting: false }
    });
    const context = compiler.createContext(extendChainingLess);
    const { node } = await context.getTree(extendChainingLess);
    await node.eval(context);
    const accessible = context.extendRoots.getAccessibleRoots(context.root!);
    const maKeySet = el('.ma').keySet;
    let foundInRoot: Rules | null = null;
    for (const root of accessible) {
      const found = root.find('ruleset', maKeySet);
      if (found && found.length > 0) {
        foundInRoot = root;
        break;
      }
    }
    expect(foundInRoot).not.toBeNull();
  });

  it('extend entry for .mb:extend(.ma) finds .ma when using same lookup as processExtends', async () => {
    const compiler = new Compiler({
      compile: { plugins: [lessPlugin()] },
      output: { collapseNesting: false }
    });
    const context = compiler.createContext(extendChainingLess);
    const { node } = await context.getTree(extendChainingLess);
    await node.eval(context);
    const mbExtend = context.extends?.find(
      ([, selectorWithExtend]) => String(selectorWithExtend.valueOf()) === '.mb'
    );
    expect(mbExtend).toBeDefined();
    const [target, selectorWithExtend, , extendRoot] = mbExtend!;
    const accessibleRoots = context.extendRoots.getAccessibleRoots(extendRoot);
    const rulesetSet = [];
    for (const searchRoot of accessibleRoots) {
      const found = searchRoot.find('ruleset', target.keySet);
      if (found && found.length > 0) {
        rulesetSet.push(...found);
      }
    }
    expect(rulesetSet.length).toBeGreaterThan(0);
  });

  it('extend entries from @media (plasma) use the nested extend root', async () => {
    const compiler = new Compiler({
      compile: { plugins: [lessPlugin()] },
      output: { collapseNesting: true }
    });
    const context = compiler.createContext(extendChainingLess);
    const { node } = await context.getTree(extendChainingLess);
    await node.eval(context);
    const targetName = '.mb';
    const mbExtend = context.extends?.find((extendEntry) => {
      const target = extendEntry[0];
      const targetStr = String(target.valueOf());
      return targetStr.includes(targetName);
    });
    expect(mbExtend).toBeDefined();
    const extendRoot = mbExtend![3];
    expect(extendRoot).not.toBeUndefined();
    expect(extendRoot).not.toBe(context.root);
    const parent = extendRoot.parent;
    expect(parent).toBeDefined();
    expect(isNode(parent, N.AtRule)).toBe(true);
  });

  it('logs few lines when collapseNesting extend chain runs', async () => {
    process.env.DEBUG_EXTEND_REGISTRATION = 'true';
    const compiler = new Compiler({
      compile: { plugins: [lessPlugin()] },
      output: { collapseNesting: true }
    });
    const context = compiler.createContext(extendChainingLess);
    const { node } = await context.getTree(extendChainingLess);
    await node.eval(context);
    process.env.DEBUG_EXTEND_REGISTRATION = 'false';
    const css = context.root?.toString();
    expect(typeof css).toBe('string');
  });

  it('serializes AST constructed in core for media-extend case (extend-chaining.less media block)', () => {
    // Same structure as core extend-eval-integration.test.ts:
    // .a { color: black }
    // @media (tv) { .ma:extend(.a,.md) { color: black }, .md { color: inherit } }
    // .mb:extend(.ma) {} .mc:extend(.mb) {}
    const root = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([decl({ name: 'color', value: any('black') })])
      }),
      atrule({
        name: any('@media'),
        prelude: any('(tv)'),
        rules: rules([
          ruleset({
            selector: el('.ma'),
            rules: rules([
              decl({ name: 'color', value: any('black') }),
              extend({ target: el('.a') }),
              extend({ target: el('.md') })
            ])
          }),
          ruleset({
            selector: el('.md'),
            rules: rules([decl({ name: 'color', value: any('inherit') })])
          })
        ])
      }),
      ruleset({
        selector: el('.mb'),
        rules: rules([extend({ target: el('.ma') })])
      }),
      ruleset({
        selector: el('.mc'),
        rules: rules([extend({ target: el('.mb') })])
      })
    ]);
    const serialized = serializeTypes(root, serializeOpts);
    expect(typeof serialized).toBe('string');
    expect(serialized).toMatchSnapshot();
  });
});
