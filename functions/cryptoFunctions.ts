import { webcrypto } from 'crypto';

const { subtle } = webcrypto;

export const AESGCMEncrypt = async (
  plaintext: string,
  keyBytes: Uint8Array,
  iv: Uint8Array,
) => {
  // Import key for encryption
  const key = await subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );

  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  return Buffer.from(encrypted).toString('base64');
};

export const AESGCMDecrypt = async (
  ciphertextBase64: string,
  keyBytes: Uint8Array,
  iv: Uint8Array,
) => {
  const key = await subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  const encryptedBytes = Uint8Array.from(
    Buffer.from(ciphertextBase64, 'base64'),
  );

  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encryptedBytes,
  );

  return new TextDecoder().decode(decrypted);
};
