"use client";

import { useActionState } from "react";
import { signIn } from "@/lib/services/admin-actions";
import styles from "./login-form.module.css";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="next" value={next} />

      <label className={styles.field}>
        <span>Email</span>
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </label>

      <label className={styles.field}>
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>

      {/* One message for both wrong-email and wrong-password: telling an
          attacker which half was right is a free hint. */}
      {state?.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
