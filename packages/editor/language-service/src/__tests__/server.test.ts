import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createProtocolConnection,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  DidOpenTextDocumentNotification,
  DocumentSymbolRequest,
  InitializedNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
  StreamMessageReader,
  StreamMessageWriter,
  type InitializeResult,
  type ProtocolConnection,
  type PublishDiagnosticsParams
} from 'vscode-languageserver/node.js';
import { LINT_RULE_NAMES } from '@jesscss/diagnostics-core';

/*
 * Drives the real `server.ts` over LSP. The server creates its connection when
 * the module loads, so `createConnection` is redirected to an in-memory pipe
 * instead of stdio; every handler is the shipped one.
 */
const pipes = await vi.hoisted(async () => {
  const { PassThrough } = await import('node:stream');
  return { toServer: new PassThrough(), toClient: new PassThrough() };
});

vi.mock('vscode-languageserver/node.js', async (importOriginal) => {
  const lsp = await importOriginal<typeof import('vscode-languageserver/node.js')>();
  return {
    ...lsp,
    createConnection: () => lsp.createConnection(
      lsp.ProposedFeatures.all,
      new lsp.StreamMessageReader(pipes.toServer),
      new lsp.StreamMessageWriter(pipes.toClient)
    )
  };
});

let client: ProtocolConnection;
let initialized: InitializeResult;
const published: PublishDiagnosticsParams[] = [];

beforeAll(async () => {
  await import('../server.js');
  client = createProtocolConnection(new StreamMessageReader(pipes.toClient), new StreamMessageWriter(pipes.toServer));
  client.onNotification(PublishDiagnosticsNotification.type, params => published.push(params));
  client.listen();
  initialized = await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} });
  await client.sendNotification(InitializedNotification.type, {});
});

afterAll(() => {
  client.dispose();
});

/*
 * The server handles messages in order, so once a request issued after a
 * notification has been answered, everything that notification published has
 * already arrived.
 */
async function settle(uri: string): Promise<void> {
  await client.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri } });
}

async function openDoc(uri: string, languageId: string, text: string): Promise<PublishDiagnosticsParams[]> {
  const before = published.length;
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri, languageId, version: 1, text }
  });
  await settle(uri);
  return published.slice(before).filter(p => p.uri === uri);
}

describe('LSP server', () => {
  it('does not advertise formatting or code actions', () => {
    const { capabilities } = initialized;
    expect(capabilities.documentFormattingProvider).toBeUndefined();
    expect(capabilities.documentRangeFormattingProvider).toBeUndefined();
    expect(capabilities.codeActionProvider).toBeUndefined();
  });

  it('publishes diagnostics once when a document opens', async () => {
    expect(await openDoc('file:///open-once.css', 'css', '.a { colr: red; }')).toHaveLength(1);
  });

  it('applies the `jess` settings section the client synchronizes', async () => {
    const uri = 'file:///settings.css';
    const severityOf = (p: PublishDiagnosticsParams | undefined) =>
      p?.diagnostics.find(d => d.code === 'lint/unknown-property')?.severity;

    // `synchronize.configurationSection: 'jess'` sends the section under its name.
    async function configure(severity: Record<string, string>): Promise<PublishDiagnosticsParams | undefined> {
      const before = published.length;
      await client.sendNotification(DidChangeConfigurationNotification.type, {
        settings: { jess: { diagnostics: { severity } } }
      });
      await settle(uri);
      return published.slice(before).filter(p => p.uri === uri).at(-1);
    }

    const opened = await openDoc(uri, 'css', '.a { colr: red; }');
    expect(severityOf(opened.at(-1))).toBe(DiagnosticSeverity.Warning);
    expect(severityOf(await configure({ [LINT_RULE_NAMES.unknownProperties]: 'error' }))).toBe(DiagnosticSeverity.Error);

    // Removing the override restores the default.
    expect(severityOf(await configure({}))).toBe(DiagnosticSeverity.Warning);
  });
});
