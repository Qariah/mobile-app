/**
 * PKCE helpers — RFC 7636.
 *
 * Generates a cryptographically random code_verifier (43–128 chars from the
 * unreserved set), and the corresponding code_challenge (BASE64URL(SHA256(verifier))).
 *
 * Uses expo-crypto for randomness + SHA-256 (works in Hermes; no Node crypto).
 */

import * as Crypto from 'expo-crypto';

/** RFC 7636 §4.1: code_verifier = 43-128 chars from [A-Z][a-z][0-9]-._~ */
function bytesToUrlSafeBase64(bytes: Uint8Array): string {
  // Manual base64-url encode without depending on Buffer.
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  // btoa is available in Hermes via React Native polyfills.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b64 = (globalThis as any).btoa(binary) as string;
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  // 32 random bytes → 43 base64url chars (within RFC 7636 bounds).
  const bytes = Crypto.getRandomValues(new Uint8Array(32));
  return bytesToUrlSafeBase64(bytes);
}

/** Hex-string randomness for `state` and `nonce`. 16 bytes → 32 hex chars. */
export function generateRandomHex(byteLen = 16): string {
  const bytes = Crypto.getRandomValues(new Uint8Array(byteLen));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    {encoding: Crypto.CryptoEncoding.BASE64},
  );
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
