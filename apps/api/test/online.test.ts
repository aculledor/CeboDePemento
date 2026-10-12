import { test } from "node:test";
import assert from "node:assert/strict";
import { api, write, ApiFailure } from "../../web/src/api.ts";
import { isReachable, setReachable } from "../../web/src/connectivity.ts";
test("No writes are sent before a health response, after timeout, or after server failure", async () => {
  const original = globalThis.fetch;
  let writes = 0,
    mode: "ok" | "timeout" | "server" = "ok";
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/health") return Response.json({ status: "ok" });
    if (path === "/api/auth/csrf") return Response.json({ token: "test-csrf" });
    if (init?.method === "POST") {
      writes++;
      if (mode === "timeout") throw new Error("Timeout after server commit");
      if (mode === "server")
        return Response.json({ code: "SERVER_ERROR" }, { status: 500 });
      return Response.json({ ok: true });
    }
    throw new Error("Unexpected request");
  };
  try {
    setReachable(false);
    await assert.rejects(() => write("/any", {}), ApiFailure);
    assert.equal(writes, 0);
    await api("/health");
    assert.equal(isReachable(), true);
    mode = "timeout";
    await assert.rejects(() => write("/any", {}, crypto.randomUUID()));
    assert.equal(writes, 1);
    assert.equal(isReachable(), false);
    await assert.rejects(() => write("/any", {}));
    assert.equal(writes, 1);
    await api("/health");
    mode = "server";
    await assert.rejects(() => write("/any", {}));
    assert.equal(isReachable(), false);
    mode = "ok";
    await api("/health");
    assert.deepEqual(await write("/any", {}), { ok: true });
  } finally {
    globalThis.fetch = original;
    setReachable(false);
  }
});
