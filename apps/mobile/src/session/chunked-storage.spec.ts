import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, createChunkedStorage, type KeyValueBackend } from "./chunked-storage";

/**
 * Stands in for expo-secure-store. `failAfter` lets a write be cut off part way
 * through, which is the case that actually matters: a phone killed mid-save is
 * ordinary, and the difference between losing a session and corrupting one is
 * entirely in the write ordering.
 */
function makeBackend(failAfter = Infinity) {
  const store = new Map<string, string>();
  let writes = 0;
  const backend: KeyValueBackend = {
    async getItemAsync(key) {
      return store.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      if (++writes > failAfter) throw new Error("interrupted");
      store.set(key, value);
    },
    async deleteItemAsync(key) {
      store.delete(key);
    },
  };
  return { backend, store };
}

/** A session-shaped value: mostly ASCII JWT, comfortably over one chunk. */
function sessionOfLength(n: number): string {
  return JSON.stringify({ access_token: "a".repeat(n), refresh_token: "r".repeat(64) });
}

const KEY = "sb-houicgsdduzzcarxkuuo-auth-token";

describe("chunked secure storage", () => {
  it("round-trips a value larger than the SecureStore ceiling", async () => {
    const { backend } = makeBackend();
    const storage = createChunkedStorage(backend);
    const value = sessionOfLength(4000);

    await storage.setItem(KEY, value);

    expect(await storage.getItem(KEY)).toBe(value);
  });

  it("keeps every stored entry under the 2048-byte ceiling", async () => {
    const { backend, store } = makeBackend();
    const storage = createChunkedStorage(backend);

    await storage.setItem(KEY, sessionOfLength(9000));

    // The reason the whole file exists. A single entry over the limit is a
    // write expo-secure-store is documented to be allowed to reject.
    for (const [k, v] of store) {
      expect(Buffer.byteLength(v, "utf8"), `entry ${k}`).toBeLessThanOrEqual(2048);
    }
  });

  it("survives non-ASCII content without exceeding the ceiling", async () => {
    const { backend, store } = makeBackend();
    const storage = createChunkedStorage(backend);
    // Azerbaijani text is 2 bytes per character in UTF-8. Slicing the RAW
    // string by character would put ~2048 bytes in a 1024-char chunk; slicing
    // the percent-encoded form cannot.
    const value = JSON.stringify({ note: "sakit pərvanə çox gözəl ağıllı ".repeat(200) });

    await storage.setItem(KEY, value);

    expect(await storage.getItem(KEY)).toBe(value);
    for (const [k, v] of store) {
      expect(Buffer.byteLength(v, "utf8"), `entry ${k}`).toBeLessThanOrEqual(2048);
    }
  });

  it("reads back absent, not torn, when a write is interrupted", async () => {
    const { backend, store } = makeBackend();
    const storage = createChunkedStorage(backend);
    await storage.setItem(KEY, sessionOfLength(4000));
    const chunkCount = Number(store.get(KEY));
    expect(chunkCount).toBeGreaterThan(1);

    // Cut off after the manifest is zeroed and one chunk has landed.
    const interrupted = createChunkedStorage(makeBackendOver(store, 2));
    await expect(interrupted.setItem(KEY, sessionOfLength(5000))).rejects.toThrow();

    // The old session is gone — that is the deliberate trade — but nothing
    // returns a mix of old and new halves.
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it("does not read a stale tail when the new value is shorter", async () => {
    const { backend, store } = makeBackend();
    const storage = createChunkedStorage(backend);

    await storage.setItem(KEY, sessionOfLength(5000));
    const longCount = Number(store.get(KEY));

    const short = sessionOfLength(100);
    await storage.setItem(KEY, short);

    expect(await storage.getItem(KEY)).toBe(short);
    // The orphans must actually be deleted, not merely unreferenced: a later,
    // longer session would otherwise read one of them back as its own tail.
    for (let i = Number(store.get(KEY)); i < longCount; i++) {
      expect(store.has(`${KEY}.${i}`), `orphan chunk ${i}`).toBe(false);
    }
  });

  it("treats a zero manifest as no session rather than an empty one", async () => {
    const { backend, store } = makeBackend();
    const storage = createChunkedStorage(backend);
    store.set(KEY, "0");

    expect(await storage.getItem(KEY)).toBeNull();
  });

  it("treats a missing chunk as no session", async () => {
    const { backend, store } = makeBackend();
    const storage = createChunkedStorage(backend);
    await storage.setItem(KEY, sessionOfLength(4000));

    store.delete(`${KEY}.1`);

    expect(await storage.getItem(KEY)).toBeNull();
  });

  it("round-trips an empty string rather than losing it to the zero marker", async () => {
    const { backend } = makeBackend();
    const storage = createChunkedStorage(backend);

    await storage.setItem(KEY, "");

    expect(await storage.getItem(KEY)).toBe("");
  });

  it("removes every chunk on sign-out, leaving no credential behind", async () => {
    const { backend, store } = makeBackend();
    const storage = createChunkedStorage(backend);
    await storage.setItem(KEY, sessionOfLength(6000));
    expect(store.size).toBeGreaterThan(2);

    await storage.removeItem(KEY);

    // A leftover chunk is a fragment of a refresh token sitting in the
    // Keychain after the user believed they signed out.
    expect(store.size).toBe(0);
  });

  it("returns null for a key never written", async () => {
    const { backend } = makeBackend();
    expect(await createChunkedStorage(backend).getItem(KEY)).toBeNull();
  });

  it("splits at the documented chunk size", async () => {
    const { backend, store } = makeBackend();
    const storage = createChunkedStorage(backend);
    // Pure ASCII, so encodeURIComponent is identity and the arithmetic is exact.
    const value = "a".repeat(CHUNK_SIZE * 3);

    await storage.setItem(KEY, value);

    expect(Number(store.get(KEY))).toBe(3);
    expect(store.get(`${KEY}.0`)).toHaveLength(CHUNK_SIZE);
  });
});

/** Reuses an existing store so a second, failing writer sees the first's state. */
function makeBackendOver(store: Map<string, string>, failAfter: number): KeyValueBackend {
  let writes = 0;
  return {
    async getItemAsync(key) {
      return store.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      if (++writes > failAfter) throw new Error("interrupted");
      store.set(key, value);
    },
    async deleteItemAsync(key) {
      store.delete(key);
    },
  };
}
