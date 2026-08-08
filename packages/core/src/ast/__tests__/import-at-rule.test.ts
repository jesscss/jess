import { describe, expect, it, vi } from 'vitest';
import { atRuleBlock, atRuleStatement } from '../at-rule.js';
import type { AtRuleStatement } from '../at-rule.js';
import type { Interpolation, List, Quoted, StyleImport, Url, ValueNode } from '../nodes.js';
import { any, color, comment, importIsCompileTime, styleImport, spaced, complexSelector, compoundSelectorOf, decl, dimension, forNode, interpolatedSimpleSelector, interpolation, keyword, list, mixinCall, mixinDef, quoted, reference, rule, sel, selist, stylesheet, url, variableDeclaration, variableReference } from '../nodes.js';
import { createTriviaMapFromRanges, withTriviaMap } from '../provenance.js';
import { prepareStaticImports, serialize } from '../serialize.js';
import { Context } from '../../context.js';
import { AbstractPlugin } from '../../plugin.js';

/*
 * The parse-time split, spelled exactly as every grammar spells it: a plain CSS
 * `@import` is an `AtRuleStatement`, and a compile-time import is a `StyleImport`.
 * Tests author source-shaped imports and let the one shared predicate choose.
 *
 * A postlude on the compile-time branch throws here for the same reason the four
 * grammars throw on it: a media/layer/supports query describes a linked CSS
 * resource, and `StyleImport` has no field to put one in.
 */
const authoredImport = (
  name: string,
  target: Quoted | Url | Interpolation,
  options: List | null = null,
  alias: ValueNode | null = null,
  tail: ValueNode | null = null
): StyleImport | AtRuleStatement => {
  if (importIsCompileTime(name, target, options, alias)) {
    if (tail !== null) {
      throw new SyntaxError('A compile-time @import cannot carry a media query.');
    }
    return styleImport(name, target, { options, alias, mode: 'import' });
  }
  return atRuleStatement(name, tail === null ? target : spaced([target, tail]));
};

describe('StyleImport', () => {
  it('reuses loaded imports for repeated renders of the same source document', async () => {
    const entryPath = '/virtual/entry.less';
    const tokensPath = '/virtual/tokens.less';
    const entry = stylesheet([
      authoredImport('@import', quoted('"tokens.less"', 'tokens.less', '"', false)),
      rule('.entry', [decl('color', keyword('red'))])
    ]);
    const tokens = stylesheet([
      rule('.tokens', [decl('color', keyword('blue'))])
    ]);

    class MemoryLessPlugin extends AbstractPlugin {
      name = 'memory-less';
      supportedExtensions = ['.less'];
      locateCalls = 0;
      parseCalls = 0;
      private readonly documents = new Map([
        [entryPath, entry],
        [tokensPath, tokens]
      ]);

      override locate(paths: string[]) {
        this.locateCalls++;
        return paths.find(candidate => this.documents.has(candidate)) ?? null;
      }

      override async getSource(filePath: string) {
        return filePath === entryPath ? '@import "tokens.less";\n.entry { color: red; }\n' : '.tokens { color: blue; }\n';
      }

      safeParse(filePath: string) {
        this.parseCalls++;
        const document = this.documents.get(filePath);
        return document === undefined ? { errors: [], warnings: [] } : { document, errors: [], warnings: [] };
      }
    }

    const plugin = new MemoryLessPlugin();
    const context = new Context({}, [plugin]);
    const loadedEntry = await context.getTree(entryPath);
    expect(loadedEntry.node).toBe(entry);
    expect(plugin.locateCalls).toBe(1);
    expect(plugin.parseCalls).toBe(1);

    const render = () => Promise.resolve(context.withDocument(entry, () => serialize(entry, { context })));
    await expect(render()).resolves.toEqual({
      css: '.tokens {\n  color: blue;\n}\n.entry {\n  color: red;\n}\n'
    });
    expect(plugin.locateCalls).toBe(2);
    expect(plugin.parseCalls).toBe(2);

    await expect(render()).resolves.toEqual({
      css: '.tokens {\n  color: blue;\n}\n.entry {\n  color: red;\n}\n'
    });
    expect(plugin.locateCalls).toBe(2);
    expect(plugin.parseCalls).toBe(2);
  });

  it('uses prepared static imports without reloading during render', async () => {
    const entryPath = '/virtual/entry.less';
    const tokensPath = '/virtual/tokens.less';
    const entry = stylesheet([
      authoredImport('@import', quoted('"tokens.less"', 'tokens.less', '"', false)),
      rule('.entry', [decl('color', keyword('red'))])
    ]);
    const tokens = stylesheet([
      rule('.tokens', [decl('color', keyword('blue'))])
    ]);

    class MemoryLessPlugin extends AbstractPlugin {
      name = 'memory-less';
      supportedExtensions = ['.less'];
      locateCalls = 0;
      parseCalls = 0;
      private readonly documents = new Map([
        [entryPath, entry],
        [tokensPath, tokens]
      ]);

      override locate(paths: string[]) {
        this.locateCalls++;
        return paths.find(candidate => this.documents.has(candidate)) ?? null;
      }

      override async getSource(filePath: string) {
        return filePath === entryPath ? '@import "tokens.less";\n.entry { color: red; }\n' : '.tokens { color: blue; }\n';
      }

      safeParse(filePath: string) {
        this.parseCalls++;
        const document = this.documents.get(filePath);
        return document === undefined ? { errors: [], warnings: [] } : { document, errors: [], warnings: [] };
      }
    }

    const plugin = new MemoryLessPlugin();
    const context = new Context({}, [plugin]);
    const loadedEntry = await context.getTree(entryPath);
    expect(loadedEntry.node).toBe(entry);
    expect(plugin.locateCalls).toBe(1);
    expect(plugin.parseCalls).toBe(1);

    const preparedImports = await context.withDocument(entry, () => prepareStaticImports(entry, { context }));
    expect(plugin.locateCalls).toBe(2);
    expect(plugin.parseCalls).toBe(2);

    const render = () => Promise.resolve(context.withDocument(entry, () => serialize(entry, { context, preparedImports })));
    await expect(render()).resolves.toEqual({
      css: '.tokens {\n  color: blue;\n}\n.entry {\n  color: red;\n}\n'
    });
    await expect(render()).resolves.toEqual({
      css: '.tokens {\n  color: blue;\n}\n.entry {\n  color: red;\n}\n'
    });
    expect(plugin.locateCalls).toBe(2);
    expect(plugin.parseCalls).toBe(2);
  });

  it('loads duplicate static imports once during prepare and render', async () => {
    const entryPath = '/virtual/entry.less';
    const tokensPath = '/virtual/tokens.less';
    const entry = stylesheet([
      authoredImport('@import', quoted('"tokens.less"', 'tokens.less', '"', false)),
      authoredImport('@import', quoted('"tokens.less"', 'tokens.less', '"', false)),
      rule('.entry', [decl('color', keyword('red'))])
    ]);
    const tokens = stylesheet([
      rule('.tokens', [decl('color', keyword('blue'))])
    ]);

    class MemoryLessPlugin extends AbstractPlugin {
      name = 'memory-less';
      supportedExtensions = ['.less'];
      locateCalls = 0;
      parseCalls = 0;
      private readonly documents = new Map([
        [entryPath, entry],
        [tokensPath, tokens]
      ]);

      override locate(paths: string[]) {
        this.locateCalls++;
        return paths.find(candidate => this.documents.has(candidate)) ?? null;
      }

      override async getSource(filePath: string) {
        return filePath === entryPath
          ? '@import "tokens.less";\n@import "tokens.less";\n.entry { color: red; }\n'
          : '.tokens { color: blue; }\n';
      }

      safeParse(filePath: string) {
        this.parseCalls++;
        const document = this.documents.get(filePath);
        return document === undefined ? { errors: [], warnings: [] } : { document, errors: [], warnings: [] };
      }
    }

    const plugin = new MemoryLessPlugin();
    const context = new Context({}, [plugin]);
    const loadedEntry = await context.getTree(entryPath);
    expect(loadedEntry.node).toBe(entry);
    expect(plugin.locateCalls).toBe(1);
    expect(plugin.parseCalls).toBe(1);

    const preparedImports = await context.withDocument(entry, () => prepareStaticImports(entry, { context }));
    expect(plugin.locateCalls).toBe(2);
    expect(plugin.parseCalls).toBe(2);

    const render = () => Promise.resolve(context.withDocument(entry, () => serialize(entry, { context, preparedImports })));
    await expect(render()).resolves.toEqual({
      css: '.tokens {\n  color: blue;\n}\n.entry {\n  color: red;\n}\n'
    });
    await expect(render()).resolves.toEqual({
      css: '.tokens {\n  color: blue;\n}\n.entry {\n  color: red;\n}\n'
    });
    expect(plugin.locateCalls).toBe(2);
    expect(plugin.parseCalls).toBe(2);
  });

  it('does not resolve or parse again when only render import options differ', async () => {
    const entryPath = '/virtual/entry.less';
    const tokensPath = '/virtual/tokens.less';
    const entry = stylesheet([
      authoredImport('@import', quoted('"tokens.less"', 'tokens.less', '"', false)),
      rule('.entry', [decl('color', keyword('red'))])
    ]);
    const tokens = stylesheet([
      rule('.tokens', [decl('color', keyword('blue'))])
    ]);

    class MemoryLessPlugin extends AbstractPlugin {
      name = 'memory-less';
      supportedExtensions = ['.less'];
      locateCalls = 0;
      parseCalls = 0;
      private readonly documents = new Map([
        [entryPath, entry],
        [tokensPath, tokens]
      ]);

      override locate(paths: string[]) {
        this.locateCalls++;
        return paths.find(candidate => this.documents.has(candidate)) ?? null;
      }

      override async getSource(filePath: string) {
        return filePath === entryPath ? '@import "tokens.less";\n.entry { color: red; }\n' : '.tokens { color: blue; }\n';
      }

      safeParse(filePath: string) {
        this.parseCalls++;
        const document = this.documents.get(filePath);
        return document === undefined ? { errors: [], warnings: [] } : { document, errors: [], warnings: [] };
      }
    }

    const plugin = new MemoryLessPlugin();
    const context = new Context({}, [plugin]);
    const loadedEntry = await context.getTree(entryPath);
    expect(loadedEntry.node).toBe(entry);
    expect(plugin.locateCalls).toBe(1);
    expect(plugin.parseCalls).toBe(1);

    await context.withDocument(entry, () => context.loadImport('tokens.less'));
    expect(plugin.locateCalls).toBe(2);
    expect(plugin.parseCalls).toBe(2);

    await context.withDocument(entry, () => context.loadImport('tokens.less', { reference: true }));
    expect(plugin.locateCalls).toBe(2);
    expect(plugin.parseCalls).toBe(2);
  });

  it('reuses executable plugin module resolution and imports during a compile cycle', async () => {
    const pluginPath = '/virtual/plugins/colors.js';
    const loadedDark = { functions: { darken: () => 'dark' } };
    const loadedLight = { functions: { lighten: () => 'light' } };

    class MemoryScriptPlugin extends AbstractPlugin {
      name = 'memory-js';
      supportedExtensions = ['.js'];
      resolveCalls = 0;
      locateCalls = 0;
      importPluginCalls = 0;

      override resolve(paths: string | string[]) {
        this.resolveCalls++;
        return Array.isArray(paths) ? paths : [paths];
      }

      override locate(paths: string[]) {
        this.locateCalls++;
        return paths.includes(pluginPath) ? pluginPath : null;
      }

      override async importPlugin(filePath: string, options: string | null = null) {
        this.importPluginCalls++;
        expect(filePath).toBe(pluginPath);
        return options === 'mode=light' ? loadedLight : loadedDark;
      }
    }

    const plugin = new MemoryScriptPlugin();
    const context = new Context({}, [plugin]);
    const first = await context.getPluginModule(pluginPath, 'mode=dark');
    const second = await context.getPluginModule(pluginPath, 'mode=dark');

    expect(second).toBe(first);
    expect(plugin.resolveCalls).toBe(1);
    expect(plugin.locateCalls).toBe(1);
    expect(plugin.importPluginCalls).toBe(1);

    const light = await context.getPluginModule(pluginPath, 'mode=light');

    expect(light.module).toBe(loadedLight);
    expect(plugin.resolveCalls).toBe(1);
    expect(plugin.locateCalls).toBe(1);
    expect(plugin.importPluginCalls).toBe(2);
  });

  it('keeps explicit parser override imports distinct from extension-parsed documents', async () => {
    const filePath = '/virtual/tokens.css';
    const cssDocument = stylesheet([
      rule('.css', [decl('color', keyword('blue'))])
    ]);
    const lessDocument = stylesheet([
      rule('.less', [decl('color', keyword('red'))])
    ]);

    class MemoryCssPlugin extends AbstractPlugin {
      name = 'css';
      supportedExtensions = ['.css'];
      parseCalls = 0;

      override locate(paths: string[]) {
        return paths.includes(filePath) ? filePath : null;
      }

      override async getSource() {
        return '.css { color: blue; }\n';
      }

      safeParse() {
        this.parseCalls++;
        return { document: cssDocument, errors: [], warnings: [] };
      }
    }

    class MemoryLessPlugin extends AbstractPlugin {
      name = 'less';
      supportedExtensions = ['.less'];
      parseCalls = 0;

      safeParse() {
        this.parseCalls++;
        return { document: lessDocument, errors: [], warnings: [] };
      }
    }

    const css = new MemoryCssPlugin();
    const less = new MemoryLessPlugin();
    const context = new Context({}, [css, less]);

    await expect(context.getTree(filePath)).resolves.toMatchObject({ node: cssDocument });
    await expect(context.getTree(filePath, { type: 'less' })).resolves.toMatchObject({ node: lessDocument });
    await expect(context.getTree(filePath)).resolves.toMatchObject({ node: cssDocument });
    await expect(context.getTree(filePath, { type: 'less' })).resolves.toMatchObject({ node: lessDocument });
    expect(css.parseCalls).toBe(1);
    expect(less.parseCalls).toBe(1);

    const cssAgain = new MemoryCssPlugin();
    const lessAgain = new MemoryLessPlugin();
    const reverseContext = new Context({}, [cssAgain, lessAgain]);

    await expect(reverseContext.getTree(filePath, { type: 'less' })).resolves.toMatchObject({ node: lessDocument });
    await expect(reverseContext.getTree(filePath)).resolves.toMatchObject({ node: cssDocument });
    expect(cssAgain.parseCalls).toBe(1);
    expect(lessAgain.parseCalls).toBe(1);
  });

  it('routes dash import css targets through the Less parser while bare css imports stay terminal', async () => {
    const filePath = '/virtual/tokens.css';
    const imported = stylesheet([
      rule('.from-less-parser', [decl('color', keyword('red'))])
    ]);
    const dashImport = stylesheet([
      authoredImport('@-import', quoted(`"${filePath}"`, filePath, '"', false)),
      rule('.entry', [decl('color', keyword('blue'))])
    ]);
    const bareImport = stylesheet([
      authoredImport('@import', quoted(`"${filePath}"`, filePath, '"', false)),
      rule('.entry', [decl('color', keyword('blue'))])
    ]);

    class MemoryFilePlugin extends AbstractPlugin {
      name = 'files';
      sourceCalls = 0;

      override locate(paths: string[]) {
        return paths.includes(filePath) ? filePath : null;
      }

      override async getSource() {
        this.sourceCalls++;
        return '.from-less-parser { color: red; }\n';
      }
    }

    class MemoryLessPlugin extends AbstractPlugin {
      name = 'less';
      supportedExtensions = ['.less'];
      parseCalls = 0;

      safeParse(_filePath: string, _source: string, options?: { importOptions?: { type?: string } }) {
        this.parseCalls++;
        expect(options?.importOptions?.type).toBe('less');
        return { document: imported, errors: [], warnings: [] };
      }
    }

    const files = new MemoryFilePlugin();
    const less = new MemoryLessPlugin();
    const context = new Context({}, [files, less]);

    await expect(context.withDocument(dashImport, () => serialize(dashImport, { context }))).resolves.toEqual({
      css: '.from-less-parser {\n  color: red;\n}\n.entry {\n  color: blue;\n}\n'
    });
    expect(files.sourceCalls).toBe(1);
    expect(less.parseCalls).toBe(1);

    /*
     * A bare `.css` import is a plain CSS at-rule the parser already classified,
     * so nothing is asked of Context and the render never lifts to async.
     */
    expect(context.withDocument(bareImport, () => serialize(bareImport, { context }))).toEqual({
      css: `@import "${filePath}";\n.entry {\n  color: blue;\n}\n`
    });
    expect(files.sourceCalls).toBe(1);
    expect(less.parseCalls).toBe(1);
  });

  it('loads a claimed external import through Context without a core network resolver', async () => {
    const remoteSpecifier = 'https://styles.example.test/tokens.less';
    const mappedPath = '/virtual/tokens.less';
    const imported = stylesheet([
      variableDeclaration('tone', color('red'), { mode: 'declare' })
    ]);
    const context = new Context({}, [{
      name: 'remote-map',
      supportedExtensions: ['.less'],
      canResolveImport: specifier => specifier === remoteSpecifier,
      resolve: paths => paths.map(candidate => candidate === remoteSpecifier ? mappedPath : candidate),
      locate: paths => paths.includes(mappedPath) ? mappedPath : null
    }]);
    context.sourceTrees.set(mappedPath, imported);

    const document = stylesheet([
      authoredImport('@import', url(quoted(`"${remoteSpecifier}"`, remoteSpecifier, '"', false)), list([keyword('reference')], ',')),
      rule('.uses-token', [decl('color', variableReference('tone', 'scoped'))])
    ]);

    await expect(serialize(document, { context })).resolves.toEqual({
      css: '.uses-token {\n  color: red;\n}\n'
    });
  });

  it('keeps an unclaimed external import terminal without invoking Context resolution', async () => {
    const context = new Context({}, [{
      name: 'no-network',
      supportedExtensions: ['.less'],
      resolve: () => {
        throw new Error('must not resolve an unclaimed external import');
      }
    }]);
    const document = stylesheet([
      authoredImport('@import', url(quoted('"https://styles.example.test/theme.less"', 'https://styles.example.test/theme.less', '"', false)))
    ]);

    await expect(serialize(document, { context })).resolves.toEqual({
      css: '@import url("https://styles.example.test/theme.less");\n'
    });
  });

  it('drops an optional import whose file cannot be located', async () => {
    /*
     * `(optional)` selects what happens when the load FAILS, so the import is
     * still attempted. A missing file then contributes nothing at all — not a
     * diagnostic, and not a `@import (optional) …` CSS terminal, which no
     * browser understands. Matches Less 4.x.
     */
    const context = new Context({}, [{ name: 'never-locates', locate: () => null }]);
    const document = stylesheet([
      authoredImport('@import', quoted('"missing.less"', 'missing.less', '"', false), list([keyword('optional')], ',')),
      rule('.x', [decl('color', keyword('red'))])
    ]);

    await expect(serialize(document, { context })).resolves.toEqual({ css: '.x {\n  color: red;\n}\n' });
  });

  it('resolves an optional import normally when the file exists', async () => {
    const imported = stylesheet([rule('.a', [decl('color', keyword('red'))])]);
    const document = stylesheet([
      authoredImport('@import', quoted('"present.less"', 'present.less', '"', false), list([keyword('optional')], ','))
    ]);

    await expect(Promise.resolve(serialize(document, {
      importDocument: ({ specifier }) => specifier === 'present.less' ? { document: imported } : undefined
    }))).resolves.toEqual({ css: '.a {\n  color: red;\n}\n' });
  });

  it('never writes the option clause into a CSS-terminal import', () => {
    /*
     * `(css)` forces the CSS terminal, and the option list is import machinery
     * with no CSS meaning: `@import (css) "a";` is not something a browser
     * parses. The tail is real CSS syntax and stays.
     */
    const document = stylesheet([
      authoredImport(
        '@import',
        quoted('"theme"', 'theme', '"', false),
        list([keyword('css')], ','),
        null,
        any('screen')
      )
    ]);

    expect(serialize(document)).toEqual({ css: '@import "theme" screen;\n' });
  });

  it('keeps imported loop extend placements isolated per concrete iteration', async () => {
    const loopSelector = complexSelector([{
      term: compoundSelectorOf([interpolatedSimpleSelector(interpolation([
        { lit: '.from-' }, { ref: variableReference('name', 'scoped'), unquote: true }
      ]))])
    }]);
    const imported = stylesheet([
      forNode(
        spaced([keyword('one'), keyword('two')]),
        [rule(loopSelector, [], [{ target: selist(sel('.target')), partial: true }])],
        { kind: 'single', name: 'name' }
      )
    ]);
    const document = stylesheet([
      authoredImport('@import', quoted('"loop.less"', 'loop.less', '"', false)),

      /*
       * The root's unrelated extend engages the imported-fact preflight without
       * changing this target's output; the imported loop supplies its extenders.
       */
      rule('.target', [decl('color', color('red'))], [{ target: selist(sel('.does-not-match')), partial: true }])
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => specifier === 'loop.less' ? { document: imported, key: 'loop.less' } : undefined
    })).resolves.toEqual({ css: '.target,\n.from-one,\n.from-two {\n  color: red;\n}\n' });
  });

  /*
   * A media postlude on a loadable target is a PARSE ERROR, so no `StyleImport`
   * can reach the serializer carrying one and there is no `@media` wrapper left
   * to build. Less 4.x accepts this source and emits the wrapper; the divergence
   * is intended. The loaded document simply executes at its lexical position.
   */
  it('rejects a media tail on a loadable import instead of wrapping the loaded document', () => {
    expect(() => authoredImport(
      '@import',
      quoted('"imported.less"', 'imported.less', '"', false),
      list([any('multiple')], ','),
      null,
      any('screen and (max-width: 600px)')
    )).toThrow(SyntaxError);
  });

  it('loads a stylesheet import at its lexical position', async () => {
    const imported = stylesheet([rule('body', [decl('width', keyword('100%'))])]);
    const document = stylesheet([
      authoredImport('@import', quoted('"imported.less"', 'imported.less', '"', false), list([any('multiple')], ','))
    ]);

    await expect(Promise.resolve(serialize(document, {
      importDocument: ({ specifier }) => specifier === 'imported.less' ? { document: imported } : undefined
    }))).resolves.toEqual({ css: 'body {\n  width: 100%;\n}\n' });
  });

  it('keeps an async duplicate import inside nested @media ahead of a later sibling', async () => {
    const imported = stylesheet([rule('.imported', [decl('background', color('green'))])]);
    const importNode = () => authoredImport('@import', quoted('"imported.less"', 'imported.less', '"', false));
    const document = stylesheet([
      importNode(),
      atRuleBlock('@media', any('(max-width: 768px)'), [
        importNode(),
        rule('.mobile', [decl('color', color('red'))])
      ]),
      rule('.container', [rule('.nested', [decl('color', color('blue'))])])
    ]);

    await expect(serialize(document, {
      collapseNesting: false,
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'imported.less' ? { document: imported, key: 'imported.less' } : undefined)
    })).resolves.toEqual({
      css: '.imported {\n  background: green;\n}\n'
        + '@media (max-width: 768px) {\n  .mobile {\n    color: red;\n  }\n}\n'
        + '.container {\n  .nested {\n    color: blue;\n  }\n}\n'
    });
  });

  it('awaits an async loaded document inside a bubbleable at-rule before deciding the block is empty', async () => {
    const imported = stylesheet([rule('.inside', [decl('color', color('red'))])]);
    const document = stylesheet([
      atRuleBlock('@layer', keyword('legacy'), [authoredImport('@import', quoted('"nested.less"', 'nested.less', '"', false))])
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'nested.less' ? { document: imported } : undefined)
    })).resolves.toEqual({ css: '@layer legacy {\n.inside {\n  color: red;\n}\n}\n' });
  });

  it('writes a typed target and optional typed tail as one terminal statement', () => {
    const document = stylesheet([
      authoredImport('@import', quoted('"theme.css"', 'theme.css', '"', false), null, null, any('layer(theme) screen'))
    ]);

    expect(serialize(document)).toEqual({ css: '@import "theme.css" layer(theme) screen;\n' });
  });

  it('keeps a canonical opaque url target terminal', () => {
    expect(serialize(stylesheet([authoredImport('@import', url(any('theme.css')))]))).toEqual({
      css: '@import url(theme.css);\n'
    });
  });

  it('owns one target-to-tail separator and never strips tail bytes', () => {
    const document = stylesheet([
      authoredImport('@import', quoted('"theme.css"', 'theme.css', '"', false), null, null, any('  /* grammar-owned tail */ screen'))
    ]);

    expect(serialize(document)).toEqual({
      css: '@import "theme.css"   /* grammar-owned tail */ screen;\n'
    });
  });

  it('hoists and de-duplicates static CSS-terminal root imports without touching loaded style imports', () => {
    const cssImport = authoredImport('@import', quoted('"theme.css"', 'theme.css', '"', false), null, null, any('screen'));
    const document = stylesheet([
      rule('.before', [decl('color', keyword('red'))]),
      cssImport,
      rule('.after', [decl('color', keyword('blue'))]),
      authoredImport('@import', quoted('"theme.css"', 'theme.css', '"', false), null, null, any('screen'))
    ]);

    expect(serialize(document)).toEqual({
      css: '@import "theme.css" screen;\n.before {\n  color: red;\n}\n.after {\n  color: blue;\n}\n'
    });
  });

  it('keeps directive syntax structured without making resolution part of the AST', () => {
    const document = stylesheet([
      variableDeclaration('theme', keyword('night'), { mode: 'declare' }),
      styleImport(
        '@-export',
        url(interpolation([
          { lit: '"themes/' },
          { ref: variableReference('theme', 'scoped'), unquote: true },
          { lit: '.less"' }
        ])),
        {
          options: list([keyword('less'), keyword('reference')], ','),
          alias: keyword('tokens'),
          forward: true
        }
      )
    ]);

    /*
     * The option list stays a structured AST fact but is consumed by the import
     * machinery, never serialized — only the interpolated target and the alias
     * are syntax. There is no postlude: `StyleImport` has no field for one, and
     * the grammars reject the syntax that used to produce it.
     */
    expect(serialize(document)).toEqual({
      css: '@-export url("themes/night.less") as tokens;\n'
    });
  });

  it('keeps an import fact inside its canonical rule placement', () => {
    const document = stylesheet([
      rule('.card', [
        authoredImport('@import', url(quoted('"nested.css"', 'nested.css', '"', false))),
        decl('color', keyword('red'))
      ])
    ]);

    expect(serialize(document)).toEqual({
      css: '.card {\n  @import url("nested.css");\n  color: red;\n}\n'
    });
    expect(serialize(document, { collapseNesting: false })).toEqual({
      css: '.card {\n  @import url("nested.css");\n  color: red;\n}\n'
    });
  });

  it('keeps an import fact inside the rule where a mixin expands it', () => {
    const document = stylesheet([
      mixinDef('imported', [], [authoredImport('@import', quoted('"mixin.css"', 'mixin.css', '"', false))]),
      rule('.card', [mixinCall('imported')])
    ]);

    expect(serialize(document)).toEqual({ css: '.card {\n  @import "mixin.css";\n}\n' });
  });

  it('awaits a raw inline import inside a flattened rule instead of buffering it as a leaf', async () => {
    const document = stylesheet([
      rule('.source-only', [
        authoredImport(
          '@import',
          quoted('"payload.css"', 'payload.css', '"', false),
          list([keyword('inline')], ',')
        )
      ])
    ]);

    await expect(serialize(document, {
      collapseNesting: true,
      importDocument: () => Promise.resolve({ inline: '.from-inline { color: green; }', media: null })
    })).resolves.toEqual({ css: '.from-inline { color: green; }\n' });
  });

  it('keeps a trailing import in its source-ordered parent block after a nested rule', () => {
    const document = stylesheet([
      rule('.card', [
        decl('before', keyword('one')),
        rule('.child', [decl('inside', keyword('two'))]),
        authoredImport('@import', quoted('"after.css"', 'after.css', '"', false))
      ])
    ]);

    expect(serialize(document)).toEqual({
      css: '.card {\n  before: one;\n}\n.card .child {\n  inside: two;\n}\n.card {\n  @import "after.css";\n}\n'
    });
  });

  it('executes a loaded document in the importing frame before later statements', async () => {
    const imported = stylesheet([
      variableDeclaration('tone', color('red'), { mode: 'declare' }),
      mixinDef('accent', [], [decl('border-color', variableReference('tone', 'scoped'))])
    ]);
    const document = stylesheet([
      authoredImport('@import', quoted('"tokens.less"', 'tokens.less', '"', false)),
      rule('.card', [
        decl('color', variableReference('tone', 'scoped')),
        mixinCall('accent')
      ])
    ]);

    const result = await serialize(document, {
      collapseNesting: false,
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'tokens.less' ? { document: imported } : undefined)
    });

    expect(result).toEqual({
      css: '.card {\n  color: red;\n  border-color: red;\n}\n'
    });
  });

  it('keeps a reference import output-hidden while publishing its lookup facts', async () => {
    const imported = stylesheet([
      variableDeclaration('tone', color('red'), { mode: 'declare' }),
      mixinDef('accent', [], [decl('border-color', variableReference('tone', 'scoped'))]),
      rule('.hidden', [decl('color', keyword('red'))])
    ]);
    const document = stylesheet([
      authoredImport(
        '@import',
        quoted('"tokens.less"', 'tokens.less', '"', false),
        list([keyword('reference')], ',')
      ),
      rule('.card', [
        decl('color', variableReference('tone', 'scoped')),
        mixinCall('accent')
      ])
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'tokens.less' ? { document: imported } : undefined)
    })).resolves.toEqual({
      css: '.card {\n  color: red;\n  border-color: red;\n}\n'
    });
  });

  it('does not expose an exact extender defined by a reference import', async () => {
    const imported = stylesheet([
      rule('.unusedAndReference', [decl('unused-and', keyword('reference'))], [{
        target: selist(sel('.theOnlySelector')),
        partial: false,

        /*
         * This is the parser shape for `.unusedAndReference:extend(...)`.
         * The imported-fact planner must retain its `Level[]` ancestor path,
         * rather than passing this one selector-list Level directly to
         * composePath().
         */
        subject: selist(sel('.unusedAndReference'))
      }])
    ]);
    const document = stylesheet([
      authoredImport(
        '@import',
        quoted('"reference.less"', 'reference.less', '"', false),
        list([keyword('reference')], ',')
      ),
      rule('.theOnlySelector', [decl('shall-have', keyword('one selector'))])
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'reference.less' ? { document: imported, key: 'reference.less' } : undefined)
    })).resolves.toEqual({
      css: '.theOnlySelector {\n  shall-have: one selector;\n}\n'
    });
  });

  it('awaits a reference import nested in a namespace before a later namespace call', async () => {
    const imported = stylesheet([
      rule('.mixin', [decl('was', keyword('included'))])
    ]);
    const namespacedCall = mixinCall('.mixin');
    namespacedCall.path = [{ combinator: '>' as const, selector: '#Namespace' }];
    const document = stylesheet([
      rule('#Namespace', [
        authoredImport(
          '@import',
          quoted('"nested.less"', 'nested.less', '"', false),
          list([keyword('reference')], ',')
        )
      ]),
      rule('#used-namespaced-mixin', [
        namespacedCall,
        decl('shall-see-was', keyword('included'))
      ])
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'nested.less' ? { document: imported } : undefined)
    })).resolves.toEqual({
      css: '#used-namespaced-mixin {\n  was: included;\n  shall-see-was: included;\n}\n'
    });
  });

  it('keeps a nested multiple import at its rule placement while hiding its nested reference import', async () => {
    const hidden = stylesheet([rule('should', [decl('be', keyword('invisible'))])]);
    const multiple = stylesheet([
      comment('/* tralala */'),
      rule('.fix', [decl('fix', keyword('fix'))]),
      rule('.something', [
        authoredImport('@import', quoted('"hidden.less"', 'hidden.less', '"', false), list([keyword('reference')], ',')),
        decl('inside', keyword('something'))
      ])
    ]);
    const document = stylesheet([
      rule('show-all-content', [
        authoredImport('@import', quoted('"multiple.less"', 'multiple.less', '"', false), list([keyword('multiple')], ','))
      ])
    ]);

    await expect(serialize(document, {
      collapseNesting: false,
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'multiple.less'
        ? { document: multiple, key: 'multiple.less' }
        : specifier === 'hidden.less'
          ? { document: hidden, key: 'hidden.less' }
          : undefined)
    })).resolves.toEqual({
      css: 'show-all-content {\n  /* tralala */\n  .fix {\n    fix: fix;\n  }\n  .something {\n    inside: something;\n  }\n}\n'
    });
  });

  it('emits leading imported block comments from document trivia at the import site', async () => {
    const importedSource = '/* tralala */\n.fix { fix: fix; }\n';
    const imported = withTriviaMap(
      stylesheet([
        rule('.fix', [decl('fix', keyword('fix'))])
      ]),
      createTriviaMapFromRanges(importedSource, [{ start: 0, end: '/* tralala */\n'.length }])
    );
    const document = stylesheet([
      rule('show-all-content', [
        authoredImport('@import', quoted('"multiple.less"', 'multiple.less', '"', false), list([keyword('multiple')], ','))
      ])
    ]);

    await expect(serialize(document, {
      collapseNesting: false,
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'multiple.less'
        ? { document: imported, key: 'multiple.less' }
        : undefined)
    })).resolves.toEqual({
      css: 'show-all-content {\n  /* tralala */\n  .fix {\n    fix: fix;\n  }\n}\n'
    });
  });

  it('retries one unresolved typed import target after later imports publish its variables', async () => {
    const calls: string[] = [];
    const deferred = stylesheet([
      variableDeclaration('answer', color('blue'), { mode: 'declare' })
    ]);
    const providers = stylesheet([
      variableDeclaration('segment', keyword('ready'), { mode: 'declare' })
    ]);
    const document = stylesheet([
      authoredImport(
        '@import',
        interpolation([
          { lit: '"target-' },
          { ref: variableReference('segment', 'scoped'), unquote: true },
          { lit: '.less"' }
        ])
      ),
      authoredImport('@import', quoted('"providers.less"', 'providers.less', '"', false)),
      rule('.card', [decl('color', variableReference('answer', 'scoped'))])
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => {
        calls.push(specifier);
        return Promise.resolve(specifier === 'providers.less'
          ? { document: providers }
          : specifier === 'target-ready.less'
            ? { document: deferred }
            : undefined);
      }
    })).resolves.toEqual({ css: '.card {\n  color: blue;\n}\n' });
    expect(calls).toEqual(['providers.less', 'target-ready.less']);
  });

  it('reports a structured unresolved-target diagnostic after its one retry without loading it', async () => {
    const document = stylesheet([
      authoredImport('@import', interpolation([
        { lit: '"target-' },
        { ref: variableReference('never', 'scoped'), unquote: true },
        { lit: '.less"' }
      ]))
    ]);
    let loads = 0;

    await expect(Promise.resolve(serialize(document, {
      importDocument: () => {
        loads++;
        return { document: null };
      }
    }))).rejects.toMatchObject({
      code: 'resolve/name-not-found',
      reason: 'Symbol "@never" is undefined in this scope.'
    });
    expect(loads).toBe(0);
  });

  it('leaves unresolved dynamic import targets for render-time handling during static prep', async () => {
    const document = stylesheet([
      authoredImport('@import', interpolation([
        { lit: '"target-' },
        { ref: variableReference('never', 'scoped'), unquote: true },
        { lit: '.less"' }
      ]))
    ]);
    let loads = 0;

    await expect(Promise.resolve(prepareStaticImports(document, {
      importDocument: () => {
        loads++;
        return { document: null };
      }
    }))).resolves.toBeTruthy();
    expect(loads).toBe(0);

    await expect(Promise.resolve(serialize(document, {
      importDocument: () => {
        loads++;
        return { document: null };
      }
    }))).rejects.toMatchObject({
      code: 'resolve/name-not-found',
      reason: 'Symbol "@never" is undefined in this scope.'
    });
    expect(loads).toBe(0);
  });

  it('does not retry a Context loader failure as an unresolved import target', async () => {
    const document = stylesheet([
      authoredImport('@import', quoted('"broken.less"', 'broken.less', '"', false))
    ]);
    let loads = 0;

    await expect(serialize(document, {
      importDocument: () => {
        loads++;
        return Promise.reject(new Error('loader failed'));
      }
    })).rejects.toThrow('loader failed');
    expect(loads).toBe(1);
  });

  it('surfaces Context loader failures during static import preparation', async () => {
    const document = stylesheet([
      authoredImport('@import', quoted('"broken.less"', 'broken.less', '"', false))
    ]);
    let loads = 0;

    await expect(Promise.resolve(prepareStaticImports(document, {
      importDocument: () => {
        loads++;
        return Promise.reject(new Error('loader failed during static prep'));
      }
    }))).rejects.toThrow('loader failed during static prep');
    expect(loads).toBe(1);
  });

  it('publishes imported namespace rulesets for later call-result member reads', async () => {
    const imported = stylesheet([
      rule('#library', [mixinDef('.add-one', [{ name: 'value' }], [variableDeclaration('return', dimension(2, 'px', '2px'), { mode: 'declare' })])])
    ]);
    const importedCall = {
      type: 'MixinCall' as const,
      name: '.add-one', args: [{ value: dimension(1, 'px', '1px') }],
      path: [{ combinator: ' ' as const, selector: '#library' }], important: false
    };
    const document = stylesheet([
      authoredImport('@import', quoted('"library.less"', 'library.less', '"', false)),
      rule('#library', [mixinDef('.add-one', [{ name: 'value' }], [variableDeclaration('return', dimension(3, 'px', '3px'), { mode: 'declare' })])]),
      rule('.bar', [decl('height', reference(importedCall, [{ type: 'LookupStep', kind: 'var', name: variableReference('return', 'scoped') }], '#library.add-one(1px)[@return]'))])
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'library.less' ? { document: imported } : undefined)
    })).resolves.toEqual({ css: '.bar {\n  height: 3px;\n}\n' });
  });

  it('reads a variable member from an imported namespace call result', async () => {
    const imported = stylesheet([
      rule('#library', [mixinDef('.add-one', [{ name: 'value' }], [
        variableDeclaration('return', dimension(2, 'px', '2px'), { mode: 'declare' })
      ])])
    ]);
    const importedCall = {
      type: 'MixinCall' as const,
      name: '.add-one', args: [{ value: dimension(1, 'px', '1px') }],
      path: [{ combinator: ' ' as const, selector: '#library' }], important: false
    };
    const document = stylesheet([
      authoredImport('@import', quoted('"library.less"', 'library.less', '"', false)),
      rule('.bar', [decl('height', reference(importedCall, [
        { type: 'LookupStep', kind: 'var', name: variableReference('return', 'scoped') }
      ], '#library.add-one(1px)[@return]'))])
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'library.less' ? { document: imported } : undefined)
    })).resolves.toEqual({ css: '.bar {\n  height: 2px;\n}\n' });
  });

  it('preserves a CSS import when the driver declines its typed request', async () => {
    const document = stylesheet([
      authoredImport('@import', quoted('"theme"', 'theme', '"', false))
    ]);

    await expect(serialize(document, {
      importDocument: () => Promise.resolve(undefined)
    })).resolves.toEqual({ css: '@import "theme";\n' });
  });

  it('suppresses imports when processImports is false', () => {
    const document = stylesheet([
      authoredImport('@import', url(quoted('"https://fonts.example.test/css?family=Open+Sans"', 'https://fonts.example.test/css?family=Open+Sans', '"', false))),
      rule('.a', [decl('b', keyword('c'))])
    ]);

    expect(serialize(document, {
      context: new Context({ processImports: false })
    })).toEqual({ css: '.a {\n  b: c;\n}\n' });
  });

  it('does not load Less imports when processImports is false', () => {
    const document = stylesheet([
      authoredImport('@import', quoted('"library.less"', 'library.less', '"', false)),
      rule('.a', [decl('b', keyword('c'))])
    ]);
    const importDocument = vi.fn(() => Promise.resolve({
      document: stylesheet([rule('.from-import', [decl('color', keyword('red'))])])
    }));

    expect(serialize(document, {
      context: new Context({ processImports: false }),
      importDocument
    })).toEqual({ css: '.a {\n  b: c;\n}\n' });
    expect(importDocument).not.toHaveBeenCalled();
  });

  it('emits a driver-provided inline import raw', async () => {
    const document = stylesheet([
      authoredImport('@import', url(quoted('"raw.css"', 'raw.css', '"', false)), list([keyword('inline')]))
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => Promise.resolve(specifier === 'raw.css' ? { inline: '#raw { color: yellow; }' } : undefined)
    })).resolves.toEqual({
      css: '#raw { color: yellow; }\n'
    });
  });

  /*
   * `(inline)` makes an import compile-time — it reads bytes off disk — so a
   * postlude on it is rejected at parse time like any other compile-time import.
   * Less 4.x instead wraps the spliced bytes in `@media (min-width: 600px)`;
   * that wrap and the syntax reaching it are both deliberately gone.
   */
  it('rejects a media postlude on an inline import instead of wrapping the splice', () => {
    expect(() => authoredImport(
      '@import',
      url(quoted('"raw.css"', 'raw.css', '"', false)),
      list([keyword('inline')]),
      null,
      any('(min-width:600px)')
    )).toThrow(SyntaxError);
  });
});
