import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

function isDisposable(value: unknown): value is vscode.Disposable {
  return Boolean(value) && typeof (value as any).dispose === 'function';
}

export async function activate(context: vscode.ExtensionContext) {
  const enabled = vscode.workspace.getConfiguration('jess').get<boolean>('languageService.enable', true);
  if (!enabled) return;

  const outputChannel = vscode.window.createOutputChannel('Jess Language Service');
  context.subscriptions.push(outputChannel);

  const serverModule = context.asAbsolutePath(
    path.join('..', 'language-service', 'lib', 'server.js')
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio }
  };

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
  } else if (started && typeof (started as any).then === 'function') {
    // Some versions return a thenable disposable.
    void (started as Promise<unknown>).then((d) => {
      if (isDisposable(d)) {
        context.subscriptions.push(d);
      }
    });
  }
}

export async function deactivate() {
  if (!client) return;
  await client.stop();
  client = undefined;
}

