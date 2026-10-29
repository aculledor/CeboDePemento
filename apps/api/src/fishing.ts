import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import {
  audit,
  idempotent,
  requireUser,
  HttpError,
  type User,
} from "./security.js";
import { instant, fishingDay, civilDate } from "./time.js";
const date = z.iso.datetime({ offset: true });
const sessionInput = z
  .object({
    ownerId: z.string().uuid().optional(),
    startAt: date,
    endAt: date.nullable(),
    zoneId: z.string().nullable(),
    privacy: z.enum(["private", "general", "exact"]),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    notes: z.string().max(5000),
    revision: z.number().int().min(0),
  })
  .strict();
const number = z.number().nonnegative().max(100000).nullable();
const captureInput = z
  .object({
    taxonId: z.string().min(1).max(80),
    caughtAt: date,
    quantity: z.number().int().min(1).max(100000),
    qualifying: z.number().int().nonnegative().nullable(),
    retained: z.number().int().nonnegative(),
    totalWeightKg: number,
    maxLengthCm: number,
    maxWeightKg: number,
    revision: z.number().int().min(0),
    reviewSizeReference: z.boolean().default(false),
  })
  .strict()
  .superRefine((x, ctx) => {
    if (x.retained > x.quantity || (x.qualifying ?? 0) > x.quantity)
      ctx.addIssue({ code: "custom", message: "Quantities exceed total" });
    if (
      x.totalWeightKg !== null &&
      x.maxWeightKg !== null &&
      x.maxWeightKg > x.totalWeightKg
    )
      ctx.addIssue({
        code: "custom",
        message: "Individual weight exceeds total",
      });
  });
export interface FishingSession {
  id: string;
  owner_id: string;
  proposed_by: string;
  start_at: string;
  end_at: string | null;
  zone_id: string | null;
  privacy: "private" | "general" | "exact";
  latitude: number | null;
  longitude: number | null;
  notes: string;
  status: "approved" | "pending" | "rejected";
  revision: number;
  created_at: string;
  owner_name: string;
}
export interface Capture {
  id: string;
  session_id: string;
  taxon_id: string;
  caught_at: string;
  civil_date: string;
  fishing_day: string;
  quantity: number;
  qualifying: number | null;
  retained: number;
  total_weight_kg: number | null;
  max_length_cm: number | null;
  max_weight_kg: number | null;
  size_status_snapshot: "pending" | "has_minimum" | "confirmed_no_minimum";
  minimum_cm_snapshot: number | null;
  declared_at: string;
  revision: number;
}
export function redactSession(row: FishingSession, user: User) {
  const own =
    row.owner_id === user.id ||
    (row.status === "pending" && row.proposed_by === user.id);
  return {
    ...row,
    zone_id: row.privacy === "private" && !own ? null : row.zone_id,
    latitude: own || row.privacy === "exact" ? row.latitude : null,
    longitude: own || row.privacy === "exact" ? row.longitude : null,
  };
}
export function registerFishing(app: FastifyInstance, store: Store) {
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/delete",
    async (req) => {
      const user = requireUser(req),
        input = z
          .object({ revision: z.number().int().positive() })
          .strict()
          .parse(req.body);
      return idempotent(store, req, () => {
        const row = get(req.params.id, user);
        if (
          row.owner_id !== user.id &&
          !(row.status !== "approved" && row.proposed_by === user.id)
        )
          throw new HttpError(403, "FORBIDDEN");
        if (row.revision !== input.revision)
          throw new HttpError(409, "REVISION_CONFLICT");
        store.sqlite
          .prepare(
            "UPDATE fishing_sessions SET deleted_at=?,revision=revision+1 WHERE id=?",
          )
          .run(new Date().toISOString(), row.id);
        audit(
          store,
          user.id,
          "session.archived",
          "fishing_session",
          row.id,
          row,
          { archived: true },
        );
        return { ok: true };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/captures/:id/delete",
    async (req) => {
      const user = requireUser(req),
        input = z
          .object({ revision: z.number().int().positive() })
          .strict()
          .parse(req.body);
      return idempotent(store, req, () => {
        const row = store.sqlite
          .prepare(
            "SELECT * FROM capture_batches WHERE id=? AND deleted_at IS NULL",
          )
          .get(req.params.id) as Capture | undefined;
        if (!row) throw new HttpError(404, "NOT_FOUND");
        editable(get(row.session_id, user), user);
        if (row.revision !== input.revision)
          throw new HttpError(409, "REVISION_CONFLICT");
        store.sqlite
          .prepare(
            "UPDATE capture_batches SET deleted_at=?,revision=revision+1 WHERE id=?",
          )
          .run(new Date().toISOString(), row.id);
        audit(store, user.id, "capture.archived", "capture", row.id, row, {
          archived: true,
        });
        return { ok: true };
      });
    },
  );
  const get = (id: string, user: User) => {
    const row = store.sqlite
      .prepare(
        "SELECT s.*,u.display_name owner_name FROM fishing_sessions s JOIN users u ON u.id=s.owner_id WHERE s.id=? AND s.deleted_at IS NULL",
      )
      .get(id) as FishingSession | undefined;
    if (
      !row ||
      (row.status !== "approved" &&
        row.owner_id !== user.id &&
        row.proposed_by !== user.id)
    )
      throw new HttpError(404, "NOT_FOUND");
    return row;
  };
  const editable = (row: FishingSession, user: User) => {
    if (
      row.owner_id !== user.id &&
      !(row.status === "pending" && row.proposed_by === user.id)
    )
      throw new HttpError(403, "FORBIDDEN");
    if (row.status === "rejected") throw new HttpError(409, "SESSION_REJECTED");
  };
  const timeCheck = (caught: string, row: FishingSession) => {
    if (
      caught < row.start_at ||
      caught > (row.end_at ?? new Date().toISOString())
    )
      throw new HttpError(400, "CAPTURE_OUTSIDE_SESSION");
  };
  app.get("/api/users", async (req) => {
    requireUser(req);
    return store.sqlite
      .prepare(
        "SELECT id,username,display_name FROM users WHERE active=1 ORDER BY display_name",
      )
      .all();
  });
  app.get("/api/sessions", async (req) => {
    const user = requireUser(req);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
        ownerId: z.string().uuid().optional(),
        status: z.enum(["approved", "pending", "rejected"]).optional(),
      })
      .strict()
      .parse(req.query);
    const clauses = [
        "s.deleted_at IS NULL",
        "(s.status='approved' OR s.owner_id=? OR s.proposed_by=?)",
      ],
      params: (string | number)[] = [user.id, user.id];
    if (query.ownerId) {
      clauses.push("s.owner_id=?");
      params.push(query.ownerId);
    }
    if (query.status) {
      clauses.push("s.status=?");
      params.push(query.status);
    }
    params.push(query.pageSize, (query.page - 1) * query.pageSize);
    return store.sqlite
      .prepare(
        `SELECT s.*,u.display_name owner_name FROM fishing_sessions s JOIN users u ON u.id=s.owner_id WHERE ${clauses.join(" AND ")} ORDER BY s.start_at DESC,s.id LIMIT ? OFFSET ?`,
      )
      .all(...params)
      .map((row) => redactSession(row as FishingSession, user));
  });
  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
    const user = requireUser(req),
      row = get(req.params.id, user);
    return {
      ...redactSession(row, user),
      captures: store.sqlite
        .prepare(
          "SELECT c.*,t.scientific_name,(SELECT name FROM names n WHERE n.taxon_id=c.taxon_id AND language='gl' ORDER BY is_primary DESC,name LIMIT 1) name_gl,(SELECT name FROM names n WHERE n.taxon_id=c.taxon_id AND language='es' ORDER BY is_primary DESC,name LIMIT 1) name_es FROM capture_batches c JOIN taxa t ON t.id=c.taxon_id WHERE c.session_id=? AND c.deleted_at IS NULL ORDER BY c.caught_at,c.id",
        )
        .all(row.id),
    };
  });
  const saveSession = (
    data: z.infer<typeof sessionInput>,
    user: User,
    previous?: FishingSession,
  ) => {
    if (previous) {
      editable(previous, user);
      if (previous.revision !== data.revision)
        throw new HttpError(409, "REVISION_CONFLICT");
    }
    const owner = previous?.owner_id ?? data.ownerId ?? user.id,
      start = instant(data.startAt),
      end = data.endAt ? instant(data.endAt) : null;
    if (previous && data.ownerId && data.ownerId !== owner)
      throw new HttpError(400, "OWNER_IMMUTABLE");
    if (
      (end && end < start) ||
      start > new Date(Date.now() + 120000).toISOString() ||
      (end && end > new Date(Date.now() + 120000).toISOString())
    )
      throw new HttpError(400, "INVALID_DATE");
    if ((data.latitude === null) !== (data.longitude === null))
      throw new HttpError(400, "VALIDATION");
    if (
      !store.sqlite
        .prepare("SELECT id FROM users WHERE id=? AND active=1")
        .get(owner)
    )
      throw new HttpError(400, "NOT_FOUND");
    if (
      data.zoneId &&
      data.zoneId !== previous?.zone_id &&
      !store.sqlite
        .prepare("SELECT id FROM zones WHERE id=? AND active=1")
        .get(data.zoneId)
    )
      throw new HttpError(400, "NOT_FOUND");
    if (previous) {
      const captures = store.sqlite
        .prepare(
          "SELECT caught_at FROM capture_batches WHERE session_id=? AND deleted_at IS NULL",
        )
        .all(previous.id) as { caught_at: string }[];
      for (const c of captures)
        timeCheck(c.caught_at, { ...previous, start_at: start, end_at: end });
    }
    const id = previous?.id ?? crypto.randomUUID(),
      status = previous?.status ?? (owner === user.id ? "approved" : "pending"),
      now = new Date().toISOString();
    if (previous)
      store.sqlite
        .prepare(
          "UPDATE fishing_sessions SET start_at=?,end_at=?,zone_id=?,privacy=?,latitude=?,longitude=?,notes=?,revision=revision+1 WHERE id=?",
        )
        .run(
          start,
          end,
          data.zoneId,
          data.privacy,
          data.latitude,
          data.longitude,
          data.notes,
          id,
        );
    else
      store.sqlite
        .prepare(
          "INSERT INTO fishing_sessions(id,owner_id,proposed_by,start_at,end_at,zone_id,privacy,latitude,longitude,notes,status,approved_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          owner,
          user.id,
          start,
          end,
          data.zoneId,
          data.privacy,
          data.latitude,
          data.longitude,
          data.notes,
          status,
          status === "approved" ? now : null,
          now,
        );
    const result = get(id, user);
    audit(
      store,
      user.id,
      previous ? "session.updated" : "session.created",
      "fishing_session",
      id,
      previous ?? null,
      result,
    );
    return redactSession(result, user);
  };
  app.post("/api/sessions", async (req) => {
    const user = requireUser(req),
      input = sessionInput.parse(req.body);
    if (input.revision !== 0) throw new HttpError(400, "VALIDATION");
    return idempotent(store, req, () => saveSession(input, user));
  });
  app.patch<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
    const user = requireUser(req),
      input = sessionInput.parse(req.body);
    return idempotent(store, req, () =>
      saveSession(input, user, get(req.params.id, user)),
    );
  });
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/decision",
    async (req) => {
      const user = requireUser(req),
        input = z
          .object({
            approve: z.boolean(),
            revision: z.number().int().positive(),
          })
          .strict()
          .parse(req.body);
      return idempotent(store, req, () => {
        const row = get(req.params.id, user);
        if (row.owner_id !== user.id) throw new HttpError(403, "FORBIDDEN");
        if (row.status !== "pending" || row.revision !== input.revision)
          throw new HttpError(409, "REVISION_CONFLICT");
        store.sqlite
          .prepare(
            "UPDATE fishing_sessions SET status=?,approved_at=?,revision=revision+1 WHERE id=?",
          )
          .run(
            input.approve ? "approved" : "rejected",
            new Date().toISOString(),
            row.id,
          );
        audit(
          store,
          user.id,
          input.approve ? "session.approved" : "session.rejected",
          "fishing_session",
          row.id,
          row,
          get(row.id, user),
        );
        return redactSession(get(row.id, user), user);
      });
    },
  );
  const saveCapture = (
    data: z.infer<typeof captureInput>,
    session: FishingSession,
    user: User,
    previous?: Capture,
  ) => {
    editable(session, user);
    if (previous && previous.revision !== data.revision)
      throw new HttpError(409, "REVISION_CONFLICT");
    const caught = instant(data.caughtAt);
    timeCheck(caught, session);
    const taxon = store.sqlite
      .prepare(
        "SELECT t.identification_level,p.size_status,p.minimum_cm,p.active FROM taxa t JOIN taxon_profiles p ON p.taxon_id=t.id WHERE t.id=?",
      )
      .get(data.taxonId) as
      | {
          identification_level: string;
          size_status: Capture["size_status_snapshot"];
          minimum_cm: number | null;
          active: number;
        }
      | undefined;
    if (!taxon || (!taxon.active && previous?.taxon_id !== data.taxonId))
      throw new HttpError(400, "NOT_FOUND");
    const preserve =
        previous?.taxon_id === data.taxonId && !data.reviewSizeReference,
      status = preserve
        ? previous!.size_status_snapshot
        : taxon.identification_level === "species_name"
          ? taxon.size_status
          : "pending",
      minimum = preserve
        ? previous!.minimum_cm_snapshot
        : status === "has_minimum"
          ? taxon.minimum_cm
          : null;
    if (status === "has_minimum" && data.qualifying === null)
      throw new HttpError(400, "QUALIFYING_REQUIRED");
    const id = previous?.id ?? crypto.randomUUID(),
      declared = previous?.declared_at ?? new Date().toISOString();
    if (previous)
      store.sqlite
        .prepare(
          "UPDATE capture_batches SET taxon_id=?,caught_at=?,civil_date=?,fishing_day=?,quantity=?,qualifying=?,retained=?,total_weight_kg=?,max_length_cm=?,max_weight_kg=?,size_status_snapshot=?,minimum_cm_snapshot=?,revision=revision+1 WHERE id=?",
        )
        .run(
          data.taxonId,
          caught,
          civilDate(caught),
          fishingDay(caught),
          data.quantity,
          data.qualifying,
          data.retained,
          data.totalWeightKg,
          data.maxLengthCm,
          data.maxWeightKg,
          status,
          minimum,
          id,
        );
    else
      store.sqlite
        .prepare(
          "INSERT INTO capture_batches(id,session_id,taxon_id,caught_at,civil_date,fishing_day,quantity,qualifying,retained,total_weight_kg,max_length_cm,max_weight_kg,size_status_snapshot,minimum_cm_snapshot,declared_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          session.id,
          data.taxonId,
          caught,
          civilDate(caught),
          fishingDay(caught),
          data.quantity,
          data.qualifying,
          data.retained,
          data.totalWeightKg,
          data.maxLengthCm,
          data.maxWeightKg,
          status,
          minimum,
          declared,
        );
    const result = store.sqlite
      .prepare(
        "SELECT * FROM capture_batches WHERE id=? AND deleted_at IS NULL",
      )
      .get(id) as Capture;
    audit(
      store,
      user.id,
      previous ? "capture.updated" : "capture.created",
      "capture",
      id,
      previous ?? null,
      result,
    );
    return result;
  };
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/captures",
    async (req) => {
      const user = requireUser(req),
        input = captureInput.parse(req.body);
      if (input.revision !== 0) throw new HttpError(400, "VALIDATION");
      return idempotent(store, req, () =>
        saveCapture(input, get(req.params.id, user), user),
      );
    },
  );
  app.patch<{ Params: { id: string } }>("/api/captures/:id", async (req) => {
    const user = requireUser(req),
      input = captureInput.parse(req.body);
    return idempotent(store, req, () => {
      const old = store.sqlite
        .prepare(
          "SELECT * FROM capture_batches WHERE id=? AND deleted_at IS NULL",
        )
        .get(req.params.id) as Capture | undefined;
      if (!old) throw new HttpError(404, "NOT_FOUND");
      return saveCapture(input, get(old.session_id, user), user, old);
    });
  });
}
