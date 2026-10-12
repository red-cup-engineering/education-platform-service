/** Consumer policy for treating one flat metadata value as a string set. */
export function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((item) => item.length > 0);
  return value.length > 0 ? [value] : [];
}
