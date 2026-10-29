import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, client, testPassword } from "./helpers.js";
import { createUser } from "../src/security.js";
import { dailyHours } from "../src/community.js";
test("Statistics merge overlap, preserve unknown weights and never expose private points", async () => {
  const h = await harness();
  try {
    const admin = client(h.app),
      friend = client(h.app);
    await admin.login();
    const user = await createUser(h.store, {
      username: "friend",
      displayName: "Friend",
      password: testPassword,
      role: "member",
    });
    await friend.login("friend");
    const zones = (await friend.request("GET", "/api/zones")).json();
    assert.equal(zones.length, 21);
    assert.ok(
      zones.every((z: { latitude: number | null }) => z.latitude === null),
    );
    const sessionBody = {
      startAt: "2026-10-10T22:00:00+02:00",
      endAt: "2026-10-11T04:00:00+02:00",
      zoneId: zones[0].id,
      privacy: "private",
      latitude: 42.5,
      longitude: -8.9,
      notes: "",
      revision: 0,
    };
    const s = (
      await friend.request(
        "POST",
        "/api/sessions",
        sessionBody,
        crypto.randomUUID(),
      )
    ).json();
    await friend.request(
      "POST",
      "/api/sessions",
      { ...sessionBody, startAt: "2026-10-11T00:00:00+02:00" },
      crypto.randomUUID(),
    );
    const taxon = (await friend.request("GET", "/api/catalog?q=jurel")).json()
      .items[0].id;
    const body = {
      taxonId: taxon,
      caughtAt: "2026-10-11T02:00:00+02:00",
      quantity: 7,
      qualifying: null,
      retained: 0,
      totalWeightKg: null,
      maxLengthCm: null,
      maxWeightKg: null,
      revision: 0,
    };
    await friend.request(
      "POST",
      `/api/sessions/${s.id}/captures`,
      body,
      crypto.randomUUID(),
    );
    const stats = (
      await friend.request("GET", `/api/stats?userId=${user.id}`)
    ).json();
    assert.equal(stats.users[0].hours, 6);
    assert.equal(stats.users[0].days, 1);
    assert.equal(stats.users[0].declaredKg, null);
    assert.equal(stats.users[0].quantity, 7);
    assert.equal(stats.users[0].weightCoverage.batches, 0);
    assert.equal(stats.exclusive.length, 1);
    assert.equal(stats.species[0].maxWeightKg, null);
    const map = (await admin.request("GET", "/api/map")).json();
    assert.equal(map.sessions.length, 0);
    assert.equal(
      (await friend.request("GET", "/api/map")).json().sessions.length,
      2,
    );
    assert.ok(
      !(await admin.request("GET", "/api/stats")).body.includes("latitude"),
    );
    assert.equal((await h.app.inject("/api/stats")).statusCode, 401);
    assert.equal(
      (
        await friend.request(
          "POST",
          "/api/admin/zones",
          { nameGl: "Proba", nameEs: "Prueba" },
          crypto.randomUUID(),
        )
      ).statusCode,
      403,
    );
    const zone = zones[0],
      updated = {
        nameGl: zone.name_gl,
        nameEs: zone.name_es,
        descriptionGl: zone.description_gl,
        descriptionEs: zone.description_es,
        latitude: 42.5,
        longitude: -8.9,
        source: zone.source,
        active: 1,
        revision: 1,
      };
    assert.equal(
      (
        await admin.request(
          "PATCH",
          `/api/admin/zones/${zone.id}`,
          updated,
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await friend.request("GET", "/api/map")).json().zones.length,
      1,
    );
  } finally {
    await h.close();
  }
});
test("Daily time splitting uses calendar boundaries at the DST transition", () => {
  const map = dailyHours(
    [
      {
        start_at: "2026-03-28T06:00:00+01:00",
        end_at: "2026-03-29T06:00:00+02:00",
      },
    ],
    "2026-10-12T00:00:00Z",
  );
  assert.equal(map.get("2026-03-28"), 23);
});
