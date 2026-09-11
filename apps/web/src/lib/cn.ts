type ClassValue = string | false | null | undefined | 0 | 0n;

/** Join truthy class names. No runtime dependency. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ');
}
