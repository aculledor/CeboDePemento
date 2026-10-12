import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import type { Store } from "./database.js";
import { users } from "./schema.js";
import {
  audit,
  cookieOptions,
  hashToken,
  HttpError,
  idempotent,
  newToken,
  passwordHash,
  passwordSchema,
  requireAdmin,
  requireUser,
  usernameSchema,
} from "./security.js";
const credentials = z
  .object({ username: usernameSchema, password: passwordSchema })
  .strict();
const registration = credentials
  .extend({
    displayName: z.string().trim().min(1).max(80),
    token: z.string().min(20).max(100),
  })
  .strict();
export function registerAuth(app: FastifyInstance, store: Store) {
  app.get<{ Params: { id: string } }>("/api/operations/:id", async (req) => {
    const user = requireUser(req),
      id = z.string().uuid().parse(req.params.id),
      row = store.sqlite
        .prepare(
          "SELECT response_json FROM idempotency WHERE actor_id=? AND operation_id=?",
        )
        .get(user.id, id) as { response_json: string } | undefined;
    return row
      ? { applied: true, result: JSON.parse(row.response_json) }
      : { applied: false };
  });
  app.get("/api/auth/csrf", async (req, reply) => {
    const token = req.cookies.cebo_csrf ?? newToken();
    reply.setCookie("cebo_csrf", token, { ...cookieOptions, maxAge: 3600 });
    return { token };
  });
  app.get("/api/auth/me", async (req) => requireUser(req));
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const input = credentials.parse(req.body),
        row = store.db
          .select()
          .from(users)
          .where(eq(users.username, input.username))
          .get();
      // Same hashing cost even for unknown usernames.
      const valid = row
        ? await argon2.verify(row.passwordHash, input.password)
        : (await passwordHash(input.password), false);
      if (!valid || !row?.active) throw new HttpError(401, "BAD_CREDENTIALS");
      const token = newToken(),
        now = new Date().toISOString(),
        expires = new Date(Date.now() + 7 * 86400000).toISOString();
      store.sqlite.transaction(() => {
        store.sqlite
          .prepare("DELETE FROM auth_sessions WHERE expires_at<=?")
          .run(now);
        store.sqlite
          .prepare("INSERT INTO auth_sessions VALUES (?,?,?,?)")
          .run(hashToken(token), row.id, now, expires);
        audit(store, row.id, "auth.login", "user", row.id);
      })();
      reply.setCookie("cebo_session", token, {
        ...cookieOptions,
        maxAge: 7 * 86400,
      });
      const { passwordHash: _, ...user } = row;
      return user;
    },
  );
  app.post("/api/auth/logout", async (req, reply) => {
    const user = requireUser(req);
    store.sqlite.transaction(() => {
      store.sqlite
        .prepare("DELETE FROM auth_sessions WHERE token_hash=?")
        .run(hashToken(req.cookies.cebo_session!));
      audit(store, user.id, "auth.logout", "user", user.id);
    })();
    reply.clearCookie("cebo_session", cookieOptions);
    reply.clearCookie("cebo_csrf", cookieOptions);
    return { ok: true };
  });
  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req) => {
      const input = registration.parse(req.body),
        hash = await passwordHash(input.password),
        now = new Date().toISOString();
      return store.sqlite.transaction(() => {
        const invite = store.sqlite
          .prepare(
            "SELECT id FROM registration_invitations WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?",
          )
          .get(hashToken(input.token), now) as { id: string } | undefined;
        if (!invite) throw new HttpError(400, "INVALID_TOKEN");
        if (
          store.db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.username, input.username))
            .get()
        )
          throw new HttpError(409, "USERNAME_TAKEN");
        const id = crypto.randomUUID();
        store.db
          .insert(users)
          .values({
            id,
            username: input.username,
            displayName: input.displayName,
            passwordHash: hash,
            role: "member",
            active: 1,
            createdAt: now,
          })
          .run();
        store.sqlite
          .prepare(
            "UPDATE registration_invitations SET used_by=?,used_at=? WHERE id=?",
          )
          .run(id, now, invite.id);
        audit(
          store,
          id,
          "invitation.accepted",
          "registration_invitation",
          invite.id,
          null,
          { userId: id },
        );
        return { ok: true };
      })();
    },
  );
  app.get("/api/admin/users", async (req) => {
    requireAdmin(req);
    return store.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        active: users.active,
        createdAt: users.createdAt,
      })
      .from(users)
      .all();
  });
  app.get("/api/admin/invitations", async (req) => {
    requireAdmin(req);
    return store.sqlite
      .prepare(
        "SELECT id,created_by,expires_at,used_by,used_at,revoked_at FROM registration_invitations ORDER BY expires_at DESC",
      )
      .all();
  });
  app.post("/api/admin/invitations", async (req) => {
    const user = requireAdmin(req),
      input = z
        .object({
          expiresInHours: z.number().int().min(1).max(720).default(72),
        })
        .strict()
        .parse(req.body);
    return idempotent(store, req, () => {
      const id = crypto.randomUUID(),
        token = newToken(),
        expiresAt = new Date(
          Date.now() + input.expiresInHours * 3600000,
        ).toISOString();
      store.sqlite
        .prepare(
          "INSERT INTO registration_invitations(id,token_hash,created_by,expires_at) VALUES (?,?,?,?)",
        )
        .run(id, hashToken(token), user.id, expiresAt);
      audit(
        store,
        user.id,
        "invitation.created",
        "registration_invitation",
        id,
        null,
        { expiresAt },
      );
      return { id, token, expiresAt };
    });
  });
  app.post<{ Params: { id: string } }>(
    "/api/admin/invitations/:id/revoke",
    async (req) => {
      const user = requireAdmin(req);
      z.object({}).strict().parse(req.body);
      return idempotent(store, req, () => {
        const row = store.sqlite
          .prepare("SELECT id FROM registration_invitations WHERE id=?")
          .get(req.params.id);
        if (!row) throw new HttpError(404, "NOT_FOUND");
        store.sqlite
          .prepare(
            "UPDATE registration_invitations SET revoked_at=? WHERE id=?",
          )
          .run(new Date().toISOString(), req.params.id);
        audit(
          store,
          user.id,
          "invitation.revoked",
          "registration_invitation",
          req.params.id,
        );
        return { ok: true };
      });
    },
  );
  app.post("/api/admin/recovery", async (req) => {
    const user = requireAdmin(req),
      input = z.object({ userId: z.string().uuid() }).strict().parse(req.body);
    return idempotent(store, req, () => {
      if (
        !store.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, input.userId))
          .get()
      )
        throw new HttpError(404, "NOT_FOUND");
      const token = newToken(),
        expiresAt = new Date(Date.now() + 3600000).toISOString();
      store.sqlite
        .prepare("DELETE FROM recovery_tokens WHERE user_id=?")
        .run(input.userId);
      store.sqlite
        .prepare("INSERT INTO recovery_tokens VALUES (?,?,?,?,NULL)")
        .run(hashToken(token), input.userId, user.id, expiresAt);
      audit(store, user.id, "recovery.created", "user", input.userId);
      return { token, expiresAt };
    });
  });
  app.post(
    "/api/auth/reset",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req) => {
      const input = z
          .object({
            token: z.string().min(20).max(100),
            password: passwordSchema,
          })
          .strict()
          .parse(req.body),
        hash = await passwordHash(input.password);
      return store.sqlite.transaction(() => {
        const now = new Date().toISOString(),
          tokenHash = hashToken(input.token),
          record = store.sqlite
            .prepare(
              "SELECT user_id FROM recovery_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
            )
            .get(tokenHash, now) as { user_id: string } | undefined;
        if (!record) throw new HttpError(400, "INVALID_TOKEN");
        store.db
          .update(users)
          .set({ passwordHash: hash })
          .where(eq(users.id, record.user_id))
          .run();
        store.sqlite
          .prepare("UPDATE recovery_tokens SET used_at=? WHERE token_hash=?")
          .run(now, tokenHash);
        store.sqlite
          .prepare("DELETE FROM auth_sessions WHERE user_id=?")
          .run(record.user_id);
        audit(store, record.user_id, "password.reset", "user", record.user_id);
        return { ok: true };
      })();
    },
  );
}
