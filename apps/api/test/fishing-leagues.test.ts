import { test } from "node:test";
import assert from "node:assert/strict";
import { fishingDay, leagueBounds, unionHours } from "../src/time.js";
import { harness, client, testPassword } from "./helpers.js";
import { createUser } from "../src/security.js";
import { scoreCapture, type Rules } from "../src/leagues.js";
test("Madrid fishing days and league boundaries handle midnight and 23/25 hour days", () => {
  assert.equal(fishingDay("2026-10-12T22:00:00+02:00"), "2026-10-12");
  assert.equal(fishingDay("2026-10-13T04:00:00+02:00"), "2026-10-12");
  assert.equal(fishingDay("2026-10-13T06:00:00+02:00"), "2026-10-13");
  for (const [day, hours] of [
    ["2026-03-28", 23],
    ["2026-10-24", 25],
  ] as const) {
    const b = leagueBounds(day, day);
    assert.equal((Date.parse(b.end) - Date.parse(b.start)) / 3600000, hours);
  }
  assert.equal(
    unionHours([
      { start_at: "2026-10-12T20:00:00Z", end_at: "2026-10-13T00:00:00Z" },
      { start_at: "2026-10-12T22:00:00Z", end_at: "2026-10-13T02:00:00Z" },
    ]),
    6,
  );
});
test("Scoring: simple 7, custom 12, unknown basic, no-minimum single and generic exclusions", () => {
  const rules: Rules = {
      mode: "custom",
      defaultPoints: 1,
      allowUngrouped: true,
      allowGeneric: false,
      categories: ["fish"],
      taxonIds: [],
      groups: [
        {
          id: "common",
          name: "Common",
          below: 1,
          above: 2,
          single: 3,
          taxonIds: ["jurel"],
        },
      ],
    },
    capture = {
      taxon_id: "jurel",
      quantity: 7,
      qualifying: 5,
      size_status_snapshot: "has_minimum" as const,
    },
    taxon = { category: "fish", identification_level: "species_name" };
  assert.equal(scoreCapture(capture, taxon, rules).points, 12);
  assert.equal(
    scoreCapture(capture, taxon, { ...rules, mode: "simple" }).points,
    7,
  );
  assert.equal(
    scoreCapture({ ...capture, size_status_snapshot: "pending" }, taxon, rules)
      .points,
    7,
  );
  assert.equal(
    scoreCapture(
      { ...capture, size_status_snapshot: "confirmed_no_minimum" },
      taxon,
      rules,
    ).points,
    21,
  );
  assert.equal(
    scoreCapture(
      capture,
      { ...taxon, identification_level: "unresolved" },
      rules,
    ).admitted,
    false,
  );
  assert.equal(
    scoreCapture(
      capture,
      { ...taxon, identification_level: "unresolved" },
      { ...rules, allowGeneric: true },
    ).points,
    7,
  );
});
test("Private coordinates, capture idempotency, late joining, revised rules and approvals affect live rankings", async () => {
  const h = await harness();
  try {
    const admin = client(h.app),
      friend = client(h.app);
    await admin.login();
    const other = await createUser(h.store, {
      username: "friend",
      displayName: "Friend",
      password: testPassword,
      role: "member",
    });
    await friend.login("friend");
    const taxon = (await admin.request("GET", "/api/catalog?q=jurel")).json()
      .items[0].id;
    h.store.sqlite
      .prepare(
        "UPDATE taxon_profiles SET size_status='has_minimum',minimum_cm=15 WHERE taxon_id=?",
      )
      .run(taxon);
    const sessionBody = {
      startAt: "2026-10-10T22:00:00+02:00",
      endAt: "2026-10-11T04:00:00+02:00",
      zoneId: null,
      privacy: "private",
      latitude: 42.5,
      longitude: -8.9,
      notes: "",
      revision: 0,
    };
    const session = (
      await friend.request(
        "POST",
        "/api/sessions",
        sessionBody,
        crypto.randomUUID(),
      )
    ).json();
    assert.ok(session.id);
    const view = (
      await admin.request("GET", `/api/sessions/${session.id}`)
    ).json();
    assert.equal(view.latitude, null);
    assert.equal(view.longitude, null);
    const body = {
        taxonId: taxon,
        caughtAt: "2026-10-11T02:00:00+02:00",
        quantity: 7,
        qualifying: 5,
        retained: 0,
        totalWeightKg: null,
        maxLengthCm: null,
        maxWeightKg: null,
        revision: 0,
      },
      key = crypto.randomUUID();
    const captured = await friend.request(
      "POST",
      `/api/sessions/${session.id}/captures`,
      body,
      key,
    );
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.json().fishing_day, "2026-10-10");
    assert.equal(
      (
        await friend.request(
          "POST",
          `/api/sessions/${session.id}/captures`,
          body,
          key,
        )
      ).json().id,
      captured.json().id,
    );
    assert.equal(
      (
        await admin.request(
          "POST",
          `/api/sessions/${session.id}/captures`,
          body,
          crypto.randomUUID(),
        )
      ).statusCode,
      403,
    );
    const custom = {
      name: "Custom test",
      visibility: "open",
      firstDay: "2026-10-01",
      lastDay: "2026-10-31",
      revision: 0,
      rules: {
        mode: "custom",
        defaultPoints: 1,
        allowUngrouped: true,
        allowGeneric: false,
        categories: ["fish"],
        taxonIds: [],
        groups: [
          {
            id: "common",
            name: "Common",
            below: 1,
            above: 2,
            single: 1,
            taxonIds: [taxon],
          },
        ],
      },
    };
    const league = (
        await admin.request("POST", "/api/leagues", custom, crypto.randomUUID())
      ).json(),
      simple = (
        await admin.request(
          "POST",
          "/api/leagues",
          {
            ...custom,
            name: "Simple",
            rules: { ...custom.rules, mode: "simple" },
          },
          crypto.randomUUID(),
        )
      ).json();
    for (const l of [league, simple])
      assert.equal(
        (
          await friend.request(
            "POST",
            `/api/leagues/${l.id}/join`,
            {},
            crypto.randomUUID(),
          )
        ).statusCode,
        200,
      );
    assert.equal(
      (await friend.request("GET", `/api/leagues/${league.id}`))
        .json()
        .ranking.find((x: { id: string }) => x.id === other.id).points,
      12,
    );
    assert.equal(
      (await friend.request("GET", `/api/leagues/${simple.id}`))
        .json()
        .ranking.find((x: { id: string }) => x.id === other.id).points,
      7,
    );
    assert.equal(
      (
        h.store.sqlite
          .prepare("SELECT count(*) n FROM capture_batches")
          .get() as { n: number }
      ).n,
      1,
    );
    const updated = {
      ...custom,
      revision: 1,
      rules: {
        ...custom.rules,
        groups: [{ ...custom.rules.groups[0]!, above: 3 }],
      },
    };
    assert.equal(
      (
        await admin.request(
          "PATCH",
          `/api/leagues/${league.id}`,
          updated,
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await friend.request("GET", `/api/leagues/${league.id}`))
        .json()
        .ranking.find((x: { id: string }) => x.id === other.id).points,
      17,
    );
    const proposed = (
      await admin.request(
        "POST",
        "/api/sessions",
        { ...sessionBody, ownerId: other.id },
        crypto.randomUUID(),
      )
    ).json();
    assert.equal(proposed.status, "pending");
    assert.equal(
      (
        await admin.request(
          "POST",
          `/api/sessions/${proposed.id}/captures`,
          body,
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await friend.request("GET", `/api/leagues/${simple.id}`))
        .json()
        .ranking.find((x: { id: string }) => x.id === other.id).points,
      7,
    );
    assert.equal(
      (
        await friend.request(
          "POST",
          `/api/sessions/${proposed.id}/decision`,
          { approve: true, revision: 1 },
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await friend.request("GET", `/api/leagues/${simple.id}`))
        .json()
        .ranking.find((x: { id: string }) => x.id === other.id).points,
      14,
    );
    assert.equal(
      (
        await admin.request(
          "PATCH",
          `/api/sessions/${proposed.id}`,
          { ...sessionBody, revision: 2 },
          crypto.randomUUID(),
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await friend.request(
          "PATCH",
          `/api/captures/${captured.json().id}`,
          { ...body, quantity: 8, qualifying: 6, revision: 1 },
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await friend.request("GET", `/api/leagues/${simple.id}`))
        .json()
        .ranking.find((x: { id: string }) => x.id === other.id).points,
      15,
    );
    assert.equal(
      (await friend.request("GET", `/api/leagues/${league.id}?version=1`))
        .json()
        .ranking.find((x: { id: string }) => x.id === other.id).points,
      26,
    );
    assert.equal(
      (
        await friend.request(
          "POST",
          `/api/captures/${captured.json().id}/delete`,
          { revision: 2 },
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await friend.request("GET", `/api/leagues/${simple.id}`))
        .json()
        .ranking.find((x: { id: string }) => x.id === other.id).points,
      7,
    );
    assert.equal(
      (
        h.store.sqlite
          .prepare("SELECT count(*) n FROM capture_batches")
          .get() as { n: number }
      ).n,
      2,
    );
    assert.equal(
      (
        await friend.request(
          "POST",
          `/api/sessions/${proposed.id}/delete`,
          { revision: 2 },
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await friend.request("GET", `/api/sessions/${proposed.id}`)).statusCode,
      404,
    );
    assert.equal(
      (await friend.request("GET", `/api/leagues/${simple.id}`))
        .json()
        .ranking.find((x: { id: string }) => x.id === other.id).points,
      0,
    );
  } finally {
    await h.close();
  }
});

test("Size references change existing captures only after an explicit owner correction", async () => {
  const h = await harness();
  try {
    const admin = client(h.app);
    await admin.login();
    const id = (await admin.request("GET", "/api/catalog?q=jurel")).json()
      .items[0].id;
    const session = (
      await admin.request(
        "POST",
        "/api/sessions",
        {
          startAt: "2026-10-10T22:00:00+02:00",
          endAt: "2026-10-11T04:00:00+02:00",
          zoneId: null,
          privacy: "private",
          latitude: null,
          longitude: null,
          notes: "",
          revision: 0,
        },
        crypto.randomUUID(),
      )
    ).json();
    const body = {
      taxonId: id,
      caughtAt: "2026-10-11T02:00:00+02:00",
      quantity: 7,
      qualifying: 5,
      retained: 0,
      totalWeightKg: null,
      maxLengthCm: null,
      maxWeightKg: null,
      revision: 0,
    };
    const capture = (
      await admin.request(
        "POST",
        `/api/sessions/${session.id}/captures`,
        body,
        crypto.randomUUID(),
      )
    ).json();
    assert.equal(capture.size_status_snapshot, "pending");
    h.store.sqlite
      .prepare(
        "UPDATE taxon_profiles SET size_status='has_minimum',minimum_cm=15 WHERE taxon_id=?",
      )
      .run(id);
    const preserved = (
      await admin.request(
        "PATCH",
        `/api/captures/${capture.id}`,
        { ...body, revision: 1 },
        crypto.randomUUID(),
      )
    ).json();
    assert.equal(preserved.size_status_snapshot, "pending");
    const corrected = (
      await admin.request(
        "PATCH",
        `/api/captures/${capture.id}`,
        { ...body, revision: 2, reviewSizeReference: true },
        crypto.randomUUID(),
      )
    ).json();
    assert.equal(corrected.size_status_snapshot, "has_minimum");
    assert.equal(corrected.minimum_cm_snapshot, 15);
  } finally {
    await h.close();
  }
});

test("Fractional scoring avoids binary floating-point residues", () => {
  const rules: Rules = {
    mode: "custom",
    defaultPoints: 0.1,
    allowUngrouped: true,
    allowGeneric: true,
    categories: ["fish"],
    taxonIds: [],
    groups: [],
  };
  assert.equal(
    scoreCapture(
      {
        taxon_id: "x",
        quantity: 7,
        qualifying: null,
        size_status_snapshot: "pending",
      },
      { category: "fish", identification_level: "species_name" },
      rules,
    ).points,
    0.7,
  );
});

test("Historical sessions before the Unix epoch keep their actual duration", () => {
  assert.equal(
    unionHours([
      { start_at: "1960-10-12T22:00:00Z", end_at: "1960-10-13T04:00:00Z" },
    ]),
    6,
  );
});
