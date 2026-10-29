import type { FastifyInstance } from "fastify";
import { z } from "zod";
import sharp from "sharp";
import { fetch as remoteFetch, EnvHttpProxyAgent } from "undici";
import {
  mkdirSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  createReadStream,
} from "node:fs";
import { resolve } from "node:path";
import type { Store } from "./database.js";
import { settings, root } from "./config.js";
import {
  requireAdmin,
  requireUser,
  idempotent,
  audit,
  HttpError,
} from "./security.js";
export const photoDirectory = resolve(
  root,
  process.env.PHOTO_DIRECTORY ?? "data/photos",
);
const licenses = {
  CC0: "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
  "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "CC BY-SA 2.5": "https://creativecommons.org/licenses/by-sa/2.5/",
  "CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/",
  "CC BY-SA 2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
  "Public domain": "https://creativecommons.org/publicdomain/mark/1.0/",
} as const;
type License = keyof typeof licenses;
export interface Photo {
  id: string;
  taxon_id: string | null;
  capture_id: string | null;
  author: string;
  license: string;
  license_url: string;
  original_url: string;
  local_file: string | null;
  thumbnail_file: string | null;
  remote_url: string | null;
  remote_thumbnail: string | null;
  status: string;
  is_primary: number;
  provider: string;
}
interface Candidate {
  url: string;
  thumbnail: string;
  original: string;
  author: string;
  license: License;
  provider: string;
}
const allowed = new Set([
  "deondesenon.xunta.gal",
  "commons.wikimedia.org",
  "upload.wikimedia.org",
  "api.inaturalist.org",
  "www.inaturalist.org",
  "static.inaturalist.org",
  "inaturalist-open-data.s3.amazonaws.com",
]);
export function assertRemoteUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !allowed.has(url.hostname)
  )
    throw new HttpError(400, "REMOTE_URL_DENIED");
  return url;
}
const agent = new EnvHttpProxyAgent();
export type FetchRemote = (
  url: string,
) => Promise<{ json: () => Promise<unknown>; bytes: () => Promise<Buffer> }>;
export const fetchRemote: FetchRemote = async (value) => {
  assertRemoteUrl(value);
  const res = await remoteFetch(value, {
    dispatcher: agent,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "CeboDePemento/0.1 (private fishing catalog)" },
  });
  if (!res.ok) throw new HttpError(502, "IMAGE_SOURCE_UNAVAILABLE");
  const bytes = async () => {
    if (Number(res.headers.get("content-length")) > 8 * 1024 * 1024)
      throw new HttpError(400, "IMAGE_TOO_LARGE");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body!) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 8 * 1024 * 1024) throw new HttpError(400, "IMAGE_TOO_LARGE");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  };
  return { json: async () => JSON.parse((await bytes()).toString()), bytes };
};
const clean = (value: string) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .trim();
export async function findCandidates(
  scientific: string,
  provider: "commons" | "inaturalist",
  fetcher: FetchRemote = fetchRemote,
): Promise<Candidate[]> {
  if (provider === "commons") {
    const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", generator: "search", gsrsearch: `filetype:bitmap "${scientific}"`, gsrnamespace: "6", gsrlimit: "5", prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "360" })}`;
    const data = (await (await fetcher(url)).json()) as {
      query?: {
        pages?: Record<
          string,
          {
            imageinfo?: {
              url: string;
              thumburl?: string;
              descriptionurl: string;
              extmetadata: Record<string, { value: string }>;
            }[];
          }
        >;
      };
    };
    return Object.values(data.query?.pages ?? {}).flatMap((page) => {
      const info = page.imageinfo?.[0];
      if (!info) return [];
      const label = clean(info.extmetadata.LicenseShortName?.value ?? ""),
        license =
          label in licenses
            ? (label as License)
            : label === "CC0 1.0"
              ? "CC0"
              : undefined,
        author = clean(info.extmetadata.Artist?.value ?? "");
      if (!license || !author) return [];
      assertRemoteUrl(info.url);
      assertRemoteUrl(info.thumburl ?? info.url);
      return [
        {
          url: info.url,
          thumbnail: info.thumburl ?? info.url,
          original: assertRemoteUrl(info.descriptionurl).href,
          author,
          license,
          provider,
        },
      ];
    });
  }
  const data = (await (
    await fetcher(
      `https://api.inaturalist.org/v1/observations?${new URLSearchParams({ taxon_name: scientific, quality_grade: "research", photo_license: "cc0,cc-by,cc-by-sa", per_page: "5" })}`,
    )
  ).json()) as {
    results?: {
      uri: string;
      user: { name?: string; login: string };
      taxon?: { name: string };
      photos: { url: string; license_code: string; license_url?: string }[];
    }[];
  };
  return (data.results ?? [])
    .filter((x) => x.taxon?.name === scientific)
    .flatMap((obs) =>
      obs.photos.slice(0, 1).flatMap((photo) => {
        const license: License | undefined =
          photo.license_code === "cc0"
            ? "CC0"
            : (Object.entries(licenses).find(
                ([label, url]) => url === photo.license_url,
              )?.[0] as License | undefined);
        if (!license) return [];
        const url = photo.url.replace("/square.", "/large.");
        assertRemoteUrl(url);
        return [
          {
            url,
            thumbnail: photo.url,
            original: obs.uri,
            author: obs.user.name ?? obs.user.login,
            license,
            provider,
          },
        ];
      }),
    )
    .slice(0, 5);
}
export async function sanitizeImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024)
    throw new HttpError(400, "IMAGE_TOO_LARGE");
  try {
    const metadata = await sharp(bytes, {
      limitInputPixels: 40_000_000,
    }).metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
      (metadata.pages ?? 1) > 1
    )
      throw new HttpError(400, "IMAGE_TYPE");
    const image = await sharp(bytes, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer(),
      thumbnail = await sharp(image)
        .resize(360, 360, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    return { image, thumbnail };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "IMAGE_TYPE");
  }
}
export function registerPhotos(
  app: FastifyInstance,
  store: Store,
  fetcher: FetchRemote = fetchRemote,
) {
  const get = (id: string) => {
    const row = store.sqlite
      .prepare("SELECT * FROM photos WHERE id=?")
      .get(id) as Photo | undefined;
    if (!row) throw new HttpError(404, "NOT_FOUND");
    return row;
  };
  const taxon = (id: string, admin = false) => {
    const row = store.sqlite
      .prepare("SELECT active FROM taxon_profiles WHERE taxon_id=?")
      .get(id) as { active: number } | undefined;
    if (!row || (!row.active && !admin)) throw new HttpError(404, "NOT_FOUND");
  };
  app.get<{ Params: { id: string } }>(
    "/api/catalog/:id/photos",
    async (req) => {
      const user = requireUser(req);
      taxon(req.params.id, user.role === "admin");
      return store.sqlite
        .prepare(
          `SELECT id,author,license,license_url,original_url,is_primary,status,remote_thumbnail,provider FROM photos WHERE taxon_id=? ${user.role === "admin" ? "" : "AND status='approved'"} ORDER BY is_primary DESC, downloaded_at DESC`,
        )
        .all(req.params.id);
    },
  );
  app.get<{ Params: { id: string; variant: string } }>(
    "/api/photos/:id/:variant",
    async (req, reply) => {
      const user = requireUser(req),
        row = get(req.params.id);
      if (row.status !== "approved") throw new HttpError(404, "NOT_FOUND");
      if (row.taxon_id) taxon(row.taxon_id, user.role === "admin");
      else {
        const session = store.sqlite
          .prepare(
            "SELECT s.owner_id,s.proposed_by,s.status FROM fishing_sessions s JOIN capture_batches c ON c.session_id=s.id WHERE c.id=? AND c.deleted_at IS NULL AND s.deleted_at IS NULL",
          )
          .get(row.capture_id) as
          { owner_id: string; proposed_by: string; status: string } | undefined;
        if (
          !session ||
          (session.status !== "approved" &&
            session.owner_id !== user.id &&
            session.proposed_by !== user.id)
        )
          throw new HttpError(404, "NOT_FOUND");
      }
      const variant = z.enum(["image", "thumbnail"]).parse(req.params.variant),
        file = variant === "image" ? row.local_file : row.thumbnail_file;
      if (
        !file ||
        !/^[-a-z0-9]+\.webp$/.test(file) ||
        !existsSync(resolve(photoDirectory, file))
      )
        throw new HttpError(404, "NOT_FOUND");
      return reply
        .type("image/webp")
        .send(createReadStream(resolve(photoDirectory, file)));
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/captures/:id/photos",
    async (req) => {
      const user = requireUser(req);
      const session = store.sqlite
        .prepare(
          "SELECT s.owner_id,s.proposed_by,s.status FROM fishing_sessions s JOIN capture_batches c ON c.session_id=s.id WHERE c.id=? AND c.deleted_at IS NULL AND s.deleted_at IS NULL",
        )
        .get(req.params.id) as
        { owner_id: string; proposed_by: string; status: string } | undefined;
      if (
        !session ||
        (session.status !== "approved" &&
          session.owner_id !== user.id &&
          session.proposed_by !== user.id)
      )
        throw new HttpError(404, "NOT_FOUND");
      return store.sqlite
        .prepare(
          "SELECT id,author,license,license_url,original_url,is_primary,status,remote_thumbnail,provider FROM photos WHERE capture_id=? AND status='approved'",
        )
        .all(req.params.id);
    },
  );
  for (const kind of ["taxon", "capture"] as const)
    app.post<{ Params: { id: string } }>(
      kind === "taxon"
        ? "/api/admin/catalog/:id/photos"
        : "/api/captures/:id/photos",
      { bodyLimit: 12 * 1024 * 1024 },
      async (req) => {
        const user = kind === "taxon" ? requireAdmin(req) : requireUser(req);
        if (kind === "taxon") taxon(req.params.id, true);
        else {
          const session = store.sqlite
            .prepare(
              "SELECT s.owner_id,s.proposed_by,s.status FROM fishing_sessions s JOIN capture_batches c ON c.session_id=s.id WHERE c.id=? AND c.deleted_at IS NULL AND s.deleted_at IS NULL",
            )
            .get(req.params.id) as
            | { owner_id: string; proposed_by: string; status: string }
            | undefined;
          if (!session) throw new HttpError(404, "NOT_FOUND");
          if (
            session.owner_id !== user.id &&
            !(session.status === "pending" && session.proposed_by === user.id)
          )
            throw new HttpError(403, "FORBIDDEN");
          if (session.status === "rejected")
            throw new HttpError(409, "SESSION_REJECTED");
        }
        const input = z
          .object({
            base64: z.string().max(12 * 1024 * 1024),
            author: z.string().trim().min(1).max(300),
            license: z.enum(Object.keys(licenses) as [License, ...License[]]),
            originalUrl: z
              .string()
              .trim()
              .max(2000)
              .refine(
                (x) =>
                  !x ||
                  (() => {
                    try {
                      const u = new URL(x);
                      return (
                        u.protocol === "https:" && !u.username && !u.password
                      );
                    } catch {
                      return false;
                    }
                  })(),
              ),
            rightsConfirmed: z.literal(true),
            isPrimary: z.boolean(),
          })
          .strict()
          .parse(req.body);
        const { image, thumbnail } = await sanitizeImage(
            Buffer.from(input.base64, "base64"),
          ),
          id = crypto.randomUUID(),
          file = `${id}.webp`,
          thumb = `${id}-thumb.webp`;
        mkdirSync(photoDirectory, { recursive: true });
        writeFileSync(resolve(photoDirectory, file), image);
        writeFileSync(resolve(photoDirectory, thumb), thumbnail);
        try {
          const result = idempotent(store, req, () => {
            if (kind === "taxon" && input.isPrimary)
              store.sqlite
                .prepare("UPDATE photos SET is_primary=0 WHERE taxon_id=?")
                .run(req.params.id);
            store.sqlite
              .prepare(
                `INSERT INTO photos(id,${kind === "taxon" ? "taxon_id" : "capture_id"},uploaded_by,original_url,author,license,license_url,local_file,thumbnail_file,downloaded_at,status,is_primary,modifications) VALUES (?,?,?,?,?,?,?,?,?,?,'approved',?,'WebP resized; metadata removed')`,
              )
              .run(
                id,
                req.params.id,
                user.id,
                input.originalUrl || `/api/photos/${id}/image`,
                input.author,
                input.license,
                licenses[input.license],
                file,
                thumb,
                new Date().toISOString(),
                Number(kind === "taxon" && input.isPrimary),
              );
            audit(store, user.id, "photo.uploaded", "photo", id, null, {
              taxonId: req.params.id,
              license: input.license,
            });
            return { id };
          });
          if (result.id !== id) {
            unlinkSync(resolve(photoDirectory, file));
            unlinkSync(resolve(photoDirectory, thumb));
          }
          return result;
        } catch (error) {
          unlinkSync(resolve(photoDirectory, file));
          unlinkSync(resolve(photoDirectory, thumb));
          throw error;
        }
      },
    );
  app.post<{ Params: { id: string } }>(
    "/api/admin/catalog/:id/photo-candidates",
    async (req) => {
      const user = requireAdmin(req);
      taxon(req.params.id, true);
      const input = z
          .object({ provider: z.enum(["commons", "inaturalist"]) })
          .strict()
          .parse(req.body),
        scientific = (
          store.sqlite
            .prepare("SELECT scientific_name FROM taxa WHERE id=?")
            .get(req.params.id) as { scientific_name: string | null }
        ).scientific_name;
      if (!scientific) throw new HttpError(400, "SCIENTIFIC_NAME_REQUIRED");
      const synonyms = (
        store.sqlite
          .prepare(
            "SELECT name FROM names WHERE taxon_id=? AND language='la' ORDER BY name",
          )
          .all(req.params.id) as { name: string }[]
      ).map((n) => n.name);
      let candidates: Candidate[];
      try {
        const all: Candidate[] = [];
        for (const term of Array.from(new Set([scientific, ...synonyms])).slice(
          0,
          3,
        ))
          all.push(...(await findCandidates(term, input.provider, fetcher)));
        candidates = all
          .filter((c, index) => all.findIndex((x) => x.url === c.url) === index)
          .slice(0, 5);
      } catch (error) {
        req.log.warn(
          { error: error instanceof Error ? error.message : "Source error" },
          "Photo source unavailable",
        );
        throw new HttpError(502, "IMAGE_SOURCE_UNAVAILABLE");
      }
      return idempotent(store, req, () => {
        const ids = [];
        for (const c of candidates) {
          const id = crypto.randomUUID();
          store.sqlite
            .prepare(
              "INSERT INTO photos(id,taxon_id,uploaded_by,original_url,author,license,license_url,status,remote_url,remote_thumbnail,provider) VALUES (?,?,?,?,?,?,?,'candidate',?,?,?)",
            )
            .run(
              id,
              req.params.id,
              user.id,
              c.original,
              c.author,
              c.license,
              licenses[c.license],
              c.url,
              c.thumbnail,
              c.provider,
            );
          ids.push(id);
        }
        audit(
          store,
          user.id,
          "photo.candidates",
          "taxon",
          req.params.id,
          null,
          { provider: input.provider, count: ids.length },
        );
        return { ids };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/photos/:id/approve",
    async (req) => {
      const user = requireAdmin(req);
      const input = z
          .object({ rightsConfirmed: z.literal(true), isPrimary: z.boolean() })
          .strict()
          .parse(req.body),
        row = get(req.params.id);
      if (
        !row.remote_url ||
        !row.taxon_id ||
        !Object.hasOwn(licenses, row.license)
      )
        throw new HttpError(400, "IMAGE_TYPE");
      const bytes = await (await fetcher(row.remote_url)).bytes(),
        { image, thumbnail } = await sanitizeImage(bytes),
        file = `${row.id}.webp`,
        thumb = `${row.id}-thumb.webp`;
      mkdirSync(photoDirectory, { recursive: true });
      writeFileSync(resolve(photoDirectory, file), image);
      writeFileSync(resolve(photoDirectory, thumb), thumbnail);
      return idempotent(store, req, () => {
        if (input.isPrimary)
          store.sqlite
            .prepare("UPDATE photos SET is_primary=0 WHERE taxon_id=?")
            .run(row.taxon_id);
        store.sqlite
          .prepare(
            "UPDATE photos SET local_file=?,thumbnail_file=?,status='approved',is_primary=?,downloaded_at=?,modifications='WebP resized; metadata removed' WHERE id=?",
          )
          .run(
            file,
            thumb,
            Number(input.isPrimary),
            new Date().toISOString(),
            row.id,
          );
        audit(store, user.id, "photo.approved", "photo", row.id);
        return { id: row.id };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/photos/:id/reject",
    async (req) => {
      const user = requireAdmin(req);
      z.object({}).strict().parse(req.body);
      return idempotent(store, req, () => {
        const row = get(req.params.id);
        store.sqlite
          .prepare(
            "UPDATE photos SET status='rejected',is_primary=0 WHERE id=?",
          )
          .run(row.id);
        audit(store, user.id, "photo.rejected", "photo", row.id);
        return { ok: true };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/photos/:id/primary",
    async (req) => {
      const user = requireAdmin(req);
      z.object({}).strict().parse(req.body);
      return idempotent(store, req, () => {
        const row = get(req.params.id);
        if (row.status !== "approved" || !row.taxon_id)
          throw new HttpError(400, "IMAGE_TYPE");
        store.sqlite
          .prepare("UPDATE photos SET is_primary=0 WHERE taxon_id=?")
          .run(row.taxon_id);
        store.sqlite
          .prepare("UPDATE photos SET is_primary=1 WHERE id=?")
          .run(row.id);
        audit(store, user.id, "photo.primary", "photo", row.id);
        return { ok: true };
      });
    },
  );
}
