import { test } from "node:test";
import assert from "node:assert/strict";
import { client, harness, testPassword } from "./helpers.js";
test("Invitations: CSRF, permissions, expiry, single-use and idempotent retry", async () => {
  const h = await harness();
  try {
    const admin = client(h.app),
      member = client(h.app);
    const login = await admin.login();
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().passwordHash, undefined);
    assert.match(login.headers["set-cookie"] as string, /HttpOnly/);
    const key = crypto.randomUUID();
    assert.equal(
      (
        await admin.request("POST", "/api/admin/invitations", {}, key, {
          "x-csrf-token": "bad",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await admin.request("POST", "/api/admin/invitations", {}, key, {
          origin: "https://attacker.example",
        })
      ).statusCode,
      403,
    );
    const invitation = await admin.request(
      "POST",
      "/api/admin/invitations",
      {},
      key,
    );
    assert.equal(invitation.statusCode, 200);
    const repeated = await admin.request(
      "POST",
      "/api/admin/invitations",
      {},
      key,
    );
    assert.deepEqual(repeated.json(), invitation.json());
    assert.equal(
      (
        await admin.request(
          "POST",
          "/api/admin/invitations",
          { expiresInHours: 24 },
          key,
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        h.store.sqlite
          .prepare("SELECT count(*) n FROM registration_invitations")
          .get() as { n: number }
      ).n,
      1,
    );
    await member.csrf();
    const payload = {
      username: "friend",
      displayName: "Friend",
      password: testPassword,
      token: invitation.json().token,
    };
    assert.equal(
      (await member.request("POST", "/api/auth/register", payload)).statusCode,
      200,
    );
    assert.equal(
      (
        await member.request("POST", "/api/auth/register", {
          ...payload,
          username: "other",
        })
      ).statusCode,
      400,
    );
    assert.equal((await member.login("friend")).statusCode, 200);
    assert.equal(
      (await member.request("GET", "/api/admin/users")).statusCode,
      403,
    );
    assert.equal(
      (
        await member.request(
          "POST",
          "/api/admin/invitations",
          {},
          crypto.randomUUID(),
        )
      ).statusCode,
      403,
    );
    assert.equal((await member.request("GET", "/api/catalog")).statusCode, 200);
    const expires = await admin.request(
      "POST",
      "/api/admin/invitations",
      {},
      crypto.randomUUID(),
    );
    h.store.sqlite
      .prepare("UPDATE registration_invitations SET expires_at=? WHERE id=?")
      .run("2000-01-01T00:00:00.000Z", expires.json().id);
    assert.equal(
      (
        await member.request("POST", "/api/auth/register", {
          ...payload,
          username: "expired",
          token: expires.json().token,
        })
      ).statusCode,
      400,
    );
    const hash = (
      h.store.sqlite
        .prepare("SELECT password_hash FROM users WHERE username=?")
        .get("friend") as { password_hash: string }
    ).password_hash;
    assert.match(hash, /^\$argon2id\$/);
    assert.ok(!hash.includes(testPassword));
    assert.equal(
      (await member.request("POST", "/api/auth/logout", {})).statusCode,
      200,
    );
    assert.equal((await member.request("GET", "/api/auth/me")).statusCode, 401);
  } finally {
    await h.close();
  }
});
test("Recovery tokens are single-use and revoke all existing sessions", async () => {
  const h = await harness();
  try {
    const admin = client(h.app),
      other = client(h.app);
    await admin.login();
    await other.login();
    const response = await admin.request(
      "POST",
      "/api/admin/recovery",
      { userId: h.admin.id },
      crypto.randomUUID(),
    );
    assert.equal(response.statusCode, 200);
    assert.equal(
      (
        await other.request("POST", "/api/auth/reset", {
          token: response.json().token,
          password: "a-new-test-password",
        })
      ).statusCode,
      200,
    );
    assert.equal((await admin.request("GET", "/api/auth/me")).statusCode, 401);
    assert.equal((await other.request("GET", "/api/auth/me")).statusCode, 401);
    assert.equal(
      (
        await other.request("POST", "/api/auth/reset", {
          token: response.json().token,
          password: "a-new-test-password",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await other.request("POST", "/api/auth/login", {
          username: "admin",
          password: testPassword,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await other.request("POST", "/api/auth/login", {
          username: "admin",
          password: "a-new-test-password",
        })
      ).statusCode,
      200,
    );
  } finally {
    await h.close();
  }
});
