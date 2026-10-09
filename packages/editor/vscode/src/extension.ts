import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const enabled = vscode.workspace.getConfiguration('jess').get<boolean>('languageService.enable', true);
  if (!enabled) {
    return;
  }

  const outputChannel = vscode.window.createOutputChannel('Jess Language Service');
  context.subscriptions.push(outputChannel);

  /*
   * Use the CJS build of the server so the language client can fork it as an
   * unambiguous CommonJS module (the language-service package is `type: module`,
   * so the `.js` output is ESM).
   */
  const serverModule = context.asAbsolutePath(path.join('..', 'language-service', 'lib', 'server.cjs'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio }
  };

  /*
   * The client is intentionally thin: `vscode-languageclient` advertises the
   * standard client capabilities by default, so each feature only needs to be
   * advertised server-side (see server.ts). Saved files and untitled buffers are
   * both served.
   */
  const clientOptions: LanguageClientOptions = {
    documentSelector: ['css', 'less', 'scss', 'jess'].flatMap(language => [
      { scheme: 'file', language },
      { scheme: 'untitled', language }
    ]),
    outputChannel,

    // The server receives these settings as `{ jess: { ... } }`.
    synchronize: {
      configurationSection: 'jess'
    }
  };

  client = new LanguageClient('jessLanguageService', 'Jess Language Service', serverOptions, clientOptions);
  await client.start();
}

export async function deactivate() {
  if (!client) {
    return;
  }
  await client.stop();
  client = undefined;
}
