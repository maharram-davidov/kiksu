import { randomInt } from "node:crypto";

/**
 * Handles are GENERATED, never chosen: `sakit-pərvanə-37`, `quru-püstə-19`.
 *
 * A user-chosen handle is an identity the person picks and reuses, and people
 * reuse handles across services. Generating it means the pseudonym carries no
 * information the user brought with them from elsewhere.
 *
 * Words are ordinary Azerbaijani adjectives and nouns — calm, dry, green,
 * moth, pistachio, gazelle. Deliberately mundane: nothing here should read as
 * a nickname someone would choose, because a handle that sounds chosen invites
 * people to treat it as an identity worth keeping.
 */

const ADJECTIVES = [
  "sakit", "quru", "uzaq", "isti", "mavi", "dinc", "yaşıl", "sərin",
  "geniş", "qədim", "açıq", "uca", "yumşaq", "ağır", "incə", "dərin",
  "təmiz", "parlaq", "soyuq", "hündür", "gizli", "nazik", "qalın", "sürətli",
  "yavaş", "kiçik", "böyük", "gümüşü", "qızılı", "boz", "ala", "narın",
];

const NOUNS = [
  "pərvanə", "püstə", "ceyran", "nar", "turac", "alma", "ənbər", "badam",
  "şanapipik", "heyva", "zeytun", "qarağac", "durna", "sünbül", "palıd", "kəklik",
  "yarpaq", "bulud", "çınar", "lalə", "nərgiz", "qaranquş", "bənövşə", "zanbaq",
  "gilas", "əncir", "tut", "şabalıd", "fındıq", "üzüm", "armud", "albalı",
];

/**
 * Pairs a bot might produce that read badly to a native speaker, or that could
 * be taken as a slur or a person's name. Small by necessity — this list needs a
 * native Azerbaijani reviewer before launch, and that is recorded as an open
 * question rather than pretended away.
 */
const BLOCKED_PAIRS = new Set<string>([
  "quru-nar",     // reads as an insult in colloquial usage
  "ağır-alma",
]);

export interface HandleParts { adjective: string; noun: string; number: number; }

/** Total namespace: 32 x 32 x 90 = 92,160 combinations. */
export function namespaceSize(): number {
  return ADJECTIVES.length * NOUNS.length * 90;
}

export function formatHandle(p: HandleParts): string {
  return `${p.adjective}-${p.noun}-${p.number}`;
}

/** One candidate. Uses a CSPRNG: Math.random would make handles predictable. */
export function generateCandidate(): HandleParts {
  return {
    adjective: ADJECTIVES[randomInt(ADJECTIVES.length)]!,
    noun: NOUNS[randomInt(NOUNS.length)]!,
    number: randomInt(10, 100), // two digits, matching the design's -37 / -19
  };
}

/**
 * Generates a handle not already taken, asking `isTaken` per candidate.
 *
 * Retries rather than appending a discriminator: `sakit-pərvanə-37-2` would
 * advertise that `sakit-pərvanə-37` exists, which is a small but free
 * enumeration signal.
 */
export async function generateHandle(
  isTaken: (handle: string) => Promise<boolean>,
  maxAttempts = 12,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const parts = generateCandidate();
    const pair = `${parts.adjective}-${parts.noun}`;
    if (BLOCKED_PAIRS.has(pair)) continue;
    const handle = formatHandle(parts);
    if (!(await isTaken(handle))) return handle;
  }
  // Exhausting 12 CSPRNG draws against a 92k namespace means the namespace is
  // saturating. Failing loudly is right: silently degrading to a sequential
  // suffix would leak how many users exist.
  throw new Error("could not generate a free handle; namespace may be exhausted");
}

/** The design's rule: "FORUM LƏQƏBİ · 14 GÜNDƏN BİR DƏYİŞİLİR". */
export const HANDLE_CHANGE_COOLDOWN_DAYS = 14;

export function canChangeHandle(lastChangedAt: Date, now = new Date()): boolean {
  const elapsedMs = now.getTime() - lastChangedAt.getTime();
  return elapsedMs >= HANDLE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}
