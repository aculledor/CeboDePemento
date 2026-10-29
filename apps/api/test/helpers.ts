import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { openDatabase, migrate } from "../src/database.js";
import { createApp } from "../src/app.js";
import { createUser } from "../src/security.js";
import type { FetchRemote } from "../src/photos.js";
export const testPassword = "only-for-tests-password";
export async function harness(photoFetcher?: FetchRemote) {
  const dir = mkdtempSync(resolve(tmpdir(), "cebo-test-")),
    store = openDatabase(resolve(dir, "catalogo.sqlite"));
  await migrate(store);
  const admin = await createUser(store, {
      username: "admin",
      displayName: "Test Admin",
      password: testPassword,
      role: "admin",
    }),
    app = await createApp(store, false, photoFetcher);
  return {
    store,
    admin,
    app,
    close: async () => {
      await app.close();
      store.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export function client(app: FastifyInstance) {
  const jar: Record<string, string> = {};
  let csrf = "";
  async function request(
    method: "GET" | "POST" | "PATCH",
    url: string,
    body?: unknown,
    key?: string,
    extra: Record<string, string> = {},
  ) {
    const result = await app.inject({
      method,
      url,
      headers: {
        cookie: Object.entries(jar)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
        ...(method === "GET"
          ? {}
          : {
              origin: "http://localhost:5173",
              "content-type": "application/json",
              "x-csrf-token": csrf,
            }),
        ...(key ? { "idempotency-key": key } : {}),
        ...extra,
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    for (const cookie of result.cookies) jar[cookie.name] = cookie.value;
    return result;
  }
  return {
    request,
    csrf: async () => {
      const response = await request("GET", "/api/auth/csrf");
      csrf = response.json().token;
    },
    login: async (username = "admin") => {
      const response = await request("GET", "/api/auth/csrf");
      csrf = response.json().token;
      return request("POST", "/api/auth/login", {
        username,
        password: testPassword,
      });
    },
  };
}
