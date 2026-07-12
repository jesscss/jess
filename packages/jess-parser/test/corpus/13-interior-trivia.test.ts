/**
 * Corpus 13 — INTERIOR trivia ratchet.
 *
 * Guards the SelectorCapture-class regression (fixed in be826ec02): a rule whose
 * compiled body baked NO trivia-skip because its wrapper was dropped during
 * grammar-thinning. The existing corpus mostly uses GLUED interiors, so an
 * interior-trivia break can slip through unnoticed. Each case here injects
 * whitespace / a block comment / a `//` line comment at an INTERIOR boundary of
 * a Jess construct and asserts it parses with zero errors.
 *
 * NOTE on the compiled trivia model (see docs/future/parseman-trivia-audit.md):
 * parseman's compiled path resolves trivia STATICALLY at compile time — a named
 * rule bakes the trivia parser active at its first-reference compile point, and
 * `compose()` fuses rule bodies by name without recompiling. So interior-trivia
 * tolerance is per-rule and must be verified empirically, not reasoned from "rw
 * is set at the top".
 */
import { describe, it } from 'vitest';
import { parse } from './_util.js';

const ok: Array<[string, string]> = [
  ['var: ws around colon',            '$color :  red ;'],
  ['var: block comment before value', '$color: /* c */ red;'],
  ['var: line comment before value',  '$color: // hi\n red;'],
  ['collection: ws interior',         '$m: {  a :  1 ;  b : 2 ; } ;'],
  ['collection: block comment',       '$m: { a: 1; /* c */ b: 2; };'],
  ['collection: line comment',        '$m: { a: 1; // note\n b: 2; };'],
  ['collection: nested ws',           '$m: { a: {  x : 1 ; } ; };'],
  ['mixin: ws params + body',         '.m (  $a : 1 ,  $b : 2  ) {  color :  red ; }'],
  ['mixin: block comment body',       '.m($a) { /* c */ color: red; }'],
  ['mixin: line comment body',        '.m($a) { // c\n color: red; }'],
  ['if: ws interior',                 '$if (  $x  =  1  ) {  color : red ; }'],
  ['if: else ws',                     '$if ($x) { a: 1; }  $else  {  b : 2 ; }'],
  ['for: ws interior',                '$for (  $x  of  1 to 3  ) {  a : $x ; }'],
  ['while: ws interior',              '$while (  $x  ) {  a : 1 ; }'],
  ['extend: ws interior',             '$extend  .a ,  .b  !exact ;'],
  ['apply: ws interior',              '$apply  .rounded ,  .shadow ;'],
  ['selectorcapture: interior ws',    '$t: *[ .notice ] ;'],
  ['selectorcapture: complex ws',     '$t: *[ .a  .b ,  .c ] ;'],
  ['anon mixin: ws body',             '$m: @( $a : 1 ) {  color : red ; } ;'],
  ['anon fn: ws expr body',           '$m: @( $a ) >  $( $a + 1 ) ;'],
  ['anon mixin: block comment body',  '$m: @() { /* c */ color: red; };'],
  ['mixincall: ws interior',          '$ > .a  >  .b (  1 ,  2  ) ;'],
  ['compose: ws',                     '@-compose  \'p\'  as ns ;'],
  ['from: ws interior',               '@-from  \'p\'  import (  a  as  b  ) ;'],
  ['ruleset: interior ws',            '.a {  color :  red ; }'],
  ['ruleset: line comment',           '.a { // c\n color: red; }'],
  ['nested ruleset ws',               '.a {  .b {  x : 1 ; } }']
];

describe('corpus/interior-trivia', () => {
  for (const [label, src] of ok) {
    it(label, () => {
      parse(src);
    });
  }
});
