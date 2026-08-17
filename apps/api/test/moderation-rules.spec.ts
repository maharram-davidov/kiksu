import { describe, expect, it } from "vitest";
import { runRules, worstSeverity } from "../src/modules/moderation/rules";

describe("tier 1 moderation rules", () => {
  describe("Azerbaijani phone numbers", () => {
    // The most common accidental self-doxx on a board like this.
    const positives = [
      "Zəng elə 0505551234",
      "+994 50 555 12 34 yazın",
      "994512223344",
      "nömrəm 055-777-88-99",
      "0//70.123.45.67 belə yazsam?".replace("//", ""),
      "(050) 123 45 67",
    ];
    for (const t of positives) {
      it(`catches: ${t}`, () => {
        expect(runRules(t).some((h) => h.rule === "phone_number")).toBe(true);
      });
    }

    // Things that must NOT fire: a moderation layer that cries wolf gets
    // ignored by the humans it exists to help.
    const negatives = [
      "İmtahan 2025-ci ildə keçirilir",
      "205 otaqda saat 14:05-də",
      "CS 214 dərsi 6 kredit",
      "Qiymət 12345 manatdır",
      "2024/25 payız semestri",
    ];
    for (const t of negatives) {
      it(`ignores: ${t}`, () => {
        expect(runRules(t).some((h) => h.rule === "phone_number")).toBe(false);
      });
    }
  });

  it("catches an email address", () => {
    expect(runRules("mənə yaz ilkin@std.bsu.edu.az").some((h) => h.rule === "email_address")).toBe(true);
  });

  it("catches a messaging handle", () => {
    expect(runRules("t.me/ilkinaliyev yaz").some((h) => h.rule === "contact_handle")).toBe(true);
  });

  it("treats four links as advertising, three as conversation", () => {
    const three = "https://a.az https://b.az https://c.az";
    const four = `${three} https://d.az`;
    expect(runRules(three).some((h) => h.rule === "link_flood")).toBe(false);
    expect(runRules(four).some((h) => h.rule === "link_flood")).toBe(true);
  });

  it("catches keyboard mashing but not ordinary emphasis", () => {
    expect(runRules("çoooox yaxşıdır").some((h) => h.rule === "char_flood")).toBe(false);
    expect(runRules("aaaaaaaaaaaaaaaaaaaa").some((h) => h.rule === "char_flood")).toBe(true);
  });

  it("catches a pasted student ID", () => {
    expect(runRules("tələbə № 20231234").some((h) => h.rule === "student_id")).toBe(true);
  });

  it("leaves ordinary Azerbaijani student writing alone", () => {
    const real = [
      "Mikroiqtisadiyyat aralıq imtahanı təxirə salındı, kim eşitdi?",
      "Dekanlıqdan hələ rəsmi elan yoxdur, ancaq qrup nümayəndəsi cümə axşamına keçirildiyini dedi.",
      "205 deyil, 207 olacaq. Elan lövhəsində dəyişiklik var.",
      "İzahları çox səlis, normalizasiya mövzusunu lövhədə addım-addım göstərir.",
      "Yasamalda kirayə qiymətləri necədir bu il?",
    ];
    for (const t of real) expect(runRules(t)).toHaveLength(0);
  });

  it("reports the worst thing found, since that is what the case severity becomes", () => {
    const hits = runRules("https://a.az https://b.az https://c.az https://d.az və 0505551234");
    expect(worstSeverity(hits)).toBe(5);
  });

  it("never puts the matched text in the note a moderator sees", () => {
    for (const h of runRules("zəng et 0505551234, ya da ilkin@std.bsu.edu.az")) {
      expect(h.note).not.toContain("0505551234");
      expect(h.note).not.toContain("ilkin@std.bsu.edu.az");
    }
  });

  it("handles empty and missing text", () => {
    expect(runRules(null)).toHaveLength(0);
    expect(runRules("")).toHaveLength(0);
  });
});
