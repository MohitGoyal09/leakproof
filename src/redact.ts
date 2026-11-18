export const MASK = "•••";

/** Each secret as typed, JSON-escaped (raw NDJSON) and URL-encoded (HAR, query strings). */
function forms(secret: string): string[] {
  return [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];
}

/** Replace every secret value (3+ characters) with a mask. Used on anything Kane or the page wrote. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  // Longest first, so a short secret ("demo") never leaves part of a longer one ("demo123") visible.
  const needles = [...new Set(secrets.filter((s) => s.length >= 3).flatMap(forms))].sort((a, b) => b.length - a.length);
  return needles.reduce((t, s) => t.split(s).join(MASK), text);
}
