/**
 * Chunked key/value storage, factored out of the Supabase client so it can be
 * tested without a device.
 *
 * WHY IT EXISTS: `expo-secure-store` documents a 2048-byte ceiling per value
 * and warns that larger writes may fail. A Supabase session is an access token,
 * a refresh token and a serialised user, which routinely exceeds that — so the
 * session has to be split across several entries.
 *
 * This file imports nothing from React Native or Expo on purpose. The backing
 * store is a parameter, which is what makes the torn-write and stale-chunk
 * behaviour below verifiable by execution rather than by argument.
 */

/**
 * 1024 is deliberately well under the 2048 ceiling rather than just under it:
 * the value written is `encodeURIComponent` output, which is ASCII, so one
 * character is one byte and the margin is real rather than a guess about how
 * much multi-byte text might expand.
 */
export const CHUNK_SIZE = 1024;

/** The subset of `expo-secure-store` this needs. */
export interface KeyValueBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** The shape supabase-js expects from a custom `auth.storage`. */
export interface ChunkedStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Splits values across `key.0`, `key.1`, … with `key` itself holding the chunk
 * count.
 *
 * THE WRITE ORDER IS THE POINT. The manifest is set to "0" BEFORE any chunk is
 * written and to the real count only once every chunk has landed, so an
 * interruption anywhere in the middle leaves a session that reads back as
 * absent rather than as a half-updated one.
 *
 * That asymmetry is deliberate: losing a session costs one sign-in, whereas a
 * torn one is an access token whose refresh half no longer matches it, which
 * surfaces later as an inexplicable sign-out on a device that looked fine.
 */
export function createChunkedStorage(backend: KeyValueBackend): ChunkedStorage {
  return {
    async getItem(key: string): Promise<string | null> {
      const manifest = await backend.getItemAsync(key);
      if (manifest === null) return null;

      const count = Number(manifest);
      // 0 is the mid-write marker, not an empty value. Both it and anything
      // unparseable mean there is no session to hand back.
      if (!Number.isInteger(count) || count <= 0) return null;

      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await backend.getItemAsync(`${key}.${i}`);
        // A missing chunk means the write was interrupted after the manifest
        // was trusted. Fail closed rather than returning a prefix, which in
        // unlucky cases still parses as valid JSON.
        if (part === null) return null;
        parts.push(part);
      }

      return decodeURIComponent(parts.join(""));
    },

    async setItem(key: string, value: string): Promise<void> {
      // ASCII output, so slicing by character is slicing by byte.
      const encoded = encodeURIComponent(value);
      const chunks: string[] = [];
      for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
        chunks.push(encoded.slice(i, i + CHUNK_SIZE));
      }
      // An empty value would otherwise write zero chunks and a "0" manifest,
      // which getItem cannot distinguish from a mid-write.
      if (chunks.length === 0) chunks.push("");

      const previousCount = Number(await backend.getItemAsync(key)) || 0;

      await backend.setItemAsync(key, "0");
      for (let i = 0; i < chunks.length; i++) {
        await backend.setItemAsync(`${key}.${i}`, chunks[i]!);
      }
      // A shorter session would otherwise leave orphaned chunks that the next,
      // longer session would read back as its own tail.
      for (let i = chunks.length; i < previousCount; i++) {
        await backend.deleteItemAsync(`${key}.${i}`);
      }
      await backend.setItemAsync(key, String(chunks.length));
    },

    async removeItem(key: string): Promise<void> {
      const count = Number(await backend.getItemAsync(key)) || 0;
      for (let i = 0; i < count; i++) {
        await backend.deleteItemAsync(`${key}.${i}`);
      }
      await backend.deleteItemAsync(key);
    },
  };
}
