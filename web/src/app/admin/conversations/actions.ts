"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { setSwitch } from "@/lib/repositories/agent-switch";
import { recordAudit } from "@/lib/repositories/audit";

/**
 * Turn the assistant off, or back on, from the console.
 *
 * A kill switch that needs a redeploy is not a kill switch — this one takes
 * effect on the next request, because the widget asks
 * `/api/agent/status` rather than having its answer baked into a static page.
 *
 * Recorded in the audit trail: switching off the customer-facing assistant is
 * exactly the kind of thing someone will later want to know the time of.
 *
 * NOTE: this file exports only async functions. A "use server" module that
 * exports anything else — a class, a constant — corrupts Next's action
 * registry and every action on the site starts failing.
 */
export async function toggleAssistant(formData: FormData): Promise<void> {
  const staff = await requireStaff("MANAGER");
  const off = formData.get("off") === "true";

  setSwitch(off, staff.name);

  await recordAudit({
    actor: staff.name,
    action: off ? "ASSISTANT_OFF" : "ASSISTANT_ON",
    entity: "assistant",
    entityId: "global",
    before: { off: !off },
    after: { off },
  });

  revalidatePath("/admin/conversations");
}
