export const SECRET_MASK = "••••••••";
export const SECRET_CONFIG_KEYS = new Set([
  "apiKey",
  "apiToken",
  "token",
  "password",
  "secret",
]);

export function isMaskedSecret(value: unknown): boolean {
  return value === undefined || value === null || value === "" || value === SECRET_MASK;
}
