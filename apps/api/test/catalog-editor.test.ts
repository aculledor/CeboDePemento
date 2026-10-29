import { test } from "node:test";
import assert from "node:assert/strict";
import {
  taxonInputSchema,
  toTaxonInput,
  type Taxon,
  type TaxonInput,
} from "@cebo/shared";
import { harness, client, testPassword } from "./helpers.js";
import { createUser } from "../src/security.js";
const input = (taxon: Taxon): TaxonInput =>
  taxonInputSchema.parse(toTaxonInput(taxon));
test("Catalog changes are permissioned, versioned, bilingual, audited and idempotent", async () => {
  const h = await harness();
  try {
    const admin = client(h.app),
      member = client(h.app);
    await admin.login();
    await createUser(h.store, {
      username: "friend",
      displayName: "Friend",
      password: testPassword,
      role: "member",
    });
    await member.login("friend");
    const list = await admin.request("GET", "/api/admin/catalog");
    assert.equal(list.json().total, 932);
    const original = (
      await member.request("GET", "/api/catalog?q=jurel")
    ).json().items[0] as Taxon;
    const change = input(original);
    change.names.push({
      language: "es",
      name: "Alias Ácentuado",
      isPrimary: 0,
    });
    change.descriptionGl = "Descrición revisada";
    change.descriptionEs = "Descripción revisada";
    change.sizeStatus = "has_minimum";
    change.minimumCm = 15;
    change.minimumSource = "Criterio de prueba de competición";
    change.minimumReviewedAt = "2026-10-12T10:00:00.000Z";
    assert.equal(
      (
        await member.request(
          "PATCH",
          `/api/admin/catalog/${original.id}`,
          change,
          crypto.randomUUID(),
        )
      ).statusCode,
      403,
    );
    const key = crypto.randomUUID(),
      saved = await admin.request(
        "PATCH",
        `/api/admin/catalog/${original.id}`,
        change,
        key,
      );
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().revision, 2);
    assert.equal(saved.json().id, original.id);
    assert.deepEqual(
      (
        await admin.request(
          "PATCH",
          `/api/admin/catalog/${original.id}`,
          change,
          key,
        )
      ).json(),
      saved.json(),
    );
    assert.equal(
      (
        await admin.request(
          "PATCH",
          `/api/admin/catalog/${original.id}`,
          change,
          crypto.randomUUID(),
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (await member.request("GET", "/api/catalog?q=alias%20acentuado")).json()
        .items[0].id,
      original.id,
    );
    assert.equal(
      (
        await admin.request("GET", `/api/admin/catalog/${original.id}/history`)
      ).json().length,
      1,
    );
    assert.equal(
      (await member.request("GET", `/api/admin/catalog/${original.id}/history`))
        .statusCode,
      403,
    );
    assert.equal(
      (await admin.request("GET", `/api/operations/${key}`)).json().applied,
      true,
    );
    assert.equal(
      (await member.request("GET", `/api/operations/${key}`)).json().applied,
      false,
    );
    const sources = (
      await member.request("GET", `/api/catalog/${original.id}/sources`)
    ).json();
    assert.ok(sources.find((s: { id: string }) => s.id === "admin"));
    assert.ok(sources.find((s: { id: string }) => s.id === "xunta"));
    const hidden = input(saved.json());
    hidden.active = 0;
    assert.equal(
      (
        await admin.request(
          "PATCH",
          `/api/admin/catalog/${original.id}`,
          hidden,
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await member.request("GET", `/api/catalog/${original.id}`)).statusCode,
      404,
    );
    assert.equal(
      (await member.request("GET", `/api/catalog/${original.id}/sources`))
        .statusCode,
      404,
    );
    assert.equal(
      (await member.request("GET", "/api/catalog?q=jurel")).json().total,
      0,
    );
    assert.equal(
      (await admin.request("GET", `/api/catalog/${original.id}`)).statusCode,
      200,
    );
    assert.equal(
      (
        h.store.sqlite.prepare("SELECT count(*) n FROM taxa").get() as {
          n: number;
        }
      ).n,
      932,
    );
  } finally {
    await h.close();
  }
});
test("Generic taxa and missing names remain explicit; duplicates and invalid size states are rejected", async () => {
  const h = await harness();
  try {
    const admin = client(h.app);
    await admin.login();
    const original = (await admin.request("GET", "/api/catalog?q=jurel")).json()
      .items[0] as Taxon;
    const generic = {
      ...input(original),
      scientificName: null,
      identificationLevel: "unresolved" as const,
      names: [
        { language: "gl" as const, name: "Categoría de proba", isPrimary: 1 },
      ],
      revision: 0,
    };
    const created = await admin.request(
      "POST",
      "/api/admin/catalog",
      generic,
      crypto.randomUUID(),
    );
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().identificationLevel, "unresolved");
    assert.ok(
      !created
        .json()
        .names.some((n: { language: string }) => n.language === "es"),
    );
    assert.equal(
      (
        await admin.request(
          "POST",
          "/api/admin/catalog",
          { ...input(original), revision: 0 },
          crypto.randomUUID(),
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await admin.request(
          "POST",
          "/api/admin/catalog",
          {
            ...input(original),
            scientificName: "trachurus trachurus",
            revision: 0,
          },
          crypto.randomUUID(),
        )
      ).statusCode,
      409,
    );
    assert.equal(
      taxonInputSchema.safeParse({
        ...generic,
        sizeStatus: "has_minimum",
        minimumCm: null,
      }).success,
      false,
    );
    assert.equal(
      taxonInputSchema.safeParse({
        ...generic,
        sizeStatus: "confirmed_no_minimum",
        minimumCm: 20,
      }).success,
      false,
    );
    assert.equal(
      taxonInputSchema.safeParse({
        ...generic,
        sizeStatus: "has_minimum",
        minimumCm: 20,
        minimumSource: "",
        minimumReviewedAt: null,
      }).success,
      false,
    );
    assert.equal(
      taxonInputSchema.safeParse({
        ...generic,
        names: [...generic.names, ...generic.names],
      }).success,
      false,
    );
    assert.equal(
      taxonInputSchema.safeParse({ ...generic, role: "admin" }).success,
      false,
    );
  } finally {
    await h.close();
  }
});
test("All original catalog records can be loaded in the editor without inventing or dropping aliases", async () => {
  const h = await harness();
  try {
    const admin = client(h.app);
    await admin.login();
    let count = 0;
    for (let page = 1; page <= 10; page++) {
      const response = await admin.request(
        "GET",
        `/api/admin/catalog?pageSize=100&page=${page}`,
      );
      for (const taxon of response.json().items as Taxon[]) {
        const edit = toTaxonInput(taxon);
        assert.equal(edit.names.length, taxon.names.length);
        count++;
      }
    }
    assert.equal(count, 932);
  } finally {
    await h.close();
  }
});
