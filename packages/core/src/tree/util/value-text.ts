export function valueText(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'valueOf' in value) {
    return String(value.valueOf());
  }
  return typeof value === 'string'
    ? value
    : String(value);
}
