import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { type Store, backupDatabase } from "../database.js";
import {
  fetchRemote,
  sanitizeImage,
  photoDirectory,
  type FetchRemote,
} from "../photos.js";
import { audit, HttpError } from "../security.js";
import { openLicense, safeUrl } from "./parser.js";

export const imageApprovalSchema = z
  .object({
    revision: z.number().int().positive(),
    author: z.string().trim().min(1).max(1000),
    licenseUrl: z.url(),
    rightsEvidence: z.string().trim().min(10).max(2000),
    rightsConfirmed: z.literal(true),
  })
  .strict();
export async function prepareImage(
  store: Store,
  id: string,
  input: z.infer<typeof imageApprovalSchema>,
  fetcher: FetchRemote = fetchRemote,
) {
  const row = store.sqlite
    .prepare("SELECT * FROM taxon_source_images WHERE id=?")
    .get(id) as
    | {
        revision: number;
        taxon_id: string;
        original_url: string;
        page_url: string;
        authorization: string;
        photo_id: string | null;
      }
    | undefined;
  if (!row) throw new HttpError(404, "NOT_FOUND");
  if (row.revision !== input.revision)
    throw new HttpError(409, "REVISION_CONFLICT");
  const license = openLicense(input.licenseUrl);
  if (!license) throw new HttpError(400, "IMPORT_LICENSE_REQUIRED");
  safeUrl(row.original_url);
  const bytes = await (await fetcher(row.original_url)).bytes(),
    { image, thumbnail } = await sanitizeImage(bytes),
    photoId = crypto.randomUUID();
  mkdirSync(photoDirectory, { recursive: true });
  const file = `${photoId}.webp`,
    thumb = `${photoId}-thumb.webp`;
  const cleanup = () => {
    for (const name of [file, thumb])
      try {
        unlinkSync(resolve(photoDirectory, name));
      } catch {}
  };
  try {
    writeFileSync(resolve(photoDirectory, file), image);
    writeFileSync(resolve(photoDirectory, thumb), thumbnail);
  } catch (error) {
    cleanup();
    throw error;
  }
  return {
    photoId,
    cleanup,
    commit: (actorId: string) => {
      const current = store.sqlite
        .prepare("SELECT revision,photo_id FROM taxon_source_images WHERE id=?")
        .get(id) as { revision: number; photo_id: string | null };
      if (current.revision !== input.revision)
        throw new HttpError(409, "REVISION_CONFLICT");
      if (current.photo_id)
        throw new HttpError(409, "IMPORT_IMAGE_ALREADY_DOWNLOADED");
      store.sqlite
        .prepare(
          "INSERT INTO photos(id,taxon_id,uploaded_by,original_url,author,license,license_url,local_file,thumbnail_file,downloaded_at,status,is_primary,modifications,provider) VALUES (?,?,?,?,?,?,?,?,?,?,'approved',0,'WebP resized; metadata removed','pescaderias')",
        )
        .run(
          photoId,
          row.taxon_id,
          actorId,
          row.page_url,
          input.author,
          license,
          input.licenseUrl,
          file,
          thumb,
          new Date().toISOString(),
        );
      store.sqlite
        .prepare(
          "UPDATE taxon_source_images SET authorization='downloaded',author=?,license=?,license_url=?,rights_evidence=?,photo_id=?,revision=revision+1 WHERE id=?",
        )
        .run(
          input.author,
          license,
          input.licenseUrl,
          input.rightsEvidence,
          photoId,
          id,
        );
      audit(store, actorId, "photo.imported", "taxon", row.taxon_id, null, {
        imageId: id,
        photoId,
        source: row.page_url,
        rightsEvidence: input.rightsEvidence,
      });
      return { id: photoId };
    },
  };
}
export async function downloadAuthorizedImages(
  store: Store,
  username: string,
  fetcher: FetchRemote = fetchRemote,
) {
  const actor = store.sqlite
    .prepare(
      "SELECT id FROM users WHERE username=? AND role='admin' AND active=1",
    )
    .get(username) as { id: string } | undefined;
  if (!actor) throw new Error("Administrador activo no encontrado");
  const rows = store.sqlite
    .prepare(
      "SELECT * FROM taxon_source_images WHERE authorization='authorized' AND photo_id IS NULL",
    )
    .all() as {
    id: string;
    revision: number;
    author: string;
    license_url: string;
    rights_evidence: string;
  }[];
  const result = {
    downloaded: 0,
    errors: [] as { id: string; error: string }[],
  };
  if (rows.length) await backupDatabase(store);
  for (const row of rows) {
    let prepared: Awaited<ReturnType<typeof prepareImage>> | undefined;
    try {
      const input = imageApprovalSchema.parse({
        revision: row.revision,
        author: row.author,
        licenseUrl: row.license_url,
        rightsEvidence: row.rights_evidence,
        rightsConfirmed: true,
      });
      prepared = await prepareImage(store, row.id, input, fetcher);
      store.sqlite.transaction(() => prepared!.commit(actor.id))();
      result.downloaded++;
    } catch (error) {
      prepared?.cleanup();
      result.errors.push({ id: row.id, error: String(error) });
    }
  }
  return result;
}
