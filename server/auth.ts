import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

const COOKIE_NAME = "lp_session";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days: the operator shouldn't re-login every service
const MAX_ATTEMPTS = 10; // wrong-password attempts per IP per minute
const WINDOW_MS = 60_000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Anything with request headers: an Express request or a raw WebSocket upgrade request. */
type HasHeaders = Pick<Request, "headers">;

function readCookie(req: HasHeaders, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

/**
 * Optional single shared password (APP_PASSWORD). Not a user system:
 * - No password configured -> everything is open (local development).
 * - Otherwise a correct password sets a cookie holding an HMAC derived from the password,
 *   so no session table is needed, and changing APP_PASSWORD logs everyone out.
 */
export function createAuth(password: string | undefined) {
  const enabled = Boolean(password);
  const token = enabled
    ? crypto.createHmac("sha256", password!).update("lyric-presenter-session-v1").digest("hex")
    : "";
  const attempts = new Map<string, { count: number; resetAt: number }>();

  const isAuthenticated = (req: HasHeaders): boolean => {
    if (!enabled) return true;
    const cookie = readCookie(req, COOKIE_NAME);
    return cookie !== undefined && safeEqual(cookie, token);
  };

  /** Guards every /api route it is mounted before. */
  const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    if (isAuthenticated(req)) return next();
    res.status(401).json({ error: "Password required" });
  };

  const login: RequestHandler = (req, res) => {
    if (!enabled) {
      res.json({ ok: true });
      return;
    }
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const entry = attempts.get(ip);
    if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many attempts. Wait a minute and try again." });
      return;
    }
    const supplied = typeof req.body?.password === "string" ? (req.body.password as string) : "";
    // Compare HMACs (fixed length) so the comparison leaks nothing about the password length.
    const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
    if (!safeEqual(hash(supplied), hash(password!))) {
      const fresh = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
      fresh.count += 1;
      attempts.set(ip, fresh);
      res.status(401).json({ error: "Wrong password" });
      return;
    }
    attempts.delete(ip);
    const secure = req.secure ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_S}${secure}`,
    );
    res.json({ ok: true });
  };

  const logout: RequestHandler = (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  };

  const session: RequestHandler = (req, res) => {
    res.json({ authRequired: enabled, authenticated: isAuthenticated(req) });
  };

  return { enabled, isAuthenticated, requireAuth, login, logout, session };
}

export type Auth = ReturnType<typeof createAuth>;
