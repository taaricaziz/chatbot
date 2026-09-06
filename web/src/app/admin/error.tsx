"use client";

import Link from "next/link";

/**
 * Console error boundary.
 *
 * Reached when a signed-in user hits something their role cannot do — the
 * only error the console raises deliberately. Everything else is a genuine
 * fault and says so plainly rather than pretending to be a permissions issue.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const forbidden = /cannot do that/i.test(error.message);

  return (
    <div style={{ padding: "3rem 0", display: "grid", gap: "1rem", maxWidth: "34rem" }}>
      <h1 className="display" style={{ fontSize: "1.8rem", color: "var(--bone)" }}>
        {forbidden ? "Not allowed" : "Something went wrong"}
      </h1>
      <p style={{ color: "var(--bone-mid)", lineHeight: 1.6 }}>
        {forbidden
          ? "Your account does not have permission for that. Ask a manager if you need it."
          : "That did not work. Try again, and tell whoever looks after the site if it keeps happening."}
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "0.7rem 1.4rem", borderRadius: 999,
            background: "var(--pistachio)", color: "var(--espresso)",
            fontWeight: 700, fontSize: "0.8rem", letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Try again
        </button>
        <Link
          href="/admin"
          style={{
            padding: "0.7rem 1.4rem", borderRadius: 999,
            border: "1px solid var(--rule)", color: "var(--bone-mid)",
            fontWeight: 700, fontSize: "0.8rem", letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Back to Today
        </Link>
      </div>
    </div>
  );
}
