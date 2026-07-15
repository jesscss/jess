import * as assert from 'node:assert';
import * as vscode from 'vscode';

/**
 * End-to-end integration tests for the Jess VS Code extension, following
 * Microsoft's recommended harness (`@vscode/test-cli` + `@vscode/test-electron`).
 *
 * These run inside a real Extension Development Host: the extension activates,
 * spawns the Jess language server (`@jesscss/language-service`), and each feature
 * is driven through the built-in `vscode.execute*Provider` commands — the same
 * path the editor UI uses. This layer verifies the client/server WIRING is
 * correct; the exhaustive per-feature behavior is covered by the in-process
 * `engine.test.ts` unit suite in the language-service package.
 */

const EXTENSION_PACKAGE_NAME = '@jesscss/vscode-extension';

// The extension has no `publisher`, so its marketplace-style id is not stable;
// locate the extension under test by its package.json `name` instead.
function getJessExtension(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.all.find((e) => {
    const pkg: unknown = e.packageJSON;
    return typeof pkg === 'object' && pkg !== null && 'name' in pkg && pkg.name === EXTENSION_PACKAGE_NAME;
  });
}

function workspaceUri(relative: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'expected an open workspace folder (test-fixtures)');
  return vscode.Uri.joinPath(folder.uri, relative);
}

async function openFixture(relative: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(workspaceUri(relative));
  await vscode.window.showTextDocument(doc);
  return doc;
}

function offsetToPosition(doc: vscode.TextDocument, offset: number): vscode.Position {
  return doc.positionAt(offset);
}

// Poll until `predicate` is truthy or the timeout elapses. Language-server
// responses are asynchronous (parse + analysis happen off the open notification),
// so features and diagnostics need a short settle window after opening a file.
async function waitFor<T>(fn: () => T | Thenable<T>, predicate: (v: T) => boolean, timeoutMs = 20000, intervalMs = 250): Promise<T> {
  const start = Date.now();
  let last = await fn();
  while (!predicate(last)) {
    if (Date.now() - start > timeoutMs) {
      return last;
    }
    await new Promise(r => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

suite('Jess extension E2E', () => {
  suiteSetup(async function() {
    this.timeout(60000);
    const ext = getJessExtension();
    assert.ok(ext, `extension ${EXTENSION_PACKAGE_NAME} should be present`);
    await ext!.activate();
    // Open a fixture so the server processes at least one document.
    await openFixture('main.less');
  });

  test('activates the extension', () => {
    const ext = getJessExtension();
    assert.ok(ext?.isActive, 'extension should be active');
  });

  test('document symbols round-trip', async () => {
    const doc = await openFixture('main.less');
    const symbols = await waitFor(
      () => vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri),
      s => Array.isArray(s) && s.length > 0
    );
    assert.ok(Array.isArray(symbols) && symbols.length > 0, 'expected document symbols');
  });

  test('completions round-trip (local Less variable)', async () => {
    const doc = await openFixture('main.less');
    const text = doc.getText();
    // Complete the partial `@lo` reference — the local `@local` declaration.
    const at = text.indexOf('@lo;');
    assert.ok(at >= 0, 'fixture should contain `@lo;`');
    const position = offsetToPosition(doc, at + 3);
    const list = await waitFor(
      () => vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, position),
      l => !!l && l.items.some(i => String(typeof i.label === 'string' ? i.label : i.label.label).includes('local'))
    );
    const labels = (list?.items ?? []).map(i => (typeof i.label === 'string' ? i.label : i.label.label));
    assert.ok(labels.some(l => l.includes('local')), `expected a @local completion, got: ${labels.slice(0, 20).join(', ')}`);
  });

  test('definition round-trip (cross-file variable)', async () => {
    const doc = await openFixture('main.less');
    const text = doc.getText();
    const at = text.indexOf('@primary', text.indexOf('.button'));
    const position = offsetToPosition(doc, at + 2);
    const defs = await waitFor(
      () => vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', doc.uri, position),
      d => Array.isArray(d) && d.length > 0
    );
    assert.ok(Array.isArray(defs) && defs.length > 0, 'expected a definition location');
  });

  test('rename round-trip produces edits', async () => {
    const doc = await openFixture('main.less');
    const text = doc.getText();
    const at = text.indexOf('@primary', text.indexOf('.button'));
    const position = offsetToPosition(doc, at + 2);
    const edit = await waitFor(
      () => vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', doc.uri, position, 'brand'),
      e => !!e && e.size > 0
    );
    assert.ok(edit && edit.size > 0, 'expected a WorkspaceEdit with at least one file changed');
    // The current file must be among the edited files, and its edits must rewrite
    // the identifier to `brand`.
    const entries = edit!.entries();
    const mainEntry = entries.find(([uri]) => uri.toString() === doc.uri.toString());
    assert.ok(mainEntry, 'rename should edit the current file');
    assert.ok(mainEntry![1].some(te => te.newText.includes('brand')), 'rename edits should introduce `brand`');
  });

  test('code actions round-trip (undefined variable quick fix)', async () => {
    const doc = await openFixture('undefined.less');
    // Wait for the server to publish the undefined-variable diagnostic.
    const diags = await waitFor(
      () => vscode.languages.getDiagnostics(doc.uri),
      d => d.length > 0
    );
    assert.ok(diags.length > 0, 'expected at least one diagnostic on undefined.less');
    const range = diags[0]!.range;
    const actions = await waitFor(
      () => vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>('vscode.executeCodeActionProvider', doc.uri, range),
      a => Array.isArray(a) && a.length > 0
    );
    assert.ok(Array.isArray(actions) && actions.length > 0, 'expected at least one code action');
  });

  test('folding ranges round-trip (multi-line rulesets)', async () => {
    const doc = await openFixture('main.less');
    const folds = await waitFor(
      () => vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', doc.uri),
      f => Array.isArray(f) && f.length > 0
    );
    assert.ok(Array.isArray(folds) && folds.length > 0, 'expected folding ranges for the multi-line rulesets');
  });

  test('selection ranges round-trip (nested chain)', async () => {
    const doc = await openFixture('main.less');
    const text = doc.getText();
    const at = text.indexOf('@primary', text.indexOf('.button'));
    const position = offsetToPosition(doc, at + 2);
    const ranges = await waitFor(
      () => vscode.commands.executeCommand<vscode.SelectionRange[]>('vscode.executeSelectionRangeProvider', doc.uri, [position]),
      r => Array.isArray(r) && r.length > 0 && !!r[0]?.parent
    );
    assert.ok(Array.isArray(ranges) && ranges.length > 0, 'expected a selection range');
    // The cursor sits inside `@primary` → Declaration → Ruleset, so the chain widens.
    assert.ok(ranges[0]!.parent, 'selection range should nest to a parent (widening chain)');
  });

  test('document links round-trip (@import target)', async () => {
    const doc = await openFixture('main.less');
    const links = await waitFor(
      () => vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', doc.uri),
      l => Array.isArray(l) && l.length > 0
    );
    assert.ok(Array.isArray(links) && links.length > 0, 'expected a document link for `@import "vars"`');
  });

  test('references round-trip (@primary used in two rules)', async () => {
    const doc = await openFixture('main.less');
    const text = doc.getText();
    const at = text.indexOf('@primary', text.indexOf('.button'));
    const position = offsetToPosition(doc, at + 2);
    const refs = await waitFor(
      () => vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', doc.uri, position),
      r => Array.isArray(r) && r.length >= 2
    );
    assert.ok(Array.isArray(refs) && refs.length >= 2, `expected >=2 references to @primary, got ${Array.isArray(refs) ? refs.length : 'none'}`);
  });
});
