import { describe, expect, it } from "vitest";
import {
  backoffMs,
  MAX_ATTEMPTS,
  renderTemplate,
  smsSegments,
  SMS_SEGMENT_CHARS,
  TemplateError,
  type TemplateId,
} from "@/lib/services/notifications";
import { rupees } from "@/lib/money";

const ORDER_PAYLOAD = {
  orderNumber: "GC-ABC-123",
  totalPaisa: rupees(2139),
  orderType: "TAKEAWAY",
  customerName: "Sana Riaz",
};

const RES_PAYLOAD = {
  reference: "GR-XYZ-789",
  whenText: "Sat 12 Sep, 07:30 PM",
  partySize: 4,
};

const ALL: { template: TemplateId; payload: Record<string, unknown> }[] = [
  { template: "ORDER_CONFIRMED", payload: ORDER_PAYLOAD },
  { template: "ORDER_READY", payload: ORDER_PAYLOAD },
  { template: "ORDER_OUT_FOR_DELIVERY", payload: ORDER_PAYLOAD },
  { template: "ORDER_CANCELLED", payload: ORDER_PAYLOAD },
  { template: "RESERVATION_RECEIVED", payload: RES_PAYLOAD },
  { template: "RESERVATION_CONFIRMED", payload: RES_PAYLOAD },
  { template: "RESERVATION_DECLINED", payload: RES_PAYLOAD },
];

describe("every template, on every channel", () => {
  it("renders a non-empty subject and body", () => {
    for (const { template, payload } of ALL) {
      for (const channel of ["SMS", "EMAIL"] as const) {
        const m = renderTemplate(template, channel, payload);
        expect(m.subject.length, `${template}/${channel} subject`).toBeGreaterThan(0);
        expect(m.body.length, `${template}/${channel} body`).toBeGreaterThan(0);
      }
    }
  });

  it("never leaves an unreplaced placeholder", () => {
    for (const { template, payload } of ALL) {
      for (const channel of ["SMS", "EMAIL"] as const) {
        const m = renderTemplate(template, channel, payload);
        const text = `${m.subject} ${m.body}`;
        // The classic template bug: a literal ${...}, {{...}} or "undefined"
        // reaching a customer.
        expect(text, `${template}/${channel}`).not.toMatch(/\$\{|\{\{|undefined|null|NaN/);
      }
    }
  });

  it("always identifies the café, so a text is never anonymous", () => {
    for (const { template, payload } of ALL) {
      const m = renderTemplate(template, "SMS", payload);
      expect(m.body, template).toContain("Gootee Cafe");
    }
  });

  it("keeps every SMS to a single billed segment", () => {
    for (const { template, payload } of ALL) {
      const m = renderTemplate(template, "SMS", payload);
      expect(
        m.body.length,
        `${template} is ${m.body.length} chars — over one ${SMS_SEGMENT_CHARS}-char segment`,
      ).toBeLessThanOrEqual(SMS_SEGMENT_CHARS);
    }
  });

  it("writes longer, warmer email bodies than SMS", () => {
    for (const { template, payload } of ALL) {
      const sms = renderTemplate(template, "SMS", payload);
      const email = renderTemplate(template, "EMAIL", payload);
      expect(email.body.length, template).toBeGreaterThan(sms.body.length);
    }
  });
});

describe("payload validation", () => {
  it("refuses to render with a missing field rather than shipping a gap", () => {
    expect(() => renderTemplate("ORDER_CONFIRMED", "SMS", {})).toThrow(TemplateError);
    expect(() => renderTemplate("RESERVATION_CONFIRMED", "SMS", { reference: "GR-1" }))
      .toThrow(TemplateError);
  });

  it("refuses a non-integer total — money is always paisa", () => {
    expect(() =>
      renderTemplate("ORDER_CONFIRMED", "SMS", { ...ORDER_PAYLOAD, totalPaisa: 21.39 }),
    ).toThrow(TemplateError);
    expect(() =>
      renderTemplate("ORDER_CONFIRMED", "SMS", { ...ORDER_PAYLOAD, totalPaisa: "2139" }),
    ).toThrow(TemplateError);
  });

  it("formats the total as rupees, not raw paisa", () => {
    const m = renderTemplate("ORDER_CONFIRMED", "SMS", ORDER_PAYLOAD);
    expect(m.body).toContain("Rs. 2,139");
    expect(m.body).not.toContain("213900");
  });
});

describe("delivery vs collection wording", () => {
  it("tells a delivery customer it is on the way", () => {
    const m = renderTemplate("ORDER_CONFIRMED", "SMS", {
      ...ORDER_PAYLOAD,
      orderType: "DELIVERY",
    });
    expect(m.body).toMatch(/on the way/i);
    expect(m.body).not.toMatch(/collect/i);
  });

  it("tells a takeaway customer it will be ready", () => {
    const m = renderTemplate("ORDER_CONFIRMED", "SMS", ORDER_PAYLOAD);
    expect(m.body).toMatch(/ready/i);
  });

  it("never promises an exact delivery time", () => {
    const m = renderTemplate("ORDER_OUT_FOR_DELIVERY", "EMAIL", {
      ...ORDER_PAYLOAD,
      etaText: "20–40 min",
    });
    expect(m.body).toContain("estimate");
    // A bare "arrives at 19:45" would be a promise the system cannot keep.
    expect(m.body).not.toMatch(/arrives at|will arrive at/i);
  });
});

describe("segment counting", () => {
  it("counts one segment for short text and more for long", () => {
    expect(smsSegments("short")).toBe(1);
    expect(smsSegments("x".repeat(SMS_SEGMENT_CHARS))).toBe(1);
    expect(smsSegments("x".repeat(SMS_SEGMENT_CHARS + 1))).toBe(2);
    expect(smsSegments("x".repeat(SMS_SEGMENT_CHARS * 3))).toBe(3);
  });

  it("never reports zero segments for an empty body", () => {
    expect(smsSegments("")).toBe(1);
  });
});

describe("retry backoff", () => {
  it("grows with each attempt", () => {
    const delays = [1, 2, 3, 4].map(backoffMs);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
  });

  it("starts at a minute, not instantly — a hammered provider stays hammered", () => {
    expect(backoffMs(1)).toBe(60_000);
  });

  it("caps so a confirmation is never hours late", () => {
    expect(backoffMs(99)).toBe(30 * 60_000);
    expect(backoffMs(1000)).toBe(30 * 60_000);
  });

  it("gives up eventually rather than retrying a dead number forever", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
