import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

function isDisposable(value: unknown): value is vscode.Disposable {
  return typeof value === 'object' && value !== null && 'dispose' in value && typeof value.dispose === 'function';
}

export async function activate(context: vscode.ExtensionContext) {
  const enabled = vscode.workspace.getConfiguration('jess').get<boolean>('languageService.enable', true);
  if (!enabled) {
    return;
  }

  const outputChannel = vscode.window.createOutputChannel('Jess Language Service');
  context.subscriptions.push(outputChannel);

  // Use the CJS build of the server so the language client can fork it as an
  // unambiguous CommonJS module (the language-service package is `type: module`,
  // so the `.js` output is ESM).
  const serverModule = context.asAbsolutePath(
    path.join('..', 'language-service', 'lib', 'server.cjs')
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio }
  };

  // The client is intentionally thin: `vscode-languageclient` advertises the full
  // set of standard client capabilities (including `textDocument/rename`,
  // `prepareSupport`, and `textDocument/codeAction`) by default, so the rename and
  // quick-fix providers only need to be advertised server-side (see server.ts
  // `renameProvider`/`codeActionProvider`). No per-feature registration is required
  // here — the capabilities are negotiated automatically on initialize.
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'css' },
      { scheme: 'file', language: 'less' },
      { scheme: 'file', language: 'scss' },
      { scheme: 'file', language: 'jess' }
    ],
    outputChannel,
    // Keep it simple for now; we can add config sync later.
    synchronize: {
      configurationSection: 'jess'
    }
  };

  client = new LanguageClient('jessLanguageService', 'Jess Language Service', serverOptions, clientOptions);
  const started = client.start();
  if (isDisposable(started)) {
    context.subscriptions.push(started);
  } else if (typeof started.then === 'function') {
    // Some versions return a thenable (v9 returns a Promise<void>).
    void started.then((d: unknown) => {
      if (isDisposable(d)) {
        context.subscriptions.push(d);
      }
    });
  }
}

export async function deactivate() {
  if (!client) {
    return;
  }
  await client.stop();
  client = undefined;
}
