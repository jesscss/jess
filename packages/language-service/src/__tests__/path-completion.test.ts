import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createEngine } from '../engine.js';

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jessls-path-'));
  fs.writeFileSync(path.join(dir, 'colors.css'), 'a{}');
  fs.writeFileSync(path.join(dir, 'theme.scss'), '$x: 1;');
  fs.writeFileSync(path.join(dir, 'logo.png'), 'x');
  fs.mkdirSync(path.join(dir, 'partials'));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function completeInFile(basename: string, lang: string, contentWithCaret: string): string[] {
  const uri = pathToFileURL(path.join(dir, basename)).toString();
  const caret = contentWithCaret.indexOf('|');
  const doc = TextDocument.create(uri, lang, 1, contentWithCaret.replace('|', ''));
  const engine = createEngine();
  engine.open(doc.uri, lang, 1, doc.getText());
  return engine.getCompletions(doc.uri, doc.positionAt(caret)).items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
}

describe('filesystem path completion (url() + @import/@use)', () => {
  it('@import offers style files and directories, not images', () => {
    const labels = completeInFile('main.css', 'css', '@import "|";');
    expect(labels).toContain('colors.css');
    expect(labels).toContain('theme.scss');
    expect(labels).toContain('partials/');
    expect(labels).not.toContain('logo.png'); // not a style file
  });

  it('url() offers every file, including images', () => {
    const labels = completeInFile('main.css', 'css', '.a { background: url(|); }');
    expect(labels).toContain('logo.png');
    expect(labels).toContain('colors.css');
    expect(labels).toContain('partials/');
  });

  it('filters by the typed basename prefix', () => {
    const labels = completeInFile('main.css', 'css', '@import "co|";');
    expect(labels).toContain('colors.css');
    expect(labels).not.toContain('theme.scss');
  });

  it('.jess: @import path completion works too', () => {
    const labels = completeInFile('main.jess', 'jess', '@import "|";');
    expect(labels).toContain('colors.css');
    expect(labels).toContain('partials/');
  });

  it('does not offer paths for absolute URLs / protocols', () => {
    const labels = completeInFile('main.css', 'css', '.a { background: url(https://|); }');
    // http URL → not a disk path; falls through, so no local files offered.
    expect(labels).not.toContain('colors.css');
  });
});
