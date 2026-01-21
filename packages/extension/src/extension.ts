import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const enabled = vscode.workspace.getConfiguration('jess').get<boolean>('languageService.enable', true);
  if (!enabled) return;

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
      { scheme: 'file', language: 'scss' }
    ],
    // Keep it simple for now; we can add config sync later.
    synchronize: {}
  };

  client = new LanguageClient('jessLanguageService', 'Jess Language Service', serverOptions, clientOptions);
  context.subscriptions.push(client.start());
}

export async function deactivate() {
  if (!client) return;
  await client.stop();
  client = undefined;
}

