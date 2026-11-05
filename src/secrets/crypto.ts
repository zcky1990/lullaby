const ENC_PREFIX = "enc:v1:";
const IV_BYTES = 12;

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  const keyData = new Uint8Array(raw);
  return await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptString(plaintext: string, keyBytes: Uint8Array): Promise<string> {
  if (!plaintext || isEncryptedSecret(plaintext)) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await importAesKey(keyBytes);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv, 0);
  combined.set(cipher, iv.length);
  return ENC_PREFIX + toBase64(combined);
}

export async function decryptString(value: string, keyBytes: Uint8Array): Promise<string> {
  if (!value || !isEncryptedSecret(value)) return value;
  const combined = fromBase64(value.slice(ENC_PREFIX.length));
  if (combined.length <= IV_BYTES) {
    throw new Error("invalid ciphertext");
  }
  const iv = combined.slice(0, IV_BYTES);
  const cipher = combined.slice(IV_BYTES);
  const key = await importAesKey(keyBytes);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}
