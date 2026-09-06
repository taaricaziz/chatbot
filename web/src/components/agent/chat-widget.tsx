"use client";

import { useEffect, useRef, useState } from "react";
import { stripMarkdown } from "@/lib/text";
import styles from "./chat-widget.module.css";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The ordering assistant, as a corner widget.
 *
 * Conversation state lives here, not on the server: the client sends the
 * history back each turn, so there is no server-side session to expire and
 * closing the tab genuinely ends the conversation.
 */
export function ChatWidget() {
  // null = not yet known. The launcher stays hidden until the server has
  // answered, so a switched-off assistant never flashes into view.
  const [visible, setVisible] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  // What has arrived so far for the reply being written right now.
  const [streaming, setStreaming] = useState("");
  // What the assistant is doing while it is not writing, e.g. "Looking at the
  // menu". Transient: never part of the conversation.
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // One id per mounted widget. Groups this visitor's calls for the
  // per-conversation quota and keeps the staff transcript in one piece.
  const conversationId = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, pending, streaming, status]);

  useEffect(() => {
    // Deferred to idle so this never competes with the largest contentful
    // paint. A hidden launcher a moment late costs nothing; a slower hero
    // costs the performance budget.
    const ask = () => {
      fetch("/api/agent/status", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { visible: false }))
        .then((d) => setVisible(d?.visible === true))
        .catch(() => setVisible(false));
    };

    // Not in every browser (Safari lagged for years), and the DOM types
    // claim otherwise, so it is reached through a shape that admits absence.
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(ask, { timeout: 2000 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(ask, 400);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send() {
    const message = draft.trim();
    if (!message || pending) return;

    setDraft("");
    setError(null);
    setStreaming("");
    setStatus("");
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setPending(true);

    // Held locally as well as in state: the final turn is built from this, and
    // a state update queued mid-stream would not have landed yet.
    let assembled = "";

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Asks for the streaming response. Without it the same endpoint
          // returns ordinary JSON.
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message,
          history: turns,
          conversationId: conversationId.current,
        }),
      });

      if (!res.ok) {
        // Rate limits and the launch gate still answer with a status code and
        // JSON, before any streaming begins.
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "The assistant is unavailable.");
      }

      if (!res.body) throw new Error("The assistant is unavailable.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failure: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Events are newline-delimited and a chunk can split one in half, so
        // only whole lines are consumed.
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;

          let event: {
            type: string;
            delta?: string;
            label?: string;
            reply?: string;
            message?: string;
          };
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }

          if (event.type === "text" && event.delta) {
            assembled += event.delta;
            // Cleaned on the WHOLE string, not the fragment: a `**` split
            // across two deltas is only recognisable once joined.
            setStreaming(stripMarkdown(assembled));
            // Writing means it is no longer waiting on anything.
            setStatus("");
          } else if (event.type === "tool" && event.label) {
            setStatus(event.label);
          } else if (event.type === "done") {
            // The server's reply is authoritative — it is what was recorded
            // in the transcript, so the customer and the staff see the same
            // words.
            assembled = event.reply ?? assembled;
          } else if (event.type === "error") {
            failure = event.message ?? "Something went wrong.";
          }
        }
      }

      if (failure) throw new Error(failure);

      const reply = stripMarkdown(assembled).trim();
      if (reply) {
        setTurns((prev) => [...prev, { role: "assistant", content: reply }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
      setStreaming("");
      setStatus("");
    }
  }

  if (visible !== true) return null;

  if (!open) {
    return (
      <button
        type="button"
        className={styles.launcher}
        onClick={() => setOpen(true)}
        aria-label="Open the ordering assistant"
      >
        <ChatIcon />
        <span>Ask us</span>
      </button>
    );
  }

  return (
    <section className={styles.panel} aria-label="Ordering assistant">
      <header className={styles.head}>
        <div>
          <p className={`display ${styles.title}`}>Ask us anything</p>
          <p className={styles.subtitle}>Menu, orders, bookings</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close">
          &times;
        </button>
      </header>

      <div className={styles.log} ref={scrollRef}>
        {turns.length === 0 && (
          <p className={styles.hint}>
            Try &ldquo;what&rsquo;s good for breakfast?&rdquo; or &ldquo;a table
            for four on Friday&rdquo;.
          </p>
        )}

        {turns.map((turn, i) => (
          <p
            key={i}
            className={turn.role === "user" ? styles.fromUser : styles.fromBot}
          >
            {turn.content}
          </p>
        ))}

        {/* The reply as it is being written. Rendered in the same bubble
            style as a finished one, so nothing shifts when it lands. */}
        {streaming && (
          <p className={styles.fromBot} aria-live="polite">
            {streaming}
            <span className={styles.cursor} aria-hidden="true" />
          </p>
        )}

        {/* Shown whenever a tool is running, even under a half-written
            reply. While a tool runs NOTHING is being written, so suppressing
            this would leave the customer looking at a frozen half-message —
            the exact wait streaming exists to remove. */}
        {pending && (status || !streaming) && (
          <p className={styles.typing} aria-live="polite">
            {status || "Thinking"}
            <span className={styles.dots} aria-hidden="true" />
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          aria-label="Message"
          maxLength={1000}
          disabled={pending}
        />
        <button type="submit" disabled={pending || draft.trim() === ""}>
          Send
        </button>
      </form>

      {/* Said plainly rather than buried: an assistant that can place a real
          order should say so before it places one. */}
      <p className={styles.disclosure}>
        You&rsquo;ll always see a full summary and be asked before anything is
        ordered.
      </p>
    </section>
  );
}

function ChatIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
    </svg>
  );
}
