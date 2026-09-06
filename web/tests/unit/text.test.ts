import { describe, expect, it } from "vitest";
import { stripMarkdown } from "@/lib/text";

describe("the reply a real model actually sent", () => {
  it("strips the bold a free model produced despite being asked not to", () => {
    // Verbatim shape of a real Groq reply, after the system prompt had
    // explicitly forbidden markdown. A prompt is a request; this is the
    // guarantee.
    const real = [
      "Here are the desserts we have today:",
      "",
      "1. **Burnt Basque Cheesecake** – Rs. 890  ",
      "   Caramelised on top. *(vegetarian)*  ",
    ].join("\n");

    const clean = stripMarkdown(real);
    expect(clean).not.toContain("**");
    expect(clean).toContain("Burnt Basque Cheesecake");
    expect(clean).toContain("(vegetarian)");
    // The price and the structure survive — only the markup goes.
    expect(clean).toContain("Rs. 890");
    expect(clean).toContain("1. Burnt Basque Cheesecake");
  });
});

describe("stripping markup", () => {
  it("unwraps bold and italic", () => {
    expect(stripMarkdown("a **bold** word")).toBe("a bold word");
    expect(stripMarkdown("a __bold__ word")).toBe("a bold word");
    expect(stripMarkdown("a *soft* word")).toBe("a soft word");
    expect(stripMarkdown("a _soft_ word")).toBe("a soft word");
  });

  it("removes a dangling marker, which is what mid-stream looks like", () => {
    // The closing ** has not arrived yet; a lone pair on screen reads as a bug.
    expect(stripMarkdown("Here is **Flat Whi")).toBe("Here is Flat Whi");
  });

  it("removes headings and code markers", () => {
    expect(stripMarkdown("## Menu")).toBe("Menu");
    expect(stripMarkdown("the `flat-white` slug")).toBe("the flat-white slug");
    expect(stripMarkdown("```json\n{}")).toBe("{}");
  });

  it("collapses runaway blank lines", () => {
    expect(stripMarkdown("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("leaves ordinary text completely alone", () => {
    const plain = "A Flat White is Rs. 620. Shall I add one?";
    expect(stripMarkdown(plain)).toBe(plain);
  });

  it("does not eat a lone asterisk or underscore in normal prose", () => {
    expect(stripMarkdown("2 * 3 is 6")).toBe("2 * 3 is 6");
    expect(stripMarkdown("the slug is flat_white")).toBe("the slug is flat_white");
  });

  it("keeps prices and currency untouched", () => {
    expect(stripMarkdown("**Rs. 1,860**")).toBe("Rs. 1,860");
  });

  it("is safe on an empty string", () => {
    expect(stripMarkdown("")).toBe("");
  });
});
