import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize, Root } from '../../../tree2/index.js';
import { bridgeToTree2 } from '../../bridge.js';
import { runFunctionalParseT2 } from '../../dispatch-host.js';

/**
 * [tree2-native] F14 byte-identity: the registry-driven dispatch host (with the
 * at-rules BLOCK family registered) produces the SAME serialized CSS as the
 * parse→legacy-tree→bridge path for block at-rules, query-condition preludes,
 * keyframes, unknown block at-rules, and nested (bubbling) at-rules inside
 * rulesets. Seeded from the bridge's `atrule-byte-identity` /
 * `atrule-bubbling-projection` shapes. The block-less statement surface
 * (`@charset` / `@namespace` / `@layer a, b;`) and `@import` belong to the
 * charset/raw-statement + import families and are out of scope here.
 */
const g = lessGrammar as Record<string, unknown>;

function tree2Direct(src: string): Root {
  const { root } = runFunctionalParseT2(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) throw new Error('f14: no root produced');
  return root;
}

function viaBridge(src: string): Root {
  return bridgeToTree2(parseLessFn(src).tree, src) as unknown as Root;
}

const inputs: Array<[string, string]> = [
  // ── directive block at-rules (no selector propagation) ──
  ['font-face', "@font-face { font-family: xecret; src: url('a.ttf'); }\n"],
  ['page-noprelude', '@page { margin: 2cm; size: A4; }\n'],
  ['page-prelude', '@page :first { margin: 3cm; }\n'],
  ['counter-style', '@counter-style my-counter { system: fixed; suffix: ". "; }\n'],
  ['keyframes', '@keyframes slidein { from { margin-left: 100%; } to { margin-left: 0%; } }\n'],
  ['keyframes-string', '@keyframes "anim" { 0% { opacity: 0; } 100% { opacity: 1; } }\n'],
  ['vendor-keyframes', '@-moz-keyframes spin { from { top: 0; } to { top: 10px; } }\n'],
  // ── conditional-group (query) block at-rules ──
  ['media-simple', '@media print { .a { color: red; } }\n'],
  ['media-query-condition', '@media screen and (min-width: 100px) { .a { color: red; } }\n'],
  ['media-list', '@media screen, print { .a { color: red; } }\n'],
  ['media-deep', '@media print { .a { .b { width: 1px; } } }\n'],
  ['supports', '@supports (display: grid) { .a { color: red; } }\n'],
  ['supports-not', '@supports not (display: grid) { .a { color: red; } }\n'],
  ['container', '@container (min-width: 200px) { .a { color: red; } }\n'],
  ['container-named', '@container sidebar (min-width: 200px) { .a { color: red; } }\n'],
  ['layer-block', '@layer base { .a { color: red; } }\n'],
  ['uppercase-name', '@MEDIA screen { .a { color: red; } }\n'],
  // ── unknown / nested block at-rules ──
  ['unknown-block', '@unknown foo 42 { x { y: z; } }\n'],
  ['nested-atrule', '@supports (a: b) { @font-face { font-family: x; } }\n'],
  ['atrule-with-direct-and-nested', '@page { margin: 2cm; @top-left { content: "x"; } }\n'],
  ['empty-block-dropped', '@media screen { }\n'],
  // ── nested at-rules inside rulesets (serializer bubbles them) ──
  ['bubbling-media', '.a { color: red; @media screen { color: blue; } }\n'],
  ['bubbling-media-nested-rule', '.parent { color: green; @media print { .child { color: red; } } }\n'],
  ['bubbling-supports', '.top { @supports (a: b) { .inside { property: value; } } }\n'],
  ['bubbling-directive', '.onTop { @font-face { font-family: something; } }\n'],
];

describe('[tree2-native] F14 at-rules host byte-identity vs bridge', () => {
  for (const [name, src] of inputs) {
    it(name, () => {
      const direct = serialize(tree2Direct(src)).css;
      const bridged = serialize(viaBridge(src)).css;
      if (direct !== bridged) {
        // eslint-disable-next-line no-console
        console.log(`\n--- ${name} ---\nSRC:    ${JSON.stringify(src)}\nDIRECT: ${JSON.stringify(direct)}\nBRIDGE: ${JSON.stringify(bridged)}`);
      }
      expect(direct).toBe(bridged);
    });
  }
});
