#!/usr/bin/env node
/**
 * Read-only static analysis of parseman's AST-mode per-node capture decision,
 * which is driven entirely by each reducer's DECLARED POSITIONAL PARAMETER LIST
 * (`confirmedBuildArity`):
 *
 *   arity >= 1 -> children | >= 2 -> fields | >= 4 -> raw | >= 5 -> trivia
 *   arity >= 6 -> clone _ctx.state           | arity === null -> enable all five
 *
 * Everything here is counted out of the SHIPPED generated artifact
 * (packages/syntax/<d>/<d>-parser/lib/grammar*.js). Nothing is written and no
 * grammar source is touched.
 *
 *   node tools/grammar-ast-arity.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ARTIFACTS = [
  ['css', 'packages/syntax/css/css-parser/lib/grammar.js'],
  ['less', 'packages/syntax/less/less-parser/lib/grammar2.js'],
  ['scss', 'packages/syntax/scss/scss-parser/lib/grammar.js'],
  ['jess', 'packages/syntax/jess/jess-parser/lib/grammar.js']
];

/** Split a generated array literal into its top-level elements. */
function splitArrayElements(text) {
  const out = [];
  let depth = 0, i = 0, start = 0;
  let prevSig = '';
  const tmpl = [];
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < text.length && text[i] !== q) i += text[i] === '\\' ? 2 : 1;
      i++; prevSig = q; continue;
    }
    if (c === '`') {
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '`') { i++; break; }
        if (text[i] === '$' && text[i + 1] === '{') { tmpl.push(depth); depth++; i += 2; break; }
        i++;
      }
      prevSig = '`'; continue;
    }
    if (c === '/' && text[i + 1] !== '/' && text[i + 1] !== '*' && /[(,=:[!&|?{};+\n]|^$/.test(prevSig)) {
      i++;
      let cls = false;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '[') cls = true;
        else if (text[i] === ']') cls = false;
        else if (text[i] === '/' && !cls) { i++; break; }
        else if (text[i] === '\n') break;
        i++;
      }
      while (i < text.length && /[a-z]/.test(text[i])) i++;
      prevSig = '/'; continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; prevSig = c; i++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (c === '}' && tmpl.length && tmpl[tmpl.length - 1] === depth) {
        tmpl.pop();
        i++;
        // resume the enclosing template literal
        while (i < text.length) {
          if (text[i] === '\\') { i += 2; continue; }
          if (text[i] === '`') { i++; break; }
          if (text[i] === '$' && text[i + 1] === '{') { tmpl.push(depth); depth++; i += 2; break; }
          i++;
        }
        prevSig = '`'; continue;
      }
      prevSig = c; i++; continue;
    }
    if (c === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1; i++; prevSig = ','; continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Extract the declared parameter list of a generated reducer element. */
function reducerParams(src) {
  if (/^[A-Za-z_$][\w$]*$/.test(src)) return { kind: 'named-reference', name: src, params: null };
  let m = /^\(([\s\S]*?)\)\s*=>/.exec(src);
  if (m) {
    const raw = m[1].trim();
    if (raw === '') return { kind: 'arrow', params: [] };
    return { kind: 'arrow', params: splitArrayElements(raw) };
  }
  m = /^([A-Za-z_$][\w$]*)\s*=>/.exec(src);
  if (m) return { kind: 'arrow', params: [m[1]] };
  m = /^function\s*[\w$]*\s*\(([\s\S]*?)\)/.exec(src);
  if (m) {
    const raw = m[1].trim();
    return { kind: 'function', params: raw === '' ? [] : splitArrayElements(raw) };
  }
  return { kind: 'unknown', params: null };
}

function classify(p) {
  if (p.params === null) {
    return { arity: null, reason: p.kind === 'named-reference' ? `bare named reference \`${p.name}\`` : 'unparsed expression' };
  }
  for (const prm of p.params) {
    if (prm.startsWith('...')) return { arity: null, reason: `rest param \`${prm}\`` };
    if (prm.startsWith('{') || prm.startsWith('[')) return { arity: null, reason: `destructured param \`${prm.slice(0, 30)}\`` };
    if (/=/.test(prm)) return { arity: null, reason: `default value \`${prm.slice(0, 30)}\`` };
  }
  return { arity: p.params.length, reason: null };
}

const TIERS = a =>
  a === null
    ? 'children+fields+raw+trivia+STATE (fail-open)'
    : [a >= 1 && 'children', a >= 2 && 'fields', a >= 4 && 'raw', a >= 5 && 'trivia', a >= 6 && 'STATE']
        .filter(Boolean).join('+') || 'none';

// ---------------------------------------------------------------------------
for (const [dialect, rel] of ARTIFACTS) {
  const src = readFileSync(path.join(ROOT, rel), 'utf8');
  const lines = src.split('\n');

  // instance slices
  const bounds = [];
  const re = new RegExp(`^const (${dialect}Grammar|${dialect}LineGrammar|${dialect}CstGrammar|${dialect}DiagnosticCstGrammar) =`);
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) bounds.push({ name: m[1], line: i });
  }
  bounds.push({ name: '<end>', line: lines.length });
  const sliceOf = n => {
    const i = bounds.findIndex(b => b.name === n);
    return { from: bounds[i].line, to: bounds[i + 1].line };
  };
  const ast = sliceOf(`${dialect}Grammar`);
  const cst = sliceOf(`${dialect}CstGrammar`);

  // ---- build[] reducer table (AST instance) --------------------------------
  let bStart = -1;
  for (let i = ast.from; i < ast.to; i++) {
    if (/^\tconst _[0-9a-f]{8}__build = \[$/.test(lines[i])) { bStart = i; break; }
  }
  let bEnd = -1;
  for (let i = bStart + 1; i < ast.to; i++) {
    if (lines[i] === '\t];') { bEnd = i; break; }
  }
  const buildText = lines.slice(bStart + 1, bEnd).join('\n');
  const elements = splitArrayElements(buildText);
  const reducers = elements.map((e, idx) => {
    const p = reducerParams(e);
    const c = classify(p);
    return { idx, src: e, kind: p.kind, params: p.params, ...c };
  });

  // ---- function spans in the AST slice -------------------------------------
  const fns = [];
  let cur = null;
  for (let i = ast.from; i < ast.to; i++) {
    const m = /^\tfunction (_r_[A-Za-z0-9_]+|_[0-9a-f]{8}__(?:pf|tf)\d+)\(/.exec(lines[i]);
    if (m) { cur = { name: m[1], start: i, end: null }; continue; }
    if (cur && lines[i] === '\t}') { cur.end = i; fns.push(cur); cur = null; }
  }
  const fnAt = ln => fns.find(f => ln >= f.start && ln <= f.end);

  // direct-caller map for attribution
  const callers = new Map();
  for (const f of fns) {
    const body = lines.slice(f.start, f.end + 1).join('\n');
    for (const m of body.matchAll(/\b(_r_[A-Za-z0-9_]+|_[0-9a-f]{8}__(?:pf|tf)\d+)\(input/g)) {
      if (m[1] === f.name) continue;
      if (!callers.has(m[1])) callers.set(m[1], new Set());
      callers.get(m[1]).add(f.name);
    }
  }
  const owners = start => {
    const out = new Set(); const seen = new Set(); const stack = [start];
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n)) continue; seen.add(n);
      for (const c of callers.get(n) ?? []) {
        if (c.startsWith('_r_')) out.add(c); else stack.push(c);
      }
    }
    return [...out];
  };

  console.log(`\n${'='.repeat(78)}\n=== ${dialect.toUpperCase()} — ${rel}`);
  console.log(`reducers in build[]: ${reducers.length}`);
  const byArity = new Map();
  for (const r of reducers) byArity.set(r.arity, (byArity.get(r.arity) ?? 0) + 1);
  console.log('  arity histogram: ' + [...byArity.entries()]
    .sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99))
    .map(([a, n]) => `${a === null ? 'UNCONFIRMED' : a}=${n}`).join('  '));

  // ---- 1. _ctx.state clone sites -------------------------------------------
  const clones = [];
  for (let i = ast.from; i < ast.to; i++) {
    if (!lines[i].includes('Object.assign({}, _ctx.state)')) continue;
    const f = fnAt(i);
    let bidx = null;
    for (let j = i; j < Math.min(i + 30, ast.to); j++) {
      const m = /__build\[(\d+)\]\(/.exec(lines[j]);
      if (m) { bidx = Number(m[1]); break; }
    }
    clones.push({ line: i + 1, fn: f?.name ?? '?', owners: f ? (f.name.startsWith('_r_') ? [f.name] : owners(f.name)) : [], build: bidx });
  }
  console.log(`\n--- 1. _ctx.state CLONE SITES: ${clones.length}`);
  for (const c of clones) {
    const r = c.build === null ? null : reducers[c.build];
    console.log(
      `  :${String(c.line).padStart(6)}  build[${String(c.build).padStart(3)}] arity=${r ? (r.arity ?? 'UNCONFIRMED') : '?'}` +
      `${r && r.reason ? ` (${r.reason})` : ''}  params=(${r && r.params ? r.params.join(', ') : '?'})` +
      `\n            in ${c.fn}  owners=${c.owners.slice(0, 4).join(',') || '-'}`
    );
  }

  // ---- 2. unconfirmable arity ----------------------------------------------
  const unconfirmed = reducers.filter(r => r.arity === null);
  console.log(`\n--- 2. REDUCERS WITH UNCONFIRMABLE ARITY (fail open to all five tiers): ${unconfirmed.length}`);
  for (const r of unconfirmed) {
    console.log(`  build[${String(r.idx).padStart(3)}]  ${r.reason}  :: ${r.src.slice(0, 110).replace(/\n\s*/g, ' ')}`);
  }

  // ---- 3. underscore-prefixed trailing params ------------------------------
  const underscored = reducers.filter(r => r.params && r.params.some(p => p.startsWith('_')));
  console.log(`\n--- 3. REDUCERS WITH UNDERSCORE-PREFIXED ("unused") PARAMS: ${underscored.length}`);
  for (const r of underscored) {
    const trailing = [...r.params].reverse().findIndex(p => !p.startsWith('_'));
    const wasted = trailing === -1 ? r.params.length : trailing;
    console.log(
      `  build[${String(r.idx).padStart(3)}] arity=${r.arity} -> ${TIERS(r.arity)}` +
      `   params=(${r.params.join(', ')})` +
      (wasted > 0 ? `   [${wasted} trailing underscore param(s) still charged]` : '')
    );
  }
  const costlyUnderscore = underscored.filter(r => {
    const trailing = [...r.params].reverse().findIndex(p => !p.startsWith('_'));
    return (trailing === -1 ? r.params.length : trailing) > 0;
  });
  console.log(`  -> ${costlyUnderscore.length} of them pay for capture tiers they declare only to ignore:`);
  for (const r of costlyUnderscore) {
    const eff = r.params.length - [...r.params].reverse().findIndex(p => !p.startsWith('_'));
    console.log(`       build[${r.idx}] declared arity=${r.arity} -> ${TIERS(r.arity)}   but only ${eff} param(s) used -> ${TIERS(eff)}`);
  }

  // ---- 3b. capture tiers actually forced at node-emission sites ------------
  const siteTier = { children: 0, fields: 0, raw: 0, trivia: 0, state: 0, total: 0, failOpen: 0 };
  for (let i = ast.from; i < ast.to; i++) {
    const m = /__build\[(\d+)\]\(/.exec(lines[i]);
    if (!m) continue;
    const r = reducers[Number(m[1])];
    if (!r) continue;
    siteTier.total++;
    const a = r.arity;
    if (a === null) { siteTier.failOpen++; siteTier.children++; siteTier.fields++; siteTier.raw++; siteTier.trivia++; siteTier.state++; continue; }
    if (a >= 1) siteTier.children++;
    if (a >= 2) siteTier.fields++;
    if (a >= 4) siteTier.raw++;
    if (a >= 5) siteTier.trivia++;
    if (a >= 6) siteTier.state++;
  }
  console.log(`\n--- 3b. NODE-EMISSION SITES BY FORCED CAPTURE TIER (of ${siteTier.total} sites)`);
  console.log(`  children=${siteTier.children}  fields=${siteTier.fields}  raw=${siteTier.raw}  trivia=${siteTier.trivia}  state=${siteTier.state}   (fail-open sites=${siteTier.failOpen})`);

  // ---- 4. first-set guards AST vs CST --------------------------------------
  const guardsIn = (from, to) => {
    const map = new Map();
    let f = null;
    for (let i = from; i < to; i++) {
      const m = /^\tfunction (_r_[A-Za-z0-9_]+|_[0-9a-f]{8}__(?:pf|tf)(\d+))\(/.exec(lines[i]);
      if (m) { f = m[2] !== undefined ? `__pf${m[2]}` : m[1]; if (!map.has(f)) map.set(f, 0); continue; }
      // NB: match the DECLARATION only. `/_ngc\d+\s*=/` also matches the
      // `_ngcN === 32` comparisons the guard expands into and roughly doubles
      // the count.
      if (f && /const _ngc\d+ = _pos < input\.length/.test(lines[i])) map.set(f, map.get(f) + 1);
      if (lines[i] === '\t}') f = null;
    }
    return map;
  };
  const ga = guardsIn(ast.from, ast.to);
  const gc = guardsIn(cst.from, cst.to);
  const totA = [...ga.values()].reduce((a, b) => a + b, 0);
  const totC = [...gc.values()].reduce((a, b) => a + b, 0);
  console.log(`\n--- 4. FIRST-SET GUARD SITES: AST=${totA}  CST=${totC}  (delta ${totA - totC})`);
  const names = new Set([...ga.keys(), ...gc.keys()]);
  for (const n of names) {
    const a = ga.get(n) ?? 0, c = gc.get(n) ?? 0;
    if (a !== c) {
      const own = n.startsWith('_r_') ? [n] : owners(fns.find(f => f.name.endsWith(n.slice(2)))?.name ?? n);
      console.log(`    ${n}: AST=${a} CST=${c}   owners=${own.slice(0, 4).join(',') || '-'}`);
    }
  }
}
