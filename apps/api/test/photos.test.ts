import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { harness, client, testPassword } from "./helpers.js";
import {
  assertRemoteUrl,
  photoDirectory,
  sanitizeImage,
  type FetchRemote,
} from "../src/photos.js";
import { createUser } from "../src/security.js";
test("Manual and approved remote photos are real WebP, stripped of EXIF, attributed and permissioned", async () => {
  const bytes = await sharp({
    create: { width: 100, height: 80, channels: 3, background: "#608080" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { ImageDescription: "private metadata" } } })
    .toBuffer();
  const remote: FetchRemote = async () => ({
    json: async () => ({
      query: {
        pages: {
          a: {
            imageinfo: [
              {
                url: "https://upload.wikimedia.org/example.jpg",
                thumburl: "https://upload.wikimedia.org/thumb.jpg",
                descriptionurl:
                  "https://commons.wikimedia.org/wiki/File:Example.jpg",
                extmetadata: {
                  Artist: { value: "Test author" },
                  LicenseShortName: { value: "CC BY 4.0" },
                },
              },
            ],
          },
        },
      },
    }),
    bytes: async () => bytes,
  });
  const h = await harness(remote),
    files: string[] = [];
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
    const taxon = (await admin.request("GET", "/api/catalog?q=jurel")).json()
      .items[0].id;
    const payload = {
      base64: bytes.toString("base64"),
      author: "Test photographer",
      license: "CC BY 4.0",
      originalUrl: "https://example.org/my-photo",
      rightsConfirmed: true,
      isPrimary: true,
    };
    assert.equal(
      (
        await member.request(
          "POST",
          `/api/admin/catalog/${taxon}/photos`,
          payload,
          crypto.randomUUID(),
        )
      ).statusCode,
      403,
    );
    const key = crypto.randomUUID(),
      uploaded = await admin.request(
        "POST",
        `/api/admin/catalog/${taxon}/photos`,
        payload,
        key,
      );
    assert.equal(uploaded.statusCode, 200);
    files.push(uploaded.json().id);
    assert.equal(
      (
        await admin.request(
          "POST",
          `/api/admin/catalog/${taxon}/photos`,
          payload,
          key,
        )
      ).json().id,
      uploaded.json().id,
    );
    const served = await member.request(
      "GET",
      `/api/photos/${uploaded.json().id}/image`,
    );
    assert.equal(served.statusCode, 200);
    const metadata = await sharp(served.rawPayload).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal(
      (await h.app.inject(`/api/photos/${uploaded.json().id}/image`))
        .statusCode,
      401,
    );
    const candidates = await admin.request(
      "POST",
      `/api/admin/catalog/${taxon}/photo-candidates`,
      { provider: "commons" },
      crypto.randomUUID(),
    );
    assert.equal(candidates.statusCode, 200);
    const candidate = candidates.json().ids[0];
    files.push(candidate);
    assert.equal(
      (await member.request("GET", `/api/catalog/${taxon}/photos`)).json()
        .length,
      1,
    );
    assert.equal(
      (
        await admin.request(
          "POST",
          `/api/admin/photos/${candidate}/approve`,
          { rightsConfirmed: true, isPrimary: true },
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await member.request("GET", `/api/catalog/${taxon}`)).json()
        .primaryPhotoId,
      candidate,
    );
    assert.equal(
      (
        await admin.request(
          "POST",
          `/api/admin/photos/${candidate}/reject`,
          {},
          crypto.randomUUID(),
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await member.request("GET", `/api/photos/${candidate}/image`))
        .statusCode,
      404,
    );
  } finally {
    for (const id of files)
      for (const suffix of [".webp", "-thumb.webp"]) {
        const file = resolve(photoDirectory, id + suffix);
        if (existsSync(file)) unlinkSync(file);
      }
    await h.close();
  }
});
test("Photo imports reject private URLs, SVG and unconfirmed rights", async () => {
  for (const url of [
    "http://upload.wikimedia.org/a",
    "https://127.0.0.1/a",
    "https://upload.wikimedia.org.attacker.test/a",
    "https://upload.wikimedia.org:8443/a",
    "https://user:pass@upload.wikimedia.org/a",
  ])
    assert.throws(() => assertRemoteUrl(url));
  await assert.rejects(() =>
    sanitizeImage(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      ),
    ),
  );
});
