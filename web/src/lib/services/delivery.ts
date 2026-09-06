/**
 * Delivery zone matching.
 *
 * Pure, so every matching rule is testable without a database.
 *
 * Matching is by address substring rather than by polygon. Polygons need
 * geocoding, which is a paid dependency this build does not have — and a
 * transparent term list is something café staff can actually edit later,
 * which a set of lat/long rings is not.
 */

export interface DeliveryZone {
  id: string;
  name: string;
  feePaisa: number;
  minOrderPaisa: number;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  matchTerms: string[];
  priority: number;
  isActive: boolean;
}

export interface ZoneMatch {
  zone: DeliveryZone;
  /** The term that matched, so the UI can explain the decision. */
  matchedOn: string;
}

export class DeliveryError extends Error {}

/** Folds an address to a comparable form: lowercase, single-spaced. */
export function normaliseAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds the zone covering an address.
 *
 * Where several match, the most specific wins — a Bukhari Commercial address
 * also contains "dha", and quoting the generic Defence fee for a delivery
 * two streets away would overcharge.
 */
export function matchZone(
  zones: DeliveryZone[],
  address: string,
  area?: string,
): ZoneMatch | null {
  const haystack = normaliseAddress(`${address} ${area ?? ""}`);
  if (!haystack) return null;

  const hits: ZoneMatch[] = [];

  for (const zone of zones) {
    if (!zone.isActive) continue;
    for (const term of zone.matchTerms) {
      const needle = normaliseAddress(term);
      if (needle && haystack.includes(needle)) {
        hits.push({ zone, matchedOn: term });
        break;
      }
    }
  }

  if (hits.length === 0) return null;

  hits.sort((a, b) => {
    if (a.zone.priority !== b.zone.priority) return a.zone.priority - b.zone.priority;
    // Same priority: the longer term is the more specific one.
    return b.matchedOn.length - a.matchedOn.length;
  });

  return hits[0]!;
}

export interface DeliveryQuote {
  covered: boolean;
  zoneName: string | null;
  feePaisa: number;
  minOrderPaisa: number;
  /** Always a window. Never a single number — see the note on the table. */
  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;
  meetsMinimum: boolean;
  shortfallPaisa: number;
}

export function quoteDelivery(
  zones: DeliveryZone[],
  address: string,
  subtotalPaisa: number,
  area?: string,
): DeliveryQuote {
  const match = matchZone(zones, address, area);

  if (!match) {
    return {
      covered: false,
      zoneName: null,
      feePaisa: 0,
      minOrderPaisa: 0,
      etaMinMinutes: null,
      etaMaxMinutes: null,
      meetsMinimum: false,
      shortfallPaisa: 0,
    };
  }

  const { zone } = match;
  const meetsMinimum = subtotalPaisa >= zone.minOrderPaisa;

  return {
    covered: true,
    zoneName: zone.name,
    feePaisa: zone.feePaisa,
    minOrderPaisa: zone.minOrderPaisa,
    etaMinMinutes: zone.etaMinMinutes,
    etaMaxMinutes: zone.etaMaxMinutes,
    meetsMinimum,
    shortfallPaisa: meetsMinimum ? 0 : zone.minOrderPaisa - subtotalPaisa,
  };
}

/**
 * "35–50 min" — phrased as a window, and labelled an estimate at the edge.
 * The system knows nothing about traffic, so it must not imply that it does.
 */
export function formatEta(
  minMinutes: number | null,
  maxMinutes: number | null,
): string | null {
  if (minMinutes === null || maxMinutes === null) return null;
  return `${minMinutes}–${maxMinutes} min`;
}
