/**
 * robots.txt compliance, checked AT RUNTIME.
 *
 * Deliberately not a one-off check recorded in a comment. A site's robots.txt
 * is the operator telling you what you may fetch, and it can change the day
 * after you read it — so the scraper re-reads it every run and refuses paths
 * it now disallows, rather than trusting a note somebody wrote once.
 */

export interface RobotsRules {
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
}

/** Parses the `User-agent: *` group. We never pretend to be a named bot. */
export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };
  let inWildcardGroup = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0]!.trim();
    if (!line) continue;

    const [rawField, ...rest] = line.split(":");
    const field = rawField!.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (field === "user-agent") {
      // A new group starts. Only the wildcard group applies to us.
      inWildcardGroup = value === "*";
      continue;
    }
    if (!inWildcardGroup) continue;

    if (field === "disallow" && value) rules.disallow.push(value);
    else if (field === "allow" && value) rules.allow.push(value);
    else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) rules.crawlDelayMs = seconds * 1000;
    }
  }
  return rules;
}

/**
 * Whether a path may be fetched.
 *
 * Longest-match wins, and Allow beats Disallow at equal length — the standard
 * precedence. An empty `Disallow:` means "nothing is disallowed" and is
 * therefore skipped by the parser above rather than blocking everything.
 */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) =>
    list.filter((p) => path.startsWith(p)).reduce((max, p) => Math.max(max, p.length), -1);

  const deny = longest(rules.disallow);
  const permit = longest(rules.allow);
  if (deny === -1) return true;
  return permit >= deny;
}

export async function fetchRobots(origin: string, userAgent: string): Promise<RobotsRules> {
  const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": userAgent } });
  if (!res.ok) {
    // A missing robots.txt conventionally means "no restrictions". Treating a
    // 500 the same way would be wrong, so only 404 is read as permissive.
    if (res.status === 404) return { disallow: [], allow: [], crawlDelayMs: null };
    throw new Error(`robots.txt returned ${res.status}; refusing to crawl blind`);
  }
  return parseRobots(await res.text());
}
