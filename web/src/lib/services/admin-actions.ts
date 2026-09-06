"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createSession,
  destroySession,
  findStaffByEmail,
  requireStaff,
  verifyPassword,
} from "@/lib/auth";
import { recordAudit } from "@/lib/repositories/audit";
import { enqueue } from "@/lib/repositories/notifications";
import { getOrder } from "@/lib/services/orders";
import { getReservation } from "@/lib/services/reservations";
import { setOrderStatus } from "@/lib/repositories/orders";
import { setItemAvailability, setItemPrice } from "@/lib/repositories/menu";
import { setReservationStatus } from "@/lib/repositories/reservations";
import { closeSession } from "@/lib/repositories/tables";

/**
 * Staff actions.
 *
 * Every one re-checks authorisation via `requireStaff()` rather than trusting
 * that middleware ran, and every mutation writes an audit entry.
 */

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const user = await findStaffByEmail(email);

  // Verify against a well-formed dummy hash when the user does not exist, so
  // an unknown email costs the same scrypt work as a real one and the
  // response time does not reveal which addresses are registered.
  //
  // The separators must be COLONS: verifyPassword splits on ":", so a
  // "$"-separated dummy would be rejected on shape before any hashing
  // happened — which is exactly the timing signal this exists to remove.
  const stored =
    user?.passwordHash ??
    `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;
  const ok = await verifyPassword(password, stored);

  if (!user || !ok) {
    return { error: "That email and password do not match." };
  }

  await createSession({ email: user.email, name: user.name, role: user.role });
  await recordAudit({
    actor: user.email,
    action: "SIGN_IN",
    entity: "staff",
    entityId: user.email,
    before: null,
    after: null,
  });

  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function signOut() {
  await destroySession();
  redirect("/admin/login");
}

export async function updateOrderStatus(formData: FormData) {
  const staff = await requireStaff("STAFF");
  const orderNumber = String(formData.get("orderNumber"));
  const status = String(formData.get("status"));
  const before = await setOrderStatus(orderNumber, status);

  await recordAudit({
    actor: staff.email,
    action: "ORDER_STATUS",
    entity: "order",
    entityId: orderNumber,
    before: { status: before },
    after: { status },
  });

  // Tell the customer when the status is one they care about. READY and
  // OUT_FOR_DELIVERY are the two worth a message; PREPARING is not — nobody
  // needs a text saying their food has been put on a griddle.
  const NOTIFY: Record<string, "ORDER_READY" | "ORDER_OUT_FOR_DELIVERY" | "ORDER_CANCELLED"> = {
    READY: "ORDER_READY",
    OUT_FOR_DELIVERY: "ORDER_OUT_FOR_DELIVERY",
    CANCELLED: "ORDER_CANCELLED",
  };

  const template = NOTIFY[status];
  if (template) {
    const order = await getOrder(orderNumber);
    const phone = order?.customerPhone ?? null;
    if (order && phone && order.orderType !== "DINE_IN") {
      await enqueue({
        channel: "SMS",
        template,
        recipient: phone,
        dedupeKey: `order:${orderNumber}:${template}`,
        orderId: order.id,
        payload: { orderNumber, orderType: order.orderType },
      });
    }
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
}

export async function toggleAvailability(formData: FormData) {
  const staff = await requireStaff("STAFF");
  const slug = String(formData.get("slug"));
  const available = formData.get("available") === "true";

  await setItemAvailability(slug, available);
  await recordAudit({
    actor: staff.email,
    action: available ? "ITEM_ON" : "ITEM_86",
    entity: "menu_item",
    entityId: slug,
    before: { isAvailable: !available },
    after: { isAvailable: available },
  });

  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  revalidatePath("/");
}

export async function updatePrice(formData: FormData) {
  // Prices are a Manager-level change: a member of floor staff can 86 a dish
  // when the kitchen runs out, but should not be able to reprice the menu.
  const staff = await requireStaff("MANAGER");
  const slug = String(formData.get("slug"));
  const rupees = Number(formData.get("rupees"));

  if (!Number.isFinite(rupees) || rupees < 0 || rupees > 100000) {
    return;
  }

  const before = await setItemPrice(slug, Math.round(rupees) * 100);
  await recordAudit({
    actor: staff.email,
    action: "PRICE_CHANGE",
    entity: "menu_item",
    entityId: slug,
    before: { pricePaisa: before },
    after: { pricePaisa: Math.round(rupees) * 100 },
  });

  revalidatePath("/admin/menu");
  revalidatePath("/menu");
}

export async function decideReservation(formData: FormData) {
  const staff = await requireStaff("STAFF");
  const reference = String(formData.get("reference"));
  const status = String(formData.get("status"));

  const before = await setReservationStatus(reference, status);
  await recordAudit({
    actor: staff.email,
    action: "RESERVATION_" + status,
    entity: "reservation",
    entityId: reference,
    before: { status: before },
    after: { status },
  });

  const RES_NOTIFY: Record<string, "RESERVATION_CONFIRMED" | "RESERVATION_DECLINED"> = {
    CONFIRMED: "RESERVATION_CONFIRMED",
    CANCELLED: "RESERVATION_DECLINED",
  };

  const resTemplate = RES_NOTIFY[status];
  if (resTemplate) {
    const booking = await getReservation(reference);
    if (booking) {
      await enqueue({
        channel: "SMS",
        template: resTemplate,
        recipient: booking.guestPhone,
        dedupeKey: `reservation:${reference}:${resTemplate}`,
        reservationId: booking.id,
        payload: {
          reference,
          partySize: booking.partySize,
          whenText: new Date(booking.startsAt).toLocaleString("en-PK", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      });
    }
  }

  revalidatePath("/admin/reservations");
  revalidatePath("/admin");
}

export async function closeTableSession(formData: FormData) {
  const staff = await requireStaff("STAFF");
  const sessionId = String(formData.get("sessionId"));

  await closeSession(sessionId, "CLOSED");
  await recordAudit({
    actor: staff.email,
    action: "SESSION_CLOSED",
    entity: "table_session",
    entityId: sessionId,
    before: { status: "OPEN" },
    after: { status: "CLOSED" },
  });

  revalidatePath("/admin/floor");
  revalidatePath("/admin");
}

// NOTE: nothing else may be exported from this module. A "use server" file
// may only export async functions — Next builds an action-id registry from
// its exports, and a non-function export (this previously re-exported the
// AuthError class) corrupts that registry. The symptom is every action in the
// file failing with "Failed to find Server Action <id>", which points nowhere
// near the real cause. Import AuthError from "@/lib/auth" instead.
