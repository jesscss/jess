/**
 * @deprecated This package is part of the legacy Jess “parser/plugin” architecture.
 *
 * The current Jess compiler pipeline lives in the `jess` package (see `Compiler`),
 * and the actively maintained parsers are in `@jesscss/css-parser` and `@jesscss/less-parser`.
 *
 * This package is kept as a compatibility placeholder and currently re-exports
 * `@jesscss/css-parser`.
 */
export const LEGACY_NOTICE =
  'Legacy package: use `jess` (Compiler) and `@jesscss/css-parser` / `@jesscss/less-parser` instead.';

export * from '@jesscss/css-parser';