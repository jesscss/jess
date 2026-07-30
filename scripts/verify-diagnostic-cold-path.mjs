#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname);
const read = path => readFileSync(resolve(root, path), 'utf8');
const fail = (message) => {
  console.error(`diagnostic cold-path guard failed: ${message}`);
  process.exitCode = 1;
};

const context = read('packages/core/src/context.ts');
const warnStart = context.indexOf('warn(warning: JessError | WarningDiagnostic');
const warnEnd = context.indexOf('warnDeprecation(', warnStart);
const warn = warnStart === -1 || warnEnd === -1 ? '' : context.slice(warnStart, warnEnd);
if (!warn) {
  fail('could not locate Context.warn()');
} else {
  const policy = warn.indexOf('warnCodeMatchesAny(code, cfg.silence)');
  const normalize = warn.indexOf('toDiagnostic(warning,');
  const cap = warn.indexOf('stats.emittedSites.has(key)');
  if (policy === -1 || cap === -1 || normalize === -1 || policy > normalize || cap > normalize) {
    fail('Context.warn() must apply silence and capping policy before toDiagnostic()');
  }
}

const serialize = read('packages/core/src/ast/serialize.ts');
const evalCallStart = serialize.indexOf('function evalCall(');
const evalCallEnd = serialize.indexOf('function pluginCallFailure(', evalCallStart);
const evalCall = evalCallStart === -1 || evalCallEnd === -1 ? '' : serialize.slice(evalCallStart, evalCallEnd);
const functionGate = evalCall.indexOf('!e.reportUnresolvedFunctionFailures');
const unresolvedWarning = evalCall.indexOf('WARN.unresolvedFunction');
if (functionGate === -1 || unresolvedWarning === -1 || functionGate > unresolvedWarning) {
  fail('function preserve warnings must be policy-gated before WARN construction');
}
if (serialize.includes('.lastIndexOf(')
  || !serialize.includes('function firstIndexInSourceRange(')
  || !serialize.includes('function lastIndexInSourceRange(')) {
  fail('source replay must keep every search inside its AST-owned range');
}

const codeFrame = read('packages/core/src/error/code-frame.ts');
if (!codeFrame.includes('const sourceIndexes = new WeakMap<object, SourceIndex>();')) {
  fail('code-frame locations must cache their line index by source-file owner');
}
if (codeFrame.includes('.split(')) {
  fail('code-frame extraction must slice indexed source lines, never split the whole source');
}

const warningTest = read('packages/core/src/ast/__tests__/function-warning-silence.test.ts');
if (!warningTest.includes('not.toHaveBeenCalled')) {
  fail('missing test that a silenced function fallback does not route a warning');
}
const frameTest = read('packages/core/src/__tests__/code-frame.test.ts');
if (!frameTest.includes('CRLF source without splitting it')) {
  fail('missing source-index code-frame regression test');
}

if (process.exitCode === undefined) {
  console.log('diagnostic cold-path guard passed');
}
