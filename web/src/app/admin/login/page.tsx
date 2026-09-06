import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, DEMO_CREDENTIALS_CONFIGURED } from "@/lib/auth";
import { LoginForm } from "@/components/admin/login-form";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/admin");

  const { next } = await searchParams;

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <p className={`eyebrow ${styles.eyebrow}`}>Gootee Cafe</p>
        <h1 className={`display ${styles.title}`}>Staff console</h1>
        <LoginForm next={next ?? "/admin"} />
        {!DEMO_CREDENTIALS_CONFIGURED && (
          <p className={styles.warn}>
            No staff account is configured. Set STAFF_EMAIL and
            STAFF_PASSWORD_HASH in web/.env.
          </p>
        )}
      </div>
    </div>
  );
}
