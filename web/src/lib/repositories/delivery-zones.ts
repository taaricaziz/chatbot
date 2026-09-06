import "server-only";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import type { DeliveryZone } from "@/lib/services/delivery";

/**
 * Delivery zones. Mirrors the seeded rows when no database is configured.
 */

const SEED: DeliveryZone[] = [
  { id: "z-bukhari",  name: "Bukhari Commercial", feePaisa:  9900, minOrderPaisa:  60000, etaMinMinutes: 15, etaMaxMinutes: 30, priority: 10, isActive: true, matchTerms: ["bukhari", "khayaban-e-shujaat", "khayaban e shujaat"] },
  { id: "z-phase6",   name: "DHA Phase 6",        feePaisa: 11900, minOrderPaisa:  80000, etaMinMinutes: 20, etaMaxMinutes: 40, priority: 20, isActive: true, matchTerms: ["phase 6", "phase vi", "dha 6", "ittehad", "khayaban-e-bukhari"] },
  { id: "z-phase5",   name: "DHA Phase 5",        feePaisa: 14900, minOrderPaisa:  80000, etaMinMinutes: 25, etaMaxMinutes: 45, priority: 30, isActive: true, matchTerms: ["phase 5", "phase v", "dha 5", "khadda", "khayaban-e-shahbaz", "badar"] },
  { id: "z-phase7",   name: "DHA Phase 7",        feePaisa: 14900, minOrderPaisa:  80000, etaMinMinutes: 25, etaMaxMinutes: 45, priority: 30, isActive: true, matchTerms: ["phase 7", "phase vii", "dha 7", "saba", "ittehad 7"] },
  { id: "z-phase8",   name: "DHA Phase 8",        feePaisa: 19900, minOrderPaisa: 120000, etaMinMinutes: 30, etaMaxMinutes: 55, priority: 40, isActive: true, matchTerms: ["phase 8", "phase viii", "dha 8", "al murtaza", "rahat"] },
  { id: "z-phase24",  name: "DHA Phase 2 & 4",    feePaisa: 19900, minOrderPaisa: 120000, etaMinMinutes: 30, etaMaxMinutes: 55, priority: 40, isActive: true, matchTerms: ["phase 2", "phase 4", "phase ii", "phase iv", "dha 2", "dha 4"] },
  { id: "z-clifton",  name: "Clifton",            feePaisa: 24900, minOrderPaisa: 150000, etaMinMinutes: 35, etaMaxMinutes: 65, priority: 50, isActive: true, matchTerms: ["clifton", "block 2", "block 4", "block 5", "block 7", "block 8", "teen talwar"] },
  { id: "z-defence",  name: "Defence (other)",    feePaisa: 19900, minOrderPaisa: 120000, etaMinMinutes: 30, etaMaxMinutes: 60, priority: 90, isActive: true, matchTerms: ["dha", "defence", "defense"] },
];

export async function getDeliveryZones(): Promise<DeliveryZone[]> {
  if (!isDatabaseConfigured) return SEED;

  const rows = await getPrisma().deliveryZone.findMany({
    where: { isActive: true },
    orderBy: { priority: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    feePaisa: r.feePaisa,
    minOrderPaisa: r.minOrderPaisa,
    etaMinMinutes: r.etaMinMinutes,
    etaMaxMinutes: r.etaMaxMinutes,
    matchTerms: r.matchTerms,
    priority: r.priority,
    isActive: r.isActive,
  }));
}

/** Every zone name, for the checkout area picker. */
export async function getZoneNames(): Promise<string[]> {
  const zones = await getDeliveryZones();
  return zones.map((z) => z.name);
}
