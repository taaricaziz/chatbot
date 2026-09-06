import { describe, expect, it } from "vitest";
import {
  assertBookableDate,
  AvailabilityError,
  buildAvailability,
  findTableForSlot,
  suggestAlternatives,
  type ExistingBooking,
  type TableInventory,
} from "@/lib/services/availability";

const table = (
  label: string,
  capacity: number,
  seating: "INDOOR" | "OUTDOOR" = "INDOOR",
  turnMinutes = 90,
): TableInventory => ({
  id: `tbl-${label}`,
  label,
  capacity,
  seating,
  isActive: true,
  turnMinutes,
});

/** A small dining room: two 2-tops, one 4, one 6, one outdoor 4. */
const ROOM: TableInventory[] = [
  table("T1", 2),
  table("T2", 2),
  table("T3", 4),
  table("T6", 6),
  table("P1", 4, "OUTDOOR"),
];

const DATE = "2026-09-15";
/** Well before the first slot, so lead time never interferes. */
const NOW = new Date(2026, 8, 15, 6, 0, 0);
const at = (h: number, m = 0) => new Date(2026, 8, 15, h, m, 0);

const booking = (tableId: string, from: Date, mins = 90): ExistingBooking => ({
  tableId,
  startsAt: from,
  endsAt: new Date(from.getTime() + mins * 60_000),
});

describe("table fitting", () => {
  it("picks the SMALLEST adequate table, not the first", () => {
    const t = findTableForSlot(ROOM, [], at(19), 2, "ANY");
    expect(t?.label).toBe("T1"); // not T6
  });

  it("moves up a size when the small tables are taken", () => {
    const taken = [booking("tbl-T1", at(19)), booking("tbl-T2", at(19))];
    const t = findTableForSlot(ROOM, taken, at(19), 2, "ANY");
    // T3 and P1 are both 4-tops; indoor wins the tie for an "ANY" request.
    expect(t?.label).toBe("T3");
  });

  it("holds the terrace back for guests who actually asked for it", () => {
    const roomWithOnlyOutdoorFree = [table("T3", 4), table("P1", 4, "OUTDOOR")];
    const anyPref = findTableForSlot(roomWithOnlyOutdoorFree, [], at(19), 2, "ANY");
    expect(anyPref?.seating).toBe("INDOOR");

    const taken = [booking("tbl-T3", at(19))];
    const spillsOutside = findTableForSlot(roomWithOnlyOutdoorFree, taken, at(19), 2, "ANY");
    expect(spillsOutside?.label).toBe("P1");
  });

  it("never seats a party larger than the table", () => {
    expect(findTableForSlot(ROOM, [], at(19), 6, "ANY")?.label).toBe("T6");
    expect(findTableForSlot(ROOM, [], at(19), 8, "ANY")).toBeNull();
  });

  it("honours a seating preference", () => {
    expect(findTableForSlot(ROOM, [], at(19), 4, "OUTDOOR")?.label).toBe("P1");
    expect(findTableForSlot(ROOM, [], at(19), 4, "INDOOR")?.label).toBe("T3");
  });

  it("returns null when every adequate table is busy", () => {
    const taken = [
      booking("tbl-T3", at(19)),
      booking("tbl-T6", at(19)),
      booking("tbl-P1", at(19)),
    ];
    expect(findTableForSlot(ROOM, taken, at(19), 4, "ANY")).toBeNull();
  });

  it("skips inactive tables", () => {
    const room = [{ ...table("T9", 4), isActive: false }];
    expect(findTableForSlot(room, [], at(19), 2, "ANY")).toBeNull();
  });
});

describe("overlap is half-open", () => {
  it("blocks a slot that starts inside an existing booking", () => {
    const taken = [booking("tbl-T1", at(19))]; // 19:00–20:30
    expect(findTableForSlot([table("T1", 2)], taken, at(20), 2, "ANY")).toBeNull();
  });

  it("ALLOWS a booking starting exactly when the previous one ends", () => {
    const taken = [booking("tbl-T1", at(19))]; // ends 20:30
    const t = findTableForSlot([table("T1", 2)], taken, at(20, 30), 2, "ANY");
    expect(t?.label).toBe("T1");
  });

  it("allows a booking ending exactly when the next begins", () => {
    const taken = [booking("tbl-T1", at(20, 30))];
    const t = findTableForSlot([table("T1", 2)], taken, at(19), 2, "ANY");
    expect(t?.label).toBe("T1");
  });

  it("respects a longer turn time when checking overlap", () => {
    const long = [table("T1", 2, "INDOOR", 150)]; // 2.5h turn
    const taken = [booking("tbl-T1", at(19), 150)]; // 19:00–21:30
    expect(findTableForSlot(long, taken, at(21), 2, "ANY")).toBeNull();
    expect(findTableForSlot(long, taken, at(21, 30), 2, "ANY")?.label).toBe("T1");
  });
});

describe("slot generation", () => {
  it("runs from noon to 22:00 on the half hour", () => {
    const slots = buildAvailability(ROOM, [], { date: DATE, partySize: 2, seating: "ANY", now: NOW });
    expect(slots[0]!.label).toBe("12:00");
    expect(slots.at(-1)!.label).toBe("22:00");
    expect(slots).toHaveLength(21); // 12:00–22:00 inclusive, every 30 min
  });

  it("marks a fully-booked slot unavailable", () => {
    const taken = ROOM.map((t) => booking(t.id, at(19)));
    const slots = buildAvailability(ROOM, taken, { date: DATE, partySize: 2, seating: "ANY", now: NOW });
    expect(slots.find((s) => s.label === "19:00")!.available).toBe(false);
    expect(slots.find((s) => s.label === "20:30")!.available).toBe(true);
  });

  it("reports which table backs an available slot", () => {
    const slots = buildAvailability(ROOM, [], { date: DATE, partySize: 6, seating: "ANY", now: NOW });
    const seven = slots.find((s) => s.label === "19:00")!;
    expect(seven.available).toBe(true);
    expect(seven.tableLabel).toBe("T6");
  });

  it("never offers a slot inside the lead time", () => {
    const now = new Date(2026, 8, 15, 18, 30); // 18:30
    const slots = buildAvailability(ROOM, [], { date: DATE, partySize: 2, seating: "ANY", now });
    expect(slots.find((s) => s.label === "18:30")!.available).toBe(false);
    expect(slots.find((s) => s.label === "19:00")!.available).toBe(false); // only 30 min away
    expect(slots.find((s) => s.label === "19:30")!.available).toBe(true); // 60 min away
  });

  it("offers nothing at all for a party of 8 in this room", () => {
    const slots = buildAvailability(ROOM, [], { date: DATE, partySize: 8, seating: "ANY", now: NOW });
    expect(slots.every((s) => !s.available)).toBe(true);
  });

  it("rejects an absurd party size", () => {
    for (const partySize of [0, -2, 25]) {
      expect(() =>
        buildAvailability(ROOM, [], { date: DATE, partySize, seating: "ANY", now: NOW }),
      ).toThrow(AvailabilityError);
    }
  });
});

describe("alternatives", () => {
  it("suggests the NEAREST times, not the earliest", () => {
    const taken = ROOM.map((t) => booking(t.id, at(20)));
    const slots = buildAvailability(ROOM, taken, { date: DATE, partySize: 2, seating: "ANY", now: NOW });
    const alts = suggestAlternatives(slots, at(20).toISOString(), 2);

    expect(alts).toHaveLength(2);
    // 19:30 is NOT a candidate: a 90-minute sitting from 19:30 runs to 21:00
    // and collides with the 20:00-21:30 bookings. 18:30 ends exactly at 20:00
    // and is therefore free. Both survivors sit 90 minutes from the wanted
    // time, and noon must not win.
    expect(alts.map((a) => a.label).sort()).toEqual(["18:30", "21:30"]);
  });

  it("only ever suggests available slots", () => {
    const taken = ROOM.map((t) => booking(t.id, at(19)));
    const slots = buildAvailability(ROOM, taken, { date: DATE, partySize: 2, seating: "ANY", now: NOW });
    const alts = suggestAlternatives(slots, at(19).toISOString());
    expect(alts.every((a) => a.available)).toBe(true);
    expect(alts.some((a) => a.label === "19:00")).toBe(false);
  });

  it("returns an empty list when the whole day is full", () => {
    const slots = buildAvailability(ROOM, [], { date: DATE, partySize: 12, seating: "ANY", now: NOW });
    expect(suggestAlternatives(slots, at(19).toISOString())).toEqual([]);
  });
});

describe("booking window", () => {
  const now = new Date(2026, 8, 15, 10, 0);

  it("accepts today and near dates", () => {
    expect(() => assertBookableDate("2026-09-15", now)).not.toThrow();
    expect(() => assertBookableDate("2026-10-01", now)).not.toThrow();
  });

  it("rejects a past date", () => {
    expect(() => assertBookableDate("2026-09-14", now)).toThrow(AvailabilityError);
  });

  it("rejects a date beyond the booking horizon", () => {
    expect(() => assertBookableDate("2027-01-01", now)).toThrow(AvailabilityError);
  });

  it("rejects nonsense", () => {
    expect(() => assertBookableDate("not-a-date", now)).toThrow(AvailabilityError);
  });
});
