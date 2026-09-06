import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";

/**
 * Staff authentication.
 *
 * Deliberately NOT next-auth: at the time of writing its v5 line is still
 * pre-release, and this project already absorbed one release-candidate
 * dependency problem. What is actually needed here is small and well-defined
 * — verify a password, issue a signed session cookie — so it is built on two
 * audited primitives instead: Node's scrypt for hashing and `jose` for the
 * JWT. Revisit if customer accounts ever arrive; OAuth is where a framework
 * earns its keep, and this has none.
 *
 * Customers never authenticate. This protects /admin only.
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SESSION_COOKIE = "gootee_staff";
const SESSION_HOURS = 12;

export type AdminRole = "OWNER" | "MANAGER" | "STAFF";

export interface StaffSession {
  email: string;
  name: string;
  role: AdminRole;
}

// ------------------------------------------------------------- passwords

/**
 * `scrypt:<saltHex>:<hashHex>`
 *
 * Colon-separated, NOT the conventional `$`-separated PHC form. That is
 * deliberate: this value lives in a .env file, and Next's dotenv loader
 * performs variable expansion on `$name` — even inside single quotes. A
 * `$`-separated hash silently arrives as just "scrypt", and the only symptom
 * is a correct password being rejected. Colons cannot be expanded.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;

  // Constant-time: a length-independent comparison would leak how much of the
  // hash matched.
  return timingSafeEqual(derived, expected);
}

// -------------------------------------------------------------- sessions

function sessionSecret(): Uint8Array {
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "STAFF_SESSION_SECRET must be set to at least 32 characters to sign staff sessions.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(session: StaffSession): Promise<void> {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(sessionSecret());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true, // never readable by page scripts
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // survives a normal navigation, blocks cross-site POSTs
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<StaffSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    if (
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null;
    }
    return {
      email: payload.email,
      name: payload.name,
      role: payload.role as AdminRole,
    };
  } catch {
    // Expired, tampered, or signed with a rotated secret.
    return null;
  }
}

/**
 * Role check, used INSIDE pages and actions — not only in middleware.
 *
 * Middleware alone is a single point of failure: one route added to the wrong
 * folder and it is unprotected. Checking at the point of use means a missed
 * route fails closed.
 */
const RANK: Record<AdminRole, number> = { STAFF: 1, MANAGER: 2, OWNER: 3 };

export async function requireStaff(minimum: AdminRole = "STAFF"): Promise<StaffSession> {
  const session = await getSession();

  // No valid session — including a cookie that is present but forged, expired
  // or signed with a rotated secret. Middleware only checks that a cookie
  // EXISTS, so this is where a bad one is actually caught. Redirect rather
  // than throw: an unhandled error here would surface as a 500, which is a
  // confusing way to say "please sign in".
  if (!session) redirect("/admin/login");

  // Wrong role is different: the person IS signed in, so sending them back to
  // the login form would be a lie. This throws and is caught by the admin
  // error boundary, which explains the problem.
  if (RANK[session.role] < RANK[minimum]) {
    throw new AuthError("Your account cannot do that.", "FORBIDDEN");
  }
  return session;
}

export class AuthError extends Error {
  constructor(message: string, readonly code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(message);
  }
}

// ----------------------------------------------------------------- users

export interface StaffUser extends StaffSession {
  passwordHash: string;
}

/**
 * Staff accounts.
 *
 * With no database configured these come from env vars, which is a real
 * pattern for a café with three or four staff — and it means the demo has a
 * working login without seeding a users table. A DB-backed `admin_users`
 * table replaces this the moment DATABASE_URL exists.
 */
export async function findStaffByEmail(email: string): Promise<StaffUser | null> {
  const wanted = email.trim().toLowerCase();

  const envEmail = process.env.STAFF_EMAIL?.trim().toLowerCase();
  const envHash = process.env.STAFF_PASSWORD_HASH;

  // Fail loudly on a malformed hash. The classic cause is a `$`-separated
  // hash pasted into .env, where dotenv expands the separators away and
  // leaves "scrypt" — after which every correct password is rejected with no
  // other clue.
  if (envHash && envHash.split(":").length !== 3) {
    console.error(
      "[auth] STAFF_PASSWORD_HASH is malformed — expected scrypt:salt:hash " +
        `but got ${envHash.split(":").length} segment(s). ` +
        "Regenerate it; note the separators are COLONS, not $, because " +
        "dotenv expands $ inside .env values.",
    );
  }

  if (envEmail && envHash && wanted === envEmail) {
    return {
      email: envEmail,
      name: process.env.STAFF_NAME ?? "Manager",
      role: (process.env.STAFF_ROLE as AdminRole) ?? "OWNER",
      passwordHash: envHash,
    };
  }

  return null;
}

export const DEMO_CREDENTIALS_CONFIGURED = Boolean(
  process.env.STAFF_EMAIL && process.env.STAFF_PASSWORD_HASH,
);
