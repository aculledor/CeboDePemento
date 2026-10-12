import Database from "better-sqlite3";
import { existsSync, mkdirSync, statSync, readdirSync, cpSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { assertIntegrity } from "./database.js";
import { root } from "./config.js";
export async function restoreToNewFile(sourcePath: string, targetPath: string) {
  const source = resolve(root, sourcePath),
    target = resolve(root, targetPath),
    inside = relative(resolve(root, "data"), target);
  if (
    inside.startsWith("..") ||
    inside === "" ||
    existsSync(target) ||
    !target.endsWith(".sqlite")
  )
    throw new Error("Restore target must be a new .sqlite file inside data/");
  const original = new Database(source, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assertIntegrity(original);
    mkdirSync(dirname(target), { recursive: true });
    await original.backup(target);
  } finally {
    original.close();
  }
  const restored = new Database(target, { readonly: true });
  try {
    assertIntegrity(restored);
  } finally {
    restored.close();
  }
  return target;
}
export async function restoreSnapshot(
  sourcePath: string,
  targetPath: string,
  photosPath?: string,
) {
  const source = resolve(root, sourcePath),
    folder = statSync(source).isDirectory() ? source : dirname(source);
  const file = statSync(source).isDirectory()
    ? readdirSync(source).filter((x) => x.endsWith(".sqlite"))
    : null;
  if (file && file.length !== 1)
    throw new Error("Snapshot must contain exactly one SQLite database");
  let targetPhotos: string | undefined;
  if (photosPath) {
    targetPhotos = resolve(root, photosPath);
    const inside = relative(resolve(root, "data"), targetPhotos);
    if (!inside || inside.startsWith("..") || existsSync(targetPhotos))
      throw new Error(
        "Photo restore target must be a new directory inside data/",
      );
  }
  const database = await restoreToNewFile(
    file ? resolve(folder, file[0]!) : source,
    targetPath,
  );
  if (targetPhotos) {
    if (existsSync(resolve(folder, "photos")))
      cpSync(resolve(folder, "photos"), targetPhotos, { recursive: true });
    else mkdirSync(targetPhotos, { recursive: true });
  }
  return { database, photos: targetPhotos ?? null };
}
