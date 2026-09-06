"use client";

import { useEffect } from "react";

/**
 * Remembers which table this browser is sitting at.
 *
 * Stored so a customer who wanders to /menu and back does not lose their
 * session, and so the bill link keeps working. Deliberately sessionStorage,
 * not localStorage: it should not survive the tab, because the next person to
 * pick up that phone is not at that table.
 */
export function TableSessionBoot({
  sessionId,
  tableLabel,
  token,
}: {
  sessionId: string;
  tableLabel: string;
  token: string;
}) {
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "gootee.table.v1",
        JSON.stringify({ sessionId, tableLabel, token }),
      );
    } catch {
      // Private mode. The page still works; only the memory of it is lost.
    }
  }, [sessionId, tableLabel, token]);

  return null;
}
