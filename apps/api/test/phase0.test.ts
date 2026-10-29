import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { openDatabase, migrate, assertIntegrity } from "../src/database.js";
import { createApp } from "../src/app.js";
import { root } from "../src/config.js";
import { createUser } from "../src/security.js";
import { client, testPassword } from "./helpers.js";
test("Safe catalog copy, repeatable migration and real bilingual API", async () => {
  const hash = () =>
    createHash("sha256")
      .update(readFileSync(resolve(root, "catalogo.sqlite")))
      .digest("hex");
  const original = hash(),
    dir = mkdtempSync(resolve(tmpdir(), "cebo-test-")),
    store = openDatabase(resolve(dir, "catalogo.sqlite"));
  try {
    await migrate(store);
    await migrate(store);
    assertIntegrity(store.sqlite);
    const app = await createApp(store);
    try {
      await createUser(store, {
        username: "admin",
        displayName: "Test Admin",
        password: testPassword,
        role: "admin",
      });
      const browser = client(app);
      await browser.login();
      const health = await app.inject("/api/health");
      assert.equal(health.statusCode, 200);
      assert.deepEqual(health.json().catalog, {
        reference: 932,
        initial: 62,
        pending: 870,
      });
      const ids = [];
      for (const q of ["xurelo", "jurel", "Trachurus trachurus", "XÚRELO"]) {
        const result = await browser.request(
          "GET",
          `/api/catalog?q=${encodeURIComponent(q)}`,
        );
        assert.equal(result.statusCode, 200);
        const fish = result
          .json()
          .items.find(
            (x: { scientificName: string }) =>
              x.scientificName === "Trachurus trachurus",
          );
        assert.ok(fish);
        ids.push(fish.id);
      }
      assert.equal(new Set(ids).size, 1);
      assert.equal(
        (await browser.request("GET", "/api/catalog?pageSize=100")).json().items
          .length,
        62,
      );
      assert.equal(
        (await browser.request("GET", "/api/catalog?page=-1")).statusCode,
        400,
      );
      assert.equal(
        (await browser.request("GET", "/api/catalog/not-a-taxon")).statusCode,
        404,
      );
      assert.equal(
        (await browser.request("GET", "/api/catalog?q=%27%20OR%201%3D1")).json()
          .total,
        0,
      );
      assert.equal((await app.inject("/api/catalog")).statusCode, 401);
    } finally {
      await app.close();
    }
    assert.equal(hash(), original);
  } finally {
    store.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
