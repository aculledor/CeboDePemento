import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { users } from "./schema.js";
import type { Store } from "./database.js";
import { settings } from "./config.js";
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
export interface User {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  active: number;
  createdAt: string;
}
declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/);
export const passwordSchema = z.string().min(12).max(128);
export const passwordHash = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export const cookieOptions = {
  path: "/api",
  httpOnly: true,
  secure: settings.NODE_ENV === "production",
  sameSite: "strict" as const,
};
export function audit(
  store: Store,
  actorId: string,
  action: string,
  type: string,
  id: string,
  before: unknown = null,
  after: unknown = null,
) {
  store.sqlite
    .prepare(
      "INSERT INTO audit_log(actor_id,action,entity_type,entity_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      actorId,
      action,
      type,
      id,
      JSON.stringify(before),
      JSON.stringify(after),
      new Date().toISOString(),
    );
}
export const requireUser = (req: FastifyRequest) => {
  if (!req.user) throw new HttpError(401, "AUTH_REQUIRED");
  return req.user;
};
export const requireAdmin = (req: FastifyRequest) => {
  const user = requireUser(req);
  if (user.role !== "admin") throw new HttpError(403, "FORBIDDEN");
  return user;
};
export async function installSecurity(app: FastifyInstance, store: Store) {
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          "data:",
          "https://upload.wikimedia.org",
          "https://static.inaturalist.org",
          "https://inaturalist-open-data.s3.amazonaws.com",
          "https://*.tile.openstreetmap.org",
        ],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      code: "RATE_LIMIT",
      message: "Too many attempts; try later",
    }),
  });
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req) => {
    const token = req.cookies.cebo_session;
    if (token) {
      const session = store.sqlite
        .prepare(
          "SELECT user_id FROM auth_sessions WHERE token_hash=? AND expires_at>?",
        )
        .get(hashToken(token), new Date().toISOString()) as
        { user_id: string } | undefined;
      if (session) {
        const row = store.db
          .select()
          .from(users)
          .where(eq(users.id, session.user_id))
          .get();
        if (row?.active) {
          const { passwordHash, ...user } = row;
          req.user = user;
        }
      }
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !settings.origins.includes(origin))
        throw new HttpError(403, "ORIGIN_DENIED");
      if (
        req.headers["content-type"]?.split(";")[0]?.trim() !==
        "application/json"
      )
        throw new HttpError(415, "JSON_REQUIRED");
      const provided = req.headers["x-csrf-token"],
        expected = req.cookies.cebo_csrf;
      if (
        typeof provided !== "string" ||
        !expected ||
        !safeEqual(provided, expected)
      )
        throw new HttpError(403, "CSRF");
    }
  });
}
export function idempotent<T>(
  store: Store,
  req: FastifyRequest,
  work: () => T,
): T {
  const user = requireUser(req),
    operationId = z.string().uuid().parse(req.headers["idempotency-key"]),
    route = `${req.method} ${req.routeOptions.url}`;
  const requestHash = hashToken(
    JSON.stringify({ params: req.params, body: req.body }),
  );
  return store.sqlite.transaction(() => {
    const old = store.sqlite
      .prepare("SELECT * FROM idempotency WHERE actor_id=? AND operation_id=?")
      .get(user.id, operationId) as
      | { route: string; request_hash: string; response_json: string }
      | undefined;
    if (old) {
      if (old.route !== route || old.request_hash !== requestHash)
        throw new HttpError(409, "IDEMPOTENCY_CONFLICT");
      return JSON.parse(old.response_json) as T;
    }
    const result = work();
    store.sqlite
      .prepare("INSERT INTO idempotency VALUES (?,?,?,?,?,?)")
      .run(
        user.id,
        operationId,
        route,
        requestHash,
        JSON.stringify(result),
        new Date().toISOString(),
      );
    return result;
  })();
}
export async function createUser(
  store: Store,
  input: {
    username: string;
    displayName: string;
    password: string;
    role: "admin" | "member";
  },
) {
  const username = usernameSchema.parse(input.username),
    password = passwordSchema.parse(input.password),
    displayName = z.string().trim().min(1).max(80).parse(input.displayName);
  const hash = await passwordHash(password),
    id = crypto.randomUUID(),
    createdAt = new Date().toISOString();
  store.sqlite.transaction(() => {
    store.db
      .insert(users)
      .values({
        id,
        username,
        displayName,
        passwordHash: hash,
        role: input.role,
        active: 1,
        createdAt,
      })
      .run();
    audit(store, id, "user.created", "user", id, null, {
      username,
      role: input.role,
    });
  })();
  return { id, username, displayName, role: input.role, active: 1, createdAt };
}
