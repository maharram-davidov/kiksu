import { describe, expect, it } from "vitest";
import {
  credentialMatches, hashCredential, normaliseCredential,
} from "../src/modules/onboarding/credential-hash";
import {
  canChangeHandle, formatHandle, generateCandidate, generateHandle, namespaceSize,
} from "../src/modules/onboarding/handle-generator";

const PEPPER = "test-pepper-that-is-long-enough-to-pass-32";

describe("credential hashing", () => {
  it("is deterministic, which is what makes one-person-one-account enforceable", () => {
    const a = hashCredential("university_email", "ad.soyad@std.bsu.edu.az", PEPPER);
    const b = hashCredential("university_email", "ad.soyad@std.bsu.edu.az", PEPPER);
    expect(a).toBe(b);
  });

  it("separates credential kinds so an email and a card id cannot collide", () => {
    const email = hashCredential("university_email", "12345", PEPPER);
    const card = hashCredential("student_card", "12345", PEPPER);
    expect(email).not.toBe(card);
  });

  it("changes completely under a different pepper", () => {
    const a = hashCredential("university_email", "x@std.bsu.edu.az", PEPPER);
    const b = hashCredential("university_email", "x@std.bsu.edu.az", PEPPER + "-rotated");
    expect(a).not.toBe(b);
  });

  it("refuses a pepper short enough to brute-force", () => {
    expect(() => hashCredential("university_email", "x@y.az", "short")).toThrow();
  });

  it("carries a version prefix so the pepper can be rotated without a flag day", () => {
    expect(hashCredential("university_email", "x@std.bsu.edu.az", PEPPER)).toMatch(/^v1:/);
  });

  // The Azerbaijani dotted/dotless i. Under an `az` locale "I".toLowerCase()
  // yields "ı", so the same student on an Azerbaijani-set phone would hash
  // differently from the same student on an English one.
  describe("Azerbaijani dotted/dotless i", () => {
    it("folds dotted capital İ to plain i", () => {
      expect(normaliseCredential("İLKİN@std.bsu.edu.az")).toBe("ilkin@std.bsu.edu.az");
    });

    it("folds dotless ı to plain i", () => {
      expect(normaliseCredential("ılkın@std.bsu.edu.az")).toBe("ilkin@std.bsu.edu.az");
    });

    it("hashes the same student identically however their device cases the address", () => {
      const variants = [
        "ilkin.aliyev@std.bsu.edu.az",
        "İLKİN.ALİYEV@std.bsu.edu.az",
        "Ilkin.Aliyev@std.bsu.edu.az",
        "ılkın.alıyev@std.bsu.edu.az",
        "  ilkin.aliyev@std.bsu.edu.az  ",
      ].map((v) => hashCredential("university_email", v, PEPPER));
      expect(new Set(variants).size).toBe(1);
    });

    it("does not survive an az-locale lowercase, which is the bug being guarded", () => {
      // Demonstrates the hazard directly: had normalisation used
      // toLocaleLowerCase("az"), "I" would become "ı" and diverge.
      expect("I".toLocaleLowerCase("az")).toBe("ı");
      expect("I".toLowerCase()).toBe("i");
      // Our normaliser must agree with the invariant form.
      expect(normaliseCredential("I")).toBe("i");
    });
  });

  it("compares in constant time and still returns the right answer", () => {
    const a = hashCredential("university_email", "a@std.bsu.edu.az", PEPPER);
    expect(credentialMatches(a, a)).toBe(true);
    expect(credentialMatches(a, hashCredential("university_email", "b@std.bsu.edu.az", PEPPER))).toBe(false);
    expect(credentialMatches(a, "short")).toBe(false);
  });
});

describe("handle generation", () => {
  it("produces the design's shape", () => {
    for (let i = 0; i < 200; i++) {
      expect(formatHandle(generateCandidate())).toMatch(/^[a-zəğıöşüç]+-[a-zəğıöşüç]+-\d{2}$/u);
    }
  });

  it("has a namespace large enough that collisions stay rare", () => {
    expect(namespaceSize()).toBeGreaterThan(50_000);
  });

  it("retries past a taken handle instead of appending a discriminator", async () => {
    let calls = 0;
    const handle = await generateHandle(async () => { calls++; return calls <= 3; });
    expect(calls).toBe(4);
    expect(handle).not.toMatch(/-\d+-\d+$/); // never sakit-pərvanə-37-2
  });

  it("fails loudly rather than degrading when the namespace is exhausted", async () => {
    await expect(generateHandle(async () => true, 5)).rejects.toThrow(/exhausted/);
  });

  it("does not repeat itself over many draws", () => {
    const seen = new Set(Array.from({ length: 500 }, () => formatHandle(generateCandidate())));
    expect(seen.size).toBeGreaterThan(400); // CSPRNG, not a cycle
  });

  it("enforces the design's 14-day change cooldown", () => {
    const now = new Date("2026-08-17T12:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    expect(canChangeHandle(new Date(now.getTime() - 13 * day), now)).toBe(false);
    expect(canChangeHandle(new Date(now.getTime() - 14 * day), now)).toBe(true);
  });
});
