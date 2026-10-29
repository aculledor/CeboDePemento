import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { harness, client } from "./helpers.js";
import { root } from "../src/config.js";
import {
  parseDetail,
  parseSize,
  discover,
  origin,
  landing,
  digest,
  type Policy,
  type SourceRecord,
  mergeTranslations,
} from "../src/pescaderias/parser.js";
import {
  importRecords,
  reconcile,
  preview,
} from "../src/pescaderias/importer.js";
import {
  SourceClient,
  verifyPolicy,
  crawlSource,
} from "../src/pescaderias/crawler.js";
import { assertIntegrity } from "../src/database.js";
import { toTaxonInput, type Taxon } from "@cebo/shared";
import sharp from "sharp";
import {
  prepareImage,
  downloadAuthorizedImages,
} from "../src/pescaderias/images.js";
const policy: Policy = {
  reviewedBy: "Test operator",
  reviewedAt: "2026-10-29T00:00:00.000Z",
  automatedAccessAllowed: true,
  metadataReuseAllowed: true,
  descriptionsReuseAllowed: false,
  imagesReuseAllowed: false,
  evidence: [
    { url: `${origin}/aviso-legal`, sha256: digest("TEST permission") },
  ],
  notes: "Synthetic policy for isolated tests only.",
};
const html = (category: string) =>
  readFileSync(
    resolve(root, "apps/api/test/fixtures/pescaderias", `${category}.html`),
    "utf8",
  );
const record = (category: "fish" | "cephalopod" | "crustacean" = "fish") =>
  parseDetail(
    html(category),
    `${landing}/${category}/especie?id=test-${category}`,
    category,
    policy,
    "2026-10-29T00:00:00.000Z",
  );
test("Contract fixtures: fish, cephalopod and crustacean fields; cm, grams and absent data stay distinct", () => {
  const fish = record(),
    octopus = record("cephalopod"),
    crab = record("crustacean");
  assert.equal(fish.scientificName, "Trachurus trachurus");
  assert.deepEqual(fish.names.gl, ["Xurelo", "Chicharro"]);
  assert.equal(fish.faoCode, "HOM");
  assert.deepEqual(fish.sizes[0], {
    literal: "15 cm de longitud total",
    value: 15,
    unit: "cm",
    method: "total_length",
  });
  assert.equal(octopus.sizes[0]?.value, 1000);
  assert.equal(octopus.sizes[0]?.unit, "g");
  assert.equal(octopus.sizes[0]?.method, "individual_weight");
  assert.equal(crab.sizes[0]?.value, null);
  assert.equal(crab.sizes[0]?.unit, null);
  assert.equal(crab.names.es.length, 1);
  assert.deepEqual(crab.descriptions, { gl: {}, es: {} });
  assert.equal(
    parseSize("10 cm de longitud dorsal del manto").method,
    "mantle_length",
  );
  assert.equal(parseSize("90 mm cefalotórax").method, "cephalothorax_length");
  assert.equal(parseSize("1,5 kg de peso individual").value, 1.5);
  assert.equal(parseSize("12.5 cm longitud total").value, 12.5);
});
test("Image author/license/provenance are recorded without assuming permission; descriptions need approval", () => {
  const pending = record();
  assert.equal(pending.images[0]?.authorization, "pending");
  assert.equal(pending.images[0]?.author, "Autor de prueba");
  assert.equal(pending.images[0]?.license, "CC BY 4.0");
  assert.equal(pending.images[0]?.type, "illustration");
  const allowed = parseDetail(html("fish"), pending.url, "fish", {
    descriptionsReuseAllowed: true,
    imagesReuseAllowed: true,
  });
  assert.equal(allowed.images[0]?.authorization, "authorized");
  assert.ok(allowed.descriptions.es.description);
  assert.equal(record("cephalopod").images[0]?.license, null);
});
test("Discovery follows actual links and pagination, excludes other groups and refuses foreign hosts", () => {
  const url = `${landing}/peces`,
    links = discover(
      `<main><article><a href="${url}/ficha/abc">Ficha</a></article><a href="?page=2">2</a><a href="${landing}/bivalvos/especie?id=4">Bivalvo</a><a href="https://evil.invalid/ficha?id=1">Otro</a></main>`,
      url,
      "fish",
    );
  assert.equal(links.details.length, 1);
  assert.ok(links.details[0]?.endsWith("/ficha/abc"));
  assert.deepEqual(links.pages, [`${url}?page=2`]);
});
test("Polite source client enforces robots, caches resumable pages and stops at 403 without retries", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "pdr-http-"));
  let requests = 0;
  try {
    const client = new SourceClient(
      dir,
      async (url) => {
        requests++;
        return {
          status: 200,
          body: url.endsWith("robots.txt")
            ? "User-agent: *\nDisallow: /private\nCrawl-delay: 0"
            : "hello",
        };
      },
      async () => {},
      0,
    );
    await assert.rejects(
      () => client.page(`${origin}/allowed`),
      /ROBOTS_NOT_CHECKED/,
    );
    await client.checkRobots();
    await client.page(`${origin}/allowed`);
    await client.page(`${origin}/allowed`);
    assert.equal(requests, 2);
    await assert.rejects(
      () => client.page(`${origin}/private`),
      /ROBOTS_DENIED/,
    );
    const denied = new SourceClient(
      resolve(dir, "denied"),
      async () => ({ status: 403, body: "Forbidden" }),
      async () => {},
      0,
    );
    await assert.rejects(() => denied.checkRobots(), /ACCESS_DENIED/);
    await assert.rejects(() =>
      verifyPolicy(client, { ...policy, automatedAccessAllowed: false }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Crawler discovers details, merges a discovered translation and resumes without network reads", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "pdr-crawl-"));
  let requests = 0;
  const category = `${landing}/peces`,
    url = `${category}/especie?id=test-fish`,
    gl = `${origin}/gl/produtos/peixes/especie?id=test-fish`;
  const pages: Record<string, string> = {
    [`${origin}/robots.txt`]: "User-agent: *\nAllow: /",
    [`${origin}/aviso-legal`]: "TEST permission",
    [category]: `<article><a href="${url}">Jurel</a></article>`,
    [url]: html("fish"),
    [gl]: html("fish").replace('lang="es"', 'lang="gl"'),
  };
  try {
    const client = new SourceClient(
      dir,
      async (u) => {
        requests++;
        if (!pages[u]) throw new Error(`unexpected URL ${u}`);
        return { status: 200, body: pages[u]! };
      },
      async () => {},
      0,
    );
    const checked = await verifyPolicy(client, policy),
      first = await crawlSource(client, checked, ["fish"]),
      count = requests;
    assert.equal(first.records.length, 1);
    assert.equal(first.errors.length, 0);
    assert.equal(Object.keys(first.records[0]!.pageHashes).length, 2);
    await crawlSource(client, checked, ["fish"]);
    assert.equal(requests, count);
    assert.ok(existsSync(resolve(dir, "checkpoint.json")));
    assert.throws(
      () =>
        mergeTranslations(record(), {
          ...record(),
          scientificName: "Different species",
        }),
      /IDENTITY_CONFLICT/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Reconciliation keeps scientific and FAO identity, aliases, generics and ambiguous common names separate", async () => {
  const h = await harness();
  try {
    const fish = record(),
      exact = reconcile(h.store.sqlite, fish);
    assert.equal(exact.kind, "exact");
    assert.equal(
      reconcile(h.store.sqlite, { ...fish, faoCode: "CTC" }).kind,
      "conflict",
    );
    assert.equal(
      reconcile(h.store.sqlite, {
        ...fish,
        scientificName: "Notknown fish",
        faoCode: null,
      }).kind,
      "conflict",
    );
    assert.equal(
      reconcile(h.store.sqlite, {
        ...fish,
        scientificName: "Trachurus spp.",
        faoCode: "HOM",
      }).kind,
      "conflict",
    );
    assert.equal(
      reconcile(h.store.sqlite, {
        ...fish,
        scientificName: null,
        faoCode: null,
        names: { gl: ["Lorcho"], es: [] },
      }).kind,
      "conflict",
    );
    h.store.sqlite
      .prepare(
        "INSERT INTO names VALUES (?,'la','Testus synonymus','testus synonymus','admin',0)",
      )
      .run(exact.taxonId);
    assert.equal(
      reconcile(h.store.sqlite, {
        ...fish,
        scientificName: "Testus synonymus",
        faoCode: null,
      }).kind,
      "synonym",
    );
  } finally {
    await h.close();
  }
});
test("Incremental import preserves IDs, original rows and manual edits, adds new taxa, and is idempotent", async () => {
  const h = await harness();
  try {
    const admin = client(h.app);
    await admin.login();
    const taxon = (await admin.request("GET", "/api/catalog?q=jurel")).json()
      .items[0] as Taxon;
    const manual = {
      ...toTaxonInput(taxon),
      descriptionEs: "Descripción manual",
      names: [
        ...toTaxonInput(taxon).names,
        {
          language: "es" as const,
          name: "Alias manual",
          isPrimary: 0 as const,
        },
      ],
    };
    assert.equal(
      (
        await admin.request(
          "PATCH",
          `/api/admin/catalog/${taxon.id}`,
          manual,
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    const originals = h.store.sqlite
        .prepare("SELECT * FROM taxa ORDER BY id")
        .all(),
      templates = h.store.sqlite
        .prepare("SELECT * FROM template_members ORDER BY taxon_id")
        .all(),
      names = h.store.sqlite
        .prepare("SELECT * FROM names ORDER BY taxon_id,language,name")
        .all();
    const allowed = { ...policy, descriptionsReuseAllowed: true },
      fish = {
        ...record(),
        names: { ...record().names, es: ["Jurel", "Alias nuevo de fuente"] },
        descriptions: { gl: {}, es: { description: "Descripción de fuente" } },
      };
    const novel = {
      ...record(),
      externalId: "novel",
      scientificName: "Testus novus",
      faoCode: null,
      names: { gl: ["Nome de proba"], es: ["Nombre de prueba"] },
    };
    const first = await importRecords(h.store, [fish, novel], allowed, {
      test: true,
    });
    assert.equal(first.summary.newSpecies, 1);
    assert.equal(first.summary.matches, 1);
    assert.ok(existsSync(first.backup));
    const originalAfter = h.store.sqlite
      .prepare(
        "SELECT * FROM taxa WHERE id NOT LIKE 'pescaderias_%' ORDER BY id",
      )
      .all();
    assert.deepEqual(originalAfter, originals);
    assert.deepEqual(
      h.store.sqlite
        .prepare("SELECT * FROM template_members ORDER BY taxon_id")
        .all(),
      templates,
    );
    assert.deepEqual(
      h.store.sqlite
        .prepare(
          "SELECT * FROM names WHERE source_id<>'pescaderias' ORDER BY taxon_id,language,name",
        )
        .all(),
      names,
    );
    const profile = h.store.sqlite
      .prepare(
        "SELECT description_es,size_status,minimum_cm FROM taxon_profiles WHERE taxon_id=?",
      )
      .get(taxon.id);
    assert.deepEqual(profile, {
      description_es: "Descripción manual",
      size_status: "pending",
      minimum_cm: null,
    });
    assert.ok(
      (
        h.store.sqlite
          .prepare(
            "SELECT count(*) n FROM import_conflicts WHERE kind='manual_priority'",
          )
          .get() as { n: number }
      ).n >= 1,
    );
    assert.equal(
      (
        h.store.sqlite
          .prepare(
            "SELECT count(*) n FROM taxon_size_references WHERE verification_status='pending'",
          )
          .get() as { n: number }
      ).n,
      2,
    );
    const before = JSON.stringify(
        h.store.sqlite
          .prepare("SELECT * FROM import_records ORDER BY id")
          .all(),
      ),
      second = await importRecords(h.store, [fish, novel], allowed, {
        test: true,
      });
    assert.equal(second.summary.newSpecies, 0);
    assert.equal(second.summary.updatedSpecies, 0);
    assert.equal(second.summary.unchanged, 2);
    assert.equal(
      JSON.stringify(
        h.store.sqlite
          .prepare("SELECT * FROM import_records ORDER BY id")
          .all(),
      ),
      before,
    );
    assert.equal(
      preview(h.store.sqlite, [record()])[0]?.match.taxonId,
      taxon.id,
    );
    assertIntegrity(h.store.sqlite);
  } finally {
    await h.close();
  }
});
test("SQL failure rolls back the entire batch and marks the backed-up run failed", async () => {
  const h = await harness();
  try {
    h.store.sqlite.exec(
      "CREATE TRIGGER reject_test_name BEFORE INSERT ON names WHEN NEW.name='FAIL' BEGIN SELECT RAISE(ABORT,'test rollback'); END;",
    );
    const novel = {
      ...record(),
      externalId: "failure",
      scientificName: "Testus failus",
      faoCode: null,
      names: { gl: ["FAIL"], es: [] },
    };
    await assert.rejects(
      () => importRecords(h.store, [record(), novel], policy, { test: true }),
      /test rollback/,
    );
    assert.equal(
      (
        h.store.sqlite.prepare("SELECT count(*) n FROM taxa").get() as {
          n: number;
        }
      ).n,
      932,
    );
    assert.equal(
      (
        h.store.sqlite
          .prepare("SELECT count(*) n FROM import_records")
          .get() as { n: number }
      ).n,
      0,
    );
    assert.equal(
      (
        h.store.sqlite.prepare("SELECT status FROM import_runs").get() as {
          status: string;
        }
      ).status,
      "failed",
    );
    assertIntegrity(h.store.sqlite);
  } finally {
    await h.close();
  }
});
test("Review API enforces admin, revisions, explicit size adoption and unknown versus no minimum", async () => {
  const h = await harness();
  try {
    const admin = client(h.app);
    await admin.login();
    await importRecords(h.store, [record(), record("cephalopod")], policy, {
      test: true,
    });
    assert.equal(
      (await h.app.inject("/api/admin/imports/records")).statusCode,
      401,
    );
    const list = (
      await admin.request("GET", "/api/admin/imports/records")
    ).json();
    assert.equal(list.total, 2);
    const row = list.items.find(
        (x: { scientific_name: string }) =>
          x.scientific_name === "Trachurus trachurus",
      ),
      detail = (
        await admin.request("GET", `/api/admin/imports/records/${row.id}`)
      ).json(),
      size = detail.sizes[0];
    const input = {
      revision: size.revision,
      value: 15,
      unit: "cm",
      method: "total_length",
      scope: "Criterio recreativo revisado para prueba",
      sourceUrl: row.url,
      verificationStatus: "approved",
      useForLeagues: false,
      noMinimumConfirmed: false,
    };
    const result = await admin.request(
      "POST",
      `/api/admin/imports/sizes/${size.id}/review`,
      input,
      crypto.randomUUID(),
    );
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(
      (
        h.store.sqlite
          .prepare("SELECT size_status FROM taxon_profiles WHERE taxon_id=?")
          .get(row.taxon_id) as { size_status: string }
      ).size_status,
      "pending",
    );
    assert.equal(
      (
        await admin.request(
          "POST",
          `/api/admin/imports/sizes/${size.id}/review`,
          { ...input, revision: 2, useForLeagues: true },
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        h.store.sqlite
          .prepare("SELECT minimum_cm FROM taxon_profiles WHERE taxon_id=?")
          .get(row.taxon_id) as { minimum_cm: number }
      ).minimum_cm,
      15,
    );
    assert.equal(
      (
        await admin.request(
          "POST",
          `/api/admin/imports/sizes/${size.id}/review`,
          { ...input, revision: 3, value: null, unit: null },
          crypto.randomUUID(),
        )
      ).statusCode,
      400,
    );
    const octo = list.items.find(
        (x: { scientific_name: string }) =>
          x.scientific_name === "Octopus vulgaris",
      ),
      octoDetail = (
        await admin.request("GET", `/api/admin/imports/records/${octo.id}`)
      ).json();
    assert.equal(
      (
        await admin.request(
          "POST",
          `/api/admin/imports/sizes/${octoDetail.sizes[0].id}/review`,
          {
            ...input,
            revision: 1,
            value: 1000,
            unit: "g",
            method: "individual_weight",
            useForLeagues: true,
          },
          crypto.randomUUID(),
        )
      ).statusCode,
      400,
    );
    assertIntegrity(h.store.sqlite);
  } finally {
    await h.close();
  }
});
test("Import cannot change historical captures, league rules or live scores", async () => {
  const h = await harness();
  try {
    const admin = client(h.app);
    await admin.login();
    const taxonId = reconcile(h.store.sqlite, record()).taxonId!;
    const session = await admin.request(
      "POST",
      "/api/sessions",
      {
        startAt: "2026-10-10T08:00:00+02:00",
        endAt: "2026-10-10T10:00:00+02:00",
        zoneId: null,
        privacy: "private",
        latitude: null,
        longitude: null,
        notes: "",
        revision: 0,
      },
      crypto.randomUUID(),
    );
    assert.equal(session.statusCode, 200, session.body);
    const capture = await admin.request(
      "POST",
      `/api/sessions/${session.json().id}/captures`,
      {
        taxonId,
        caughtAt: "2026-10-10T09:00:00+02:00",
        quantity: 3,
        qualifying: 0,
        retained: 0,
        totalWeightKg: null,
        maxLengthCm: null,
        maxWeightKg: null,
        revision: 0,
      },
      crypto.randomUUID(),
    );
    assert.equal(capture.statusCode, 200, capture.body);
    const league = await admin.request(
      "POST",
      "/api/leagues",
      {
        name: "Preservation test",
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
          groups: [],
        },
      },
      crypto.randomUUID(),
    );
    assert.equal(league.statusCode, 200, league.body);
    const tables = [
      "capture_batches",
      "fishing_sessions",
      "leagues",
      "league_rule_versions",
      "league_groups",
      "league_group_taxa",
      "template_members",
      "scoring_templates",
    ].filter((name) =>
      h.store.sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(name),
    );
    const before = tables.map((name) =>
      JSON.stringify(h.store.sqlite.prepare(`SELECT * FROM ${name}`).all()),
    );
    const ranking = (
      await admin.request("GET", `/api/leagues/${league.json().id}/ranking`)
    ).json();
    await importRecords(h.store, [record(), record("cephalopod")], policy, {
      test: true,
    });
    assert.deepEqual(
      tables.map((name) =>
        JSON.stringify(h.store.sqlite.prepare(`SELECT * FROM ${name}`).all()),
      ),
      before,
    );
    assert.deepEqual(
      (
        await admin.request("GET", `/api/leagues/${league.json().id}/ranking`)
      ).json(),
      ranking,
    );
  } finally {
    await h.close();
  }
});
test("Pending source images require explicit rights and never replace a manual primary", async () => {
  const h = await harness();
  let prepared: Awaited<ReturnType<typeof prepareImage>> | undefined;
  try {
    await importRecords(h.store, [record()], policy, { test: true });
    assert.equal(
      (await downloadAuthorizedImages(h.store, "admin")).downloaded,
      0,
    );
    const row = h.store.sqlite
      .prepare("SELECT * FROM taxon_source_images LIMIT 1")
      .get() as { id: string; taxon_id: string; revision: number };
    h.store.sqlite
      .prepare(
        "INSERT INTO photos(id,taxon_id,uploaded_by,original_url,author,license,license_url,status,is_primary) VALUES ('manual-primary',?,?,?,'Test author','CC0',?,'approved',1)",
      )
      .run(
        row.taxon_id,
        h.admin.id,
        "https://example.org/test-photo",
        "https://creativecommons.org/publicdomain/zero/1.0/",
      );
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#246" },
    })
      .png()
      .toBuffer();
    prepared = await prepareImage(
      h.store,
      row.id,
      {
        revision: row.revision,
        author: "Autor de prueba",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        rightsEvidence:
          "Explicit test file permission, not a real reuse authorization.",
        rightsConfirmed: true,
      },
      async () => ({ json: async () => ({}), bytes: async () => bytes }),
    );
    const saved = h.store.sqlite.transaction(() =>
      prepared!.commit(h.admin.id),
    )();
    assert.equal(
      (
        h.store.sqlite
          .prepare("SELECT id FROM photos WHERE taxon_id=? AND is_primary=1")
          .get(row.taxon_id) as { id: string }
      ).id,
      "manual-primary",
    );
    const photo = h.store.sqlite
      .prepare("SELECT author,provider,is_primary FROM photos WHERE id=?")
      .get(saved.id);
    assert.deepEqual(photo, {
      author: "Autor de prueba",
      provider: "pescaderias",
      is_primary: 0,
    });
    assertIntegrity(h.store.sqlite);
  } finally {
    prepared?.cleanup();
    await h.close();
  }
});
test("A changed source cannot silently undo an administrator's rejection", async () => {
  const h = await harness();
  try {
    const admin = client(h.app);
    await admin.login();
    await importRecords(h.store, [record()], policy, { test: true });
    const row = (
      await admin.request("GET", "/api/admin/imports/records")
    ).json().items[0];
    assert.equal(
      (
        await admin.request(
          "POST",
          `/api/admin/imports/records/${row.id}/review`,
          {
            revision: row.revision,
            action: "reject",
            reason: "Identity needs further manual research",
          },
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    const changed = {
      ...record(),
      names: { ...record().names, es: ["Alias after rejection"] },
    };
    await importRecords(h.store, [changed], policy, { test: true });
    assert.equal(
      (
        h.store.sqlite
          .prepare("SELECT review_status FROM import_records WHERE id=?")
          .get(row.id) as { review_status: string }
      ).review_status,
      "rejected",
    );
    assert.equal(
      h.store.sqlite
        .prepare("SELECT 1 FROM names WHERE name='Alias after rejection'")
        .get(),
      undefined,
    );
  } finally {
    await h.close();
  }
});
