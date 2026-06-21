/**
 * Return the start offset of a trailing `!important` annotation in already
 * extracted declaration text, or `-1` when the value has no such suffix.
 */
export function findTrailingImportantStart(value: string): number {
  const trimmed = value.trimEnd();
  const marker = '!important';
  if (!trimmed.toLowerCase().endsWith(marker)) {
    return -1;
  }
  return trimmed.length - marker.length;
}
