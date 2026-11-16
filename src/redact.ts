export const MASK = "•••";

/** Replace every secret value (3+ characters) with a mask. Used on anything Kane or the page wrote. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  return secrets.filter((s) => s.length >= 3).reduce((t, s) => t.split(s).join(MASK), text);
}
