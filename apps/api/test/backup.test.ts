import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  unlinkSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  backupDatabase,
  backupApplication,
  assertIntegrity,
} from "../src/database.js";
import { restoreToNewFile, restoreSnapshot } from "../src/restore.js";
import { root } from "../src/config.js";
import { harness } from "./helpers.js";
test("WAL backup and restore preserve users, catalog IDs and audit records", async () => {
  const h = await harness(),
    path = resolve(root, `data/test-restore-${crypto.randomUUID()}.sqlite`);
  try {
    const copy = await backupDatabase(h.store),
      restored = await restoreToNewFile(copy, path),
      db = new Database(restored, { readonly: true });
    try {
      assertIntegrity(db);
      assert.equal(
        (db.prepare("SELECT count(*) n FROM taxa").get() as { n: number }).n,
        932,
      );
      assert.equal(
        (db.prepare("SELECT id FROM users").get() as { id: string }).id,
        h.admin.id,
      );
      assert.equal(
        (db.prepare("SELECT count(*) n FROM audit_log").get() as { n: number })
          .n,
        1,
      );
    } finally {
      db.close();
    }
    await assert.rejects(() => restoreToNewFile(copy, path));
    await assert.rejects(() => restoreToNewFile(copy, "catalogo.sqlite"));
  } finally {
    unlinkSync(path);
    await h.close();
  }
});
test("Application snapshot restores photo files and refuses to overwrite an existing target", async () => {
  const h = await harness(),
    id = crypto.randomUUID(),
    photo = resolve(root, `data/photos/test-${id}.webp`),
    target = resolve(root, `data/restore-${id}.sqlite`),
    photos = resolve(root, `data/restore-photos-${id}`);
  try {
    mkdirSync(resolve(root, "data/photos"), { recursive: true });
    writeFileSync(photo, "test fixture bytes");
    const snapshot = await backupApplication(h.store);
    await restoreSnapshot(snapshot.directory, target, photos);
    assert.equal(
      readFileSync(resolve(photos, `test-${id}.webp`), "utf8"),
      "test fixture bytes",
    );
    await assert.rejects(() =>
      restoreSnapshot(snapshot.directory, target, photos),
    );
  } finally {
    unlinkSync(photo);
    rmSync(target, { force: true });
    rmSync(photos, { recursive: true, force: true });
    await h.close();
  }
});
