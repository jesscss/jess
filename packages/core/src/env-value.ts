/**
 * An environment variable's value, or undefined where there is no `process`
 * or reading it is not allowed (Deno without env permission throws on the
 * read; the variable is then simply unset).
 */
export const envValue = (name: string): string | undefined => {
  try {
    return typeof process === 'undefined' ? undefined : process.env?.[name];
  } catch {
    return undefined;
  }
};

/*
 * [lookup-memo] Negative control: `JESS_NO_DECLMAP_MEMO=1` disables the member-lookup
 * DeclMap memo (`ast/serialize.ts`) so a measurement can reproduce the un-memoized
 * rebuild/dispatch counts.
 */
export const DECLMAP_MEMO_ENABLED = envValue('JESS_NO_DECLMAP_MEMO') !== '1';
