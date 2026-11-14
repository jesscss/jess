/**
 * The bodies of Less built-ins that a generated runtime module calls directly,
 * where it proves each argument's kind at build time (DESIGN-DECISIONS-NOTES.md, "Direct body calls"). Each is
 * the one body its defined function is `define` over, so the page bundles the
 * body and not the definer. Not a stylesheet module: `@less.*` reads
 * `@jesscss/fns/less`.
 */
export { lightnessOf } from './lightness.js';
