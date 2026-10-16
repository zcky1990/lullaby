const token = crypto.randomUUID().replace(/-/g, "");

export const APP_TOKEN_COOKIE = "app_token";
export const APP_TOKEN_HEADER = "x-app-token";

export function appToken(): string {
  return token;
}
