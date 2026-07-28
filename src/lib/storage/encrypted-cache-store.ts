import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ValidationError } from "../errors.js";
import type { CacheStore } from "./cache-store.js";

function decodeKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) {
    throw new ValidationError("Cache encryption key must be 32 bytes encoded as base64.");
  }
  return key;
}

export class EncryptedCacheStore implements CacheStore {
  private readonly key: Buffer;

  constructor(
    private readonly store: CacheStore,
    encryptionKeyBase64: string,
  ) {
    this.key = decodeKey(encryptionKeyBase64);
  }

  async get(key: string): Promise<string | null> {
    const envelope = await this.store.get(key);
    if (!envelope) return null;
    try {
      const [ivValue, tagValue, ciphertextValue] = envelope.split(".");
      if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Invalid envelope.");
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivValue, "base64url"));
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      await this.store.delete(key);
      throw new ValidationError("Encrypted cache entry could not be authenticated.", {
        cause: error,
      });
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const envelope = [
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
    await this.store.set(key, envelope, ttlSeconds);
  }

  delete(key: string): Promise<void> {
    return this.store.delete(key);
  }

  deleteMatching(pattern: string): Promise<number> {
    return this.store.deleteMatching?.(pattern) ?? Promise.resolve(0);
  }
}
