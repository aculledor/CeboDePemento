import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeSearch } from "@cebo/shared";
import { type Store, assertIntegrity } from "../database.js";
import {
  requireAdmin,
  requireUser,
  idempotent,
  audit,
  HttpError,
} from "../security.js";
import { enrichReviewedRecord } from "./importer.js";
import { policySchema, recordSchema, isGeneric, digest } from "./parser.js";
import { prepareImage, imageApprovalSchema } from "./images.js";

export const sizeReviewSchema = z
  .object({
    revision: z.number().int().min(0),
    value: z.number().positive().nullable(),
    unit: z.enum(["cm", "mm", "g", "kg"]).nullable(),
    method: z
      .enum([
        "total_length",
        "mantle_length",
        "cephalothorax_length",
        "individual_weight",
      ])
      .nullable(),
    scope: z.string().trim().min(5).max(1000),
    sourceUrl: z.url(),
    verificationStatus: z.enum(["pending", "approved", "rejected"]),
    useForLeagues: z.boolean(),
    noMinimumConfirmed: z.boolean().default(false),
  })
  .strict()
  .refine((x) => (x.value === null) === (x.unit === null))
  .refine((x) => !(x.noMinimumConfirmed && x.value !== null));
export function registerImports(app: FastifyInstance, store: Store) {
  const db = store.sqlite;
  const get = (id: string) => {
    const row = db
      .prepare("SELECT * FROM import_records WHERE id=?")
      .get(id) as
      | {
          id: string;
          external_id: string;
          taxon_id: string | null;
          payload_json: string;
          last_run_id: string;
          revision: number;
          category: string;
          url: string;
          fao_code: string | null;
        }
      | undefined;
    if (!row) throw new HttpError(404, "NOT_FOUND");
    return row;
  };
  const pageSchema = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      status: z
        .enum(["all", "pending", "verified", "conflict", "rejected"])
        .default("all"),
      kind: z
        .enum(["all", "new", "exact", "fao", "synonym", "conflict"])
        .default("all"),
    })
    .strict();
  app.get("/api/admin/imports/runs", async (req) => {
    requireAdmin(req);
    return db
      .prepare("SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 100")
      .all();
  });
  app.get("/api/admin/imports/records", async (req) => {
    requireAdmin(req);
    const q = pageSchema.parse(req.query),
      where =
        "WHERE (?='all' OR r.review_status=?) AND (?='all' OR r.match_kind=?)",
      args = [q.status, q.status, q.kind, q.kind];
    const total = (
      db
        .prepare(`SELECT count(*) n FROM import_records r ${where}`)
        .get(...args) as { n: number }
    ).n;
    return {
      items: db
        .prepare(
          `SELECT r.*,t.scientific_name current_scientific_name,(SELECT count(*) FROM import_conflicts c WHERE c.record_id=r.id AND c.status='pending') conflicts,(SELECT count(*) FROM taxon_source_images i WHERE i.record_id=r.id AND i.authorization='pending') pending_images FROM import_records r LEFT JOIN taxa t ON t.id=r.taxon_id ${where} ORDER BY r.retrieved_at DESC,r.id LIMIT 20 OFFSET ?`,
        )
        .all(...args, (q.page - 1) * 20),
      total,
      page: q.page,
      pageSize: 20,
    };
  });
  app.get<{ Params: { id: string } }>(
    "/api/admin/imports/records/:id",
    async (req) => {
      requireAdmin(req);
      const row = get(req.params.id);
      return {
        ...row,
        conflicts: db
          .prepare(
            "SELECT * FROM import_conflicts WHERE record_id=? ORDER BY created_at DESC",
          )
          .all(row.id),
        versions: db
          .prepare(
            "SELECT * FROM import_record_versions WHERE record_id=? ORDER BY id DESC LIMIT 100",
          )
          .all(row.id),
        sizes: db
          .prepare(
            "SELECT * FROM taxon_size_references WHERE record_id=? ORDER BY retrieved_at DESC",
          )
          .all(row.id),
        images: db
          .prepare("SELECT * FROM taxon_source_images WHERE record_id=?")
          .all(row.id),
        manualFields: row.taxon_id
          ? db
              .prepare("SELECT * FROM catalog_manual_fields WHERE taxon_id=?")
              .all(row.taxon_id)
          : [],
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/imports/records/:id/review",
    async (req) => {
      const user = requireAdmin(req),
        input = z
          .object({
            revision: z.number().int().positive(),
            action: z.enum(["link", "create", "verify", "reject"]),
            taxonId: z.string().optional(),
            reason: z.string().trim().min(5).max(2000),
          })
          .strict()
          .parse(req.body);
      return idempotent(store, req, () => {
        const row = get(req.params.id);
        if (row.revision !== input.revision)
          throw new HttpError(409, "REVISION_CONFLICT");
        const record = recordSchema.parse(JSON.parse(row.payload_json));
        let target = row.taxon_id;
        if (input.action === "link") {
          if (!input.taxonId) throw new HttpError(400, "VALIDATION");
          if (target && target !== input.taxonId)
            throw new HttpError(409, "IMPORT_REMAP_DENIED");
          const taxon = db
            .prepare(
              "SELECT category,identification_level FROM taxa WHERE id=?",
            )
            .get(input.taxonId) as
            { category: string; identification_level: string } | undefined;
          if (
            !taxon ||
            taxon.category !== record.category ||
            (isGeneric(record.scientificName) &&
              taxon.identification_level === "species_name")
          )
            throw new HttpError(400, "IMPORT_IDENTITY_INVALID");
          target = input.taxonId;
        }
        if (input.action === "create") {
          if (target || isGeneric(record.scientificName))
            throw new HttpError(409, "IMPORT_IDENTITY_INVALID");
          const key = normalizeSearch(record.scientificName!);
          const all = db.prepare("SELECT scientific_name FROM taxa").all() as {
            scientific_name: string | null;
          }[];
          if (
            all.some((x) => normalizeSearch(x.scientific_name ?? "") === key) ||
            db
              .prepare(
                "SELECT 1 FROM names WHERE language='la' AND search_key=?",
              )
              .get(key)
          )
            throw new HttpError(409, "DUPLICATE_TAXON");
          target = `pescaderias_${digest(record.externalId).slice(0, 20)}`;
          db.prepare(
            "INSERT INTO taxa(id,scientific_name,category,identification_level) VALUES (?,?,?,'species_name')",
          ).run(target, record.scientificName, record.category);
          db.prepare(
            "INSERT INTO taxon_profiles(taxon_id,active) VALUES (?,0)",
          ).run(target);
          db.prepare(
            "INSERT INTO names VALUES (?,'la',?,?, 'pescaderias',0)",
          ).run(target, record.scientificName, key);
        }
        if (input.action !== "reject") {
          if (!target) throw new HttpError(400, "IMPORT_IDENTITY_INVALID");
          db.prepare(
            "INSERT INTO external_taxon_ids VALUES ('pescaderias',?,?,?,?) ON CONFLICT(source_id,external_id) DO UPDATE SET fao_code=excluded.fao_code,url=excluded.url",
          ).run(record.externalId, target, record.faoCode, record.url);
          const run = db
            .prepare("SELECT policy_json FROM import_runs WHERE id=?")
            .get(row.last_run_id) as { policy_json: string };
          enrichReviewedRecord(
            db,
            record,
            row.id,
            target,
            policySchema.parse(JSON.parse(run.policy_json)),
          );
        }
        const status = input.action === "reject" ? "rejected" : "verified";
        db.prepare(
          "UPDATE import_records SET taxon_id=?,review_status=?,revision=revision+1 WHERE id=?",
        ).run(target, status, row.id);
        // Identity conflicts are resolved here; field differences require their own decision.
        db.prepare(
          "UPDATE import_conflicts SET status=?,resolved_at=?,resolved_by=?,resolution_json=? WHERE record_id=? AND field='identity' AND status='pending'",
        ).run(
          input.action === "reject" ? "rejected" : "resolved",
          new Date().toISOString(),
          user.id,
          JSON.stringify(input),
          row.id,
        );
        audit(
          store,
          user.id,
          "import.reviewed",
          "taxon",
          target ?? row.id,
          row,
          { status, reason: input.reason },
        );
        assertIntegrity(db);
        return { id: row.id, taxonId: target, status };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/imports/conflicts/:id/resolve",
    async (req) => {
      const user = requireAdmin(req),
        input = z
          .object({
            decision: z.enum(["keep", "apply"]),
            taxonRevision: z.number().int().positive().optional(),
            reason: z.string().trim().min(5).max(2000),
          })
          .strict()
          .parse(req.body);
      return idempotent(store, req, () => {
        const conflict = db
          .prepare("SELECT * FROM import_conflicts WHERE id=?")
          .get(req.params.id) as
          | {
              id: string;
              record_id: string;
              status: string;
              field: string;
              proposed_json: string;
              current_json: string;
            }
          | undefined;
        if (!conflict) throw new HttpError(404, "NOT_FOUND");
        if (conflict.status !== "pending")
          throw new HttpError(409, "REVISION_CONFLICT");
        if (conflict.field === "identity")
          throw new HttpError(400, "IMPORT_USE_IDENTITY_REVIEW");
        const row = get(conflict.record_id);
        if (input.decision === "apply") {
          if (!row.taxon_id)
            throw new HttpError(400, "IMPORT_IDENTITY_INVALID");
          const profile = db
            .prepare("SELECT revision FROM taxon_profiles WHERE taxon_id=?")
            .get(row.taxon_id) as { revision: number };
          if (profile.revision !== input.taxonRevision)
            throw new HttpError(409, "REVISION_CONFLICT");
          const incoming = JSON.parse(conflict.proposed_json);
          if (
            conflict.field === "descriptionGl" ||
            conflict.field === "descriptionEs"
          ) {
            const column =
              conflict.field === "descriptionGl"
                ? "description_gl"
                : "description_es";
            db.prepare(
              `UPDATE taxon_profiles SET ${column}=?,revision=revision+1 WHERE taxon_id=?`,
            ).run(z.string().max(20000).parse(incoming), row.taxon_id);
          } else if (
            conflict.field === "names.gl" ||
            conflict.field === "names.es"
          ) {
            const language = conflict.field.slice(-2),
              name = z.string().min(1).max(300).parse(incoming);
            db.prepare(
              "INSERT OR IGNORE INTO names VALUES (?,?,?,?, 'pescaderias',0)",
            ).run(row.taxon_id, language, name, normalizeSearch(name));
            db.prepare(
              "UPDATE taxon_profiles SET revision=revision+1 WHERE taxon_id=?",
            ).run(row.taxon_id);
          } else throw new HttpError(400, "IMPORT_USE_CATALOG_EDITOR");
          db.prepare(
            "INSERT INTO catalog_manual_fields VALUES (?,?,?,?) ON CONFLICT(taxon_id,field) DO UPDATE SET edited_by=excluded.edited_by,edited_at=excluded.edited_at",
          ).run(
            row.taxon_id,
            conflict.field.startsWith("names.") ? "names" : conflict.field,
            user.id,
            new Date().toISOString(),
          );
        }
        db.prepare(
          "UPDATE import_conflicts SET status='resolved',resolved_at=?,resolved_by=?,resolution_json=? WHERE id=?",
        ).run(
          new Date().toISOString(),
          user.id,
          JSON.stringify(input),
          conflict.id,
        );
        audit(
          store,
          user.id,
          "import.conflict_resolved",
          "taxon",
          row.taxon_id ?? row.id,
          conflict,
          input,
        );
        return { ok: true };
      });
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/catalog/:id/size-references",
    async (req) => {
      const user = requireUser(req),
        profile = db
          .prepare("SELECT active FROM taxon_profiles WHERE taxon_id=?")
          .get(req.params.id) as { active: number } | undefined;
      if (!profile || (!profile.active && user.role !== "admin"))
        throw new HttpError(404, "NOT_FOUND");
      return db
        .prepare(
          "SELECT * FROM taxon_size_references WHERE taxon_id=? ORDER BY retrieved_at DESC",
        )
        .all(req.params.id);
    },
  );
  for (const existing of [true, false])
    app.post<{ Params: { id: string } }>(
      existing
        ? "/api/admin/imports/sizes/:id/review"
        : "/api/admin/catalog/:id/size-references",
      async (req) => {
        const user = requireAdmin(req),
          input = sizeReviewSchema.parse(req.body);
        return idempotent(store, req, () => {
          const previous = existing
            ? (db
                .prepare("SELECT * FROM taxon_size_references WHERE id=?")
                .get(req.params.id) as
                { taxon_id: string; revision: number } | undefined)
            : undefined;
          if (existing && !previous) throw new HttpError(404, "NOT_FOUND");
          if ((previous?.revision ?? 0) !== input.revision)
            throw new HttpError(409, "REVISION_CONFLICT");
          const taxonId = previous?.taxon_id ?? req.params.id,
            id = existing ? req.params.id : crypto.randomUUID();
          if (!db.prepare("SELECT 1 FROM taxa WHERE id=?").get(taxonId))
            throw new HttpError(404, "NOT_FOUND");
          if (
            input.verificationStatus === "approved" &&
            input.value === null &&
            !input.noMinimumConfirmed
          )
            throw new HttpError(400, "IMPORT_UNKNOWN_MINIMUM");
          if (input.useForLeagues) {
            if (input.verificationStatus !== "approved")
              throw new HttpError(400, "IMPORT_SIZE_NOT_APPROVED");
            if (
              !input.noMinimumConfirmed &&
              (input.method !== "total_length" ||
                !["cm", "mm"].includes(input.unit ?? ""))
            )
              throw new HttpError(400, "IMPORT_SIZE_METHOD_UNSUPPORTED");
            const cm = input.noMinimumConfirmed
              ? null
              : input.unit === "mm"
                ? input.value! / 10
                : input.value;
            db.prepare(
              "UPDATE taxon_profiles SET size_status=?,minimum_cm=?,minimum_source=?,minimum_reviewed_at=?,minimum_reviewed_by=?,revision=revision+1 WHERE taxon_id=?",
            ).run(
              input.noMinimumConfirmed ? "confirmed_no_minimum" : "has_minimum",
              cm,
              `${input.sourceUrl} · ${input.scope}`,
              new Date().toISOString(),
              user.id,
              taxonId,
            );
            for (const field of [
              "sizeStatus",
              "minimumCm",
              "minimumSource",
              "minimumReviewedAt",
            ])
              db.prepare(
                "INSERT INTO catalog_manual_fields VALUES (?,?,?,?) ON CONFLICT(taxon_id,field) DO UPDATE SET edited_by=excluded.edited_by,edited_at=excluded.edited_at",
              ).run(taxonId, field, user.id, new Date().toISOString());
          }
          const scope = input.noMinimumConfirmed
            ? `confirmed_no_minimum: ${input.scope}`
            : input.scope;
          if (existing)
            db.prepare(
              "UPDATE taxon_size_references SET value=?,unit=?,measurement_method=?,scope=?,source_url=?,verification_status=?,manually_edited=1,reviewed_by=?,reviewed_at=?,revision=revision+1 WHERE id=?",
            ).run(
              input.value,
              input.unit,
              input.method,
              scope,
              input.sourceUrl,
              input.verificationStatus,
              user.id,
              new Date().toISOString(),
              id,
            );
          else
            db.prepare(
              "INSERT INTO taxon_size_references(id,taxon_id,source_key,value,unit,measurement_method,literal,scope,source_url,retrieved_at,verification_status,manually_edited,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?, ?,?,?,?,1,?,?)",
            ).run(
              id,
              taxonId,
              `manual:${id}`,
              input.value,
              input.unit,
              input.method,
              "Edición manual",
              scope,
              input.sourceUrl,
              new Date().toISOString(),
              input.verificationStatus,
              user.id,
              new Date().toISOString(),
            );
          audit(
            store,
            user.id,
            "size_reference.reviewed",
            "taxon",
            taxonId,
            previous ?? null,
            { ...input, id },
          );
          return { id };
        });
      },
    );
  app.post<{ Params: { id: string } }>(
    "/api/admin/imports/images/:id/approve",
    async (req) => {
      const user = requireAdmin(req),
        input = imageApprovalSchema.parse(req.body);
      const key = z.string().uuid().parse(req.headers["idempotency-key"]);
      if (
        db
          .prepare(
            "SELECT 1 FROM idempotency WHERE actor_id=? AND operation_id=?",
          )
          .get(user.id, key)
      )
        return idempotent(store, req, () => {
          throw new HttpError(409, "IDEMPOTENCY_CONFLICT");
        });
      const prepared = await prepareImage(store, req.params.id, input);
      try {
        const result = idempotent(store, req, () => prepared.commit(user.id));
        if (result.id !== prepared.photoId) prepared.cleanup();
        return result;
      } catch (error) {
        prepared.cleanup();
        throw error;
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/imports/images/:id/reject",
    async (req) => {
      const user = requireAdmin(req),
        input = z
          .object({ revision: z.number().int().positive() })
          .strict()
          .parse(req.body);
      return idempotent(store, req, () => {
        const result = db
          .prepare(
            "UPDATE taxon_source_images SET authorization='rejected',revision=revision+1 WHERE id=? AND revision=? AND photo_id IS NULL",
          )
          .run(req.params.id, input.revision);
        if (!result.changes) throw new HttpError(409, "REVISION_CONFLICT");
        audit(
          store,
          user.id,
          "import.image_rejected",
          "import_image",
          req.params.id,
        );
        return { ok: true };
      });
    },
  );
}
