import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  normalizeSearch,
  taxonInputSchema,
  type Taxon,
  type TaxonInput,
} from "@cebo/shared";
import { taxa, names, profiles } from "./schema.js";
import type { Store } from "./database.js";
import {
  requireUser,
  requireAdmin,
  audit,
  idempotent,
  HttpError,
} from "./security.js";
const querySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    category: z.enum(["fish", "cephalopod", "crustacean"]).optional(),
    active: z.enum(["all", "0", "1"]).default("all"),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(24),
  })
  .strict();
export function registerCatalog(app: FastifyInstance, store: Store) {
  const attachNames = (rows: (typeof taxa.$inferSelect)[]): Taxon[] => {
    const ids = rows.map((x) => x.id),
      all = ids.length
        ? store.db
            .select()
            .from(names)
            .where(inArray(names.taxonId, ids))
            .orderBy(names.language, names.isPrimary, names.name)
            .all()
        : [];
    const allProfiles = ids.length
      ? store.db
          .select()
          .from(profiles)
          .where(inArray(profiles.taxonId, ids))
          .all()
      : [];
    const primary = ids.length
      ? (store.sqlite
          .prepare(
            `SELECT id,taxon_id FROM photos WHERE status='approved' AND is_primary=1 AND taxon_id IN (${ids.map(() => "?").join(",")})`,
          )
          .all(...ids) as { id: string; taxon_id: string }[])
      : [];
    return rows.map((row) => {
      const { taxonId, ...profile } = allProfiles.find(
        (p) => p.taxonId === row.id,
      )!;
      return {
        ...row,
        ...profile,
        primaryPhotoId: primary.find((p) => p.taxon_id === row.id)?.id ?? null,
        names: all
          .filter((x) => x.taxonId === row.id)
          .map(({ taxonId, searchKey, ...n }) => n),
      };
    });
  };
  const get = (id: string) => {
    const row = store.db.select().from(taxa).where(eq(taxa.id, id)).get();
    if (!row) throw new HttpError(404, "NOT_FOUND");
    return attachNames([row])[0]!;
  };
  const list = (req: FastifyRequest, admin = false) => {
    if (admin) requireAdmin(req);
    else requireUser(req);
    const query = querySchema.parse(req.query),
      search = normalizeSearch(query.q);
    const where = and(
      admin
        ? query.active === "all"
          ? undefined
          : eq(profiles.active, Number(query.active))
        : eq(profiles.active, 1),
      query.category ? eq(taxa.category, query.category) : undefined,
      search
        ? sql`EXISTS (SELECT 1 FROM names n WHERE n.taxon_id=${taxa.id} AND instr(n.search_key,${search})>0)`
        : undefined,
    );
    const total = store.db
      .select({ total: sql<number>`count(*)` })
      .from(taxa)
      .innerJoin(profiles, eq(profiles.taxonId, taxa.id))
      .where(where)
      .get()!.total;
    const rows = store.db
      .select({ taxon: taxa })
      .from(taxa)
      .innerJoin(profiles, eq(profiles.taxonId, taxa.id))
      .where(where)
      .orderBy(taxa.scientificName, taxa.id)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all();
    return {
      items: attachNames(rows.map((x) => x.taxon)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  };
  const save = (
    input: TaxonInput,
    id: string,
    actorId: string,
    previous?: Taxon,
  ) => {
    if (previous && previous.revision !== input.revision)
      throw new HttpError(409, "REVISION_CONFLICT");
    const duplicate = input.scientificName
      ? store.db
          .select({ id: taxa.id })
          .from(taxa)
          .where(
            sql`${taxa.id}<>${id} AND (lower(${taxa.scientificName})=lower(${input.scientificName}) OR EXISTS (SELECT 1 FROM names n WHERE n.taxon_id=${taxa.id} AND n.language='la' AND n.search_key=${normalizeSearch(input.scientificName)}))`,
          )
          .get()
      : undefined;
    if (duplicate && duplicate.id !== id)
      throw new HttpError(409, "DUPLICATE_TAXON");
    const { names: aliases, revision, minimumReviewedAt, ...values } = input;
    const core = {
      scientificName: values.scientificName,
      category: values.category,
      identificationLevel: values.identificationLevel,
      reviewStatus: values.reviewStatus,
      localPresenceStatus: values.localPresenceStatus,
      notes: values.notes,
    };
    if (previous) store.db.update(taxa).set(core).where(eq(taxa.id, id)).run();
    else
      store.sqlite
        .prepare(
          "INSERT INTO taxa(id,scientific_name,category,identification_level,review_status,local_presence_status,initial_selection,notes) VALUES (?,?,?,?,?,?,0,?)",
        )
        .run(
          id,
          core.scientificName,
          core.category,
          core.identificationLevel,
          core.reviewStatus,
          core.localPresenceStatus,
          core.notes,
        );
    const sizeChanged =
      !previous ||
      previous.sizeStatus !== values.sizeStatus ||
      previous.minimumCm !== values.minimumCm ||
      previous.minimumSource !== values.minimumSource ||
      previous.minimumReviewedAt !== minimumReviewedAt;
    const profile = {
      active: values.active,
      descriptionGl: values.descriptionGl,
      descriptionEs: values.descriptionEs,
      tipsGl: values.tipsGl,
      tipsEs: values.tipsEs,
      taxonomicClass: values.taxonomicClass,
      taxonomicOrder: values.taxonomicOrder,
      family: values.family,
      sizeStatus: values.sizeStatus,
      minimumCm: values.minimumCm,
      minimumSource: values.minimumSource,
      minimumReviewedAt,
      minimumReviewedBy:
        values.sizeStatus === "pending"
          ? null
          : sizeChanged
            ? actorId
            : previous!.minimumReviewedBy,
      revision: (previous?.revision ?? 0) + 1,
    };
    if (previous)
      store.db
        .update(profiles)
        .set(profile)
        .where(eq(profiles.taxonId, id))
        .run();
    else
      store.db
        .insert(profiles)
        .values({ taxonId: id, ...profile })
        .run();
    store.db.delete(names).where(eq(names.taxonId, id)).run();
    const updated = [...aliases];
    if (
      core.scientificName &&
      !updated.some(
        (n) => n.language === "la" && n.name === core.scientificName,
      )
    )
      updated.push({ language: "la", name: core.scientificName, isPrimary: 0 });
    store.db
      .insert(names)
      .values(
        updated.map((n) => ({
          taxonId: id,
          ...n,
          searchKey: normalizeSearch(n.name),
          sourceId:
            previous?.names.find(
              (old) => old.language === n.language && old.name === n.name,
            )?.sourceId ?? "admin",
        })),
      )
      .run();
    const result = get(id);
    audit(
      store,
      actorId,
      previous ? "taxon.updated" : "taxon.created",
      "taxon",
      id,
      previous ?? null,
      result,
    );
    return result;
  };
  app.get("/api/catalog", async (req) => list(req));
  app.get<{ Params: { id: string } }>("/api/catalog/:id", async (req) => {
    const user = requireUser(req),
      taxon = get(req.params.id);
    if (!taxon.active && user.role !== "admin")
      throw new HttpError(404, "NOT_FOUND");
    return taxon;
  });
  app.get<{ Params: { id: string } }>(
    "/api/catalog/:id/sources",
    async (req) => {
      const user = requireUser(req),
        taxon = get(req.params.id);
      if (!taxon.active && user.role !== "admin")
        throw new HttpError(404, "NOT_FOUND");
      return store.sqlite
        .prepare(
          "SELECT s.id,s.title,s.url FROM sources s WHERE s.id IN (SELECT source_id FROM names WHERE taxon_id=? UNION SELECT source_id FROM evidence WHERE taxon_id=?) ORDER BY s.id",
        )
        .all(req.params.id, req.params.id);
    },
  );
  app.get("/api/admin/catalog", async (req) => list(req, true));
  app.post("/api/admin/catalog", async (req) => {
    const user = requireAdmin(req),
      input = taxonInputSchema.parse(req.body);
    if (input.revision !== 0) throw new HttpError(400, "VALIDATION");
    return idempotent(store, req, () =>
      save(input, crypto.randomUUID(), user.id),
    );
  });
  app.patch<{ Params: { id: string } }>(
    "/api/admin/catalog/:id",
    async (req) => {
      const user = requireAdmin(req),
        input = taxonInputSchema.parse(req.body);
      return idempotent(store, req, () =>
        save(input, req.params.id, user.id, get(req.params.id)),
      );
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/admin/catalog/:id/history",
    async (req) => {
      requireAdmin(req);
      get(req.params.id);
      return store.sqlite
        .prepare(
          "SELECT a.id,a.actor_id,u.display_name actor_name,a.action,a.before_json,a.after_json,a.created_at FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_type='taxon' AND a.entity_id=? ORDER BY a.id DESC LIMIT 100",
        )
        .all(req.params.id);
    },
  );
}
