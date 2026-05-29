export function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
