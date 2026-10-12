import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DateTime } from "luxon";
import type { Store } from "./database.js";
import {
  requireUser,
  requireAdmin,
  audit,
  idempotent,
  HttpError,
} from "./security.js";
import { redactSession, type FishingSession, type Capture } from "./fishing.js";
import { leagueBounds, unionHours, fishingDay } from "./time.js";
interface Zone {
  id: string;
  name_gl: string;
  name_es: string;
  description_gl: string;
  description_es: string;
  latitude: number | null;
  longitude: number | null;
  source: string;
  active: number;
  revision: number;
}
const zoneInput = z
  .object({
    nameGl: z.string().trim().min(1).max(120),
    nameEs: z.string().trim().min(1).max(120),
    descriptionGl: z.string().max(5000),
    descriptionEs: z.string().max(5000),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    source: z.string().trim().min(1).max(1000),
    active: z.number().int().min(0).max(1),
    revision: z.number().int().min(0),
  })
  .strict();
export function dailyHours(
  sessions: { start_at: string; end_at: string | null }[],
  now: string,
) {
  const days = new Map<string, { start_at: string; end_at: string }[]>();
  for (const s of sessions) {
    const stop = DateTime.fromISO(s.end_at ?? now).toMillis();
    let cursor = DateTime.fromISO(s.start_at).toMillis(),
      iterations = 0;
    if (cursor === stop && !days.has(fishingDay(s.start_at)))
      days.set(fishingDay(s.start_at), []);
    while (cursor < stop) {
      if (iterations++ > 10000) throw new HttpError(400, "PERIOD_TOO_LONG");
      const day = fishingDay(new Date(cursor).toISOString()),
        bounds = leagueBounds(day, day),
        end = Math.min(Date.parse(bounds.end), stop);
      const list = days.get(day) ?? [];
      list.push({
        start_at: new Date(cursor).toISOString(),
        end_at: new Date(end).toISOString(),
      });
      days.set(day, list);
      cursor = end;
    }
  }
  return new Map(
    Array.from(days, ([day, intervals]) => [day, unionHours(intervals, now)]),
  );
}
export function registerCommunity(app: FastifyInstance, store: Store) {
  app.get("/api/zones", async (req) => {
    requireUser(req);
    return store.sqlite
      .prepare("SELECT * FROM zones WHERE active=1 ORDER BY name_es")
      .all();
  });
  app.get("/api/admin/zones", async (req) => {
    requireAdmin(req);
    return store.sqlite.prepare("SELECT * FROM zones ORDER BY name_es").all();
  });
  const saveZone = (
    input: z.infer<typeof zoneInput>,
    actor: string,
    id?: string,
  ) => {
    if ((input.latitude === null) !== (input.longitude === null))
      throw new HttpError(400, "VALIDATION");
    const old = id
      ? (store.sqlite.prepare("SELECT * FROM zones WHERE id=?").get(id) as
          Zone | undefined)
      : undefined;
    if (id && !old) throw new HttpError(404, "NOT_FOUND");
    if (old && old.revision !== input.revision)
      throw new HttpError(409, "REVISION_CONFLICT");
    id ??= crypto.randomUUID();
    if (old)
      store.sqlite
        .prepare(
          "UPDATE zones SET name_gl=?,name_es=?,description_gl=?,description_es=?,latitude=?,longitude=?,source=?,active=?,revision=revision+1 WHERE id=?",
        )
        .run(
          input.nameGl,
          input.nameEs,
          input.descriptionGl,
          input.descriptionEs,
          input.latitude,
          input.longitude,
          input.source,
          input.active,
          id,
        );
    else
      store.sqlite
        .prepare(
          "INSERT INTO zones(id,name_gl,name_es,description_gl,description_es,latitude,longitude,source,active) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          input.nameGl,
          input.nameEs,
          input.descriptionGl,
          input.descriptionEs,
          input.latitude,
          input.longitude,
          input.source,
          input.active,
        );
    const result = store.sqlite
      .prepare("SELECT * FROM zones WHERE id=?")
      .get(id);
    audit(
      store,
      actor,
      old ? "zone.updated" : "zone.created",
      "zone",
      id,
      old ?? null,
      result,
    );
    return result;
  };
  app.post("/api/admin/zones", async (req) => {
    const user = requireAdmin(req),
      input = zoneInput.parse(req.body);
    if (input.revision !== 0) throw new HttpError(400, "VALIDATION");
    return idempotent(store, req, () => saveZone(input, user.id));
  });
  app.patch<{ Params: { id: string } }>("/api/admin/zones/:id", async (req) => {
    const user = requireAdmin(req),
      input = zoneInput.parse(req.body);
    return idempotent(store, req, () =>
      saveZone(input, user.id, req.params.id),
    );
  });
  app.get("/api/map", async (req) => {
    const user = requireUser(req);
    return {
      zones: store.sqlite
        .prepare("SELECT * FROM zones WHERE active=1 AND latitude IS NOT NULL")
        .all(),
      sessions: store.sqlite
        .prepare(
          "SELECT s.*,u.display_name owner_name FROM fishing_sessions s JOIN users u ON u.id=s.owner_id WHERE s.deleted_at IS NULL AND s.status='approved' AND s.latitude IS NOT NULL AND (s.privacy='exact' OR s.owner_id=?) ORDER BY s.start_at DESC LIMIT 1000",
        )
        .all(user.id)
        .map((row) => {
          const safe = redactSession(row as FishingSession, user);
          return {
            id: safe.id,
            owner: safe.owner_name,
            latitude: safe.latitude,
            longitude: safe.longitude,
            privacy: safe.privacy,
          };
        }),
    };
  });
  app.get("/api/stats", async (req) => {
    requireUser(req);
    const query = z
      .object({
        userId: z.string().uuid().optional(),
        taxonId: z.string().optional(),
        firstDay: z.iso.date().optional(),
        lastDay: z.iso.date().optional(),
      })
      .strict()
      .parse(req.query);
    if (!!query.firstDay !== !!query.lastDay)
      throw new HttpError(400, "VALIDATION");
    const bounds = query.firstDay
        ? leagueBounds(query.firstDay, query.lastDay!)
        : null,
      now = new Date().toISOString();
    const allSessions = store.sqlite
      .prepare(
        "SELECT id,owner_id,start_at,end_at FROM fishing_sessions WHERE deleted_at IS NULL AND status='approved'",
      )
      .all() as {
      id: string;
      owner_id: string;
      start_at: string;
      end_at: string | null;
    }[];
    const allCaptures = store.sqlite
      .prepare(
        "SELECT c.*,s.owner_id,t.identification_level,t.scientific_name FROM capture_batches c JOIN fishing_sessions s ON s.id=c.session_id JOIN taxa t ON t.id=c.taxon_id WHERE c.deleted_at IS NULL AND s.deleted_at IS NULL AND s.status='approved'",
      )
      .all() as (Capture & {
      owner_id: string;
      identification_level: string;
      scientific_name: string | null;
    })[];
    const captures = allCaptures.filter(
      (c) =>
        (!bounds ||
          (c.caught_at >= bounds.start && c.caught_at < bounds.end)) &&
        (!query.userId || c.owner_id === query.userId) &&
        (!query.taxonId || c.taxon_id === query.taxonId),
    );
    const users = store.sqlite
      .prepare("SELECT id,display_name FROM users WHERE active=1")
      .all() as { id: string; display_name: string }[];
    const records = users
      .filter((u) => !query.userId || u.id === query.userId)
      .map((user) => {
        const rows = captures.filter((c) => c.owner_id === user.id),
          sessions = allSessions
            .filter(
              (s) =>
                s.owner_id === user.id &&
                (!query.taxonId || rows.some((c) => c.session_id === s.id)),
            )
            .map((s) => ({
              ...s,
              start_at:
                bounds && s.start_at < bounds.start ? bounds.start : s.start_at,
              end_at:
                bounds && (s.end_at ?? now) > bounds.end
                  ? bounds.end
                  : s.end_at,
            }))
            .filter(
              (s) => Date.parse(s.end_at ?? now) >= Date.parse(s.start_at),
            );
        const byDay = dailyHours(sessions, now),
          quantity = rows.reduce((sum, c) => sum + c.quantity, 0),
          weighted = rows.filter((c) => c.total_weight_kg !== null),
          hours = unionHours(sessions, now),
          max = (key: "max_length_cm" | "max_weight_kg") => {
            const values = rows
              .map((x) => x[key])
              .filter((v): v is number => v !== null);
            return values.length ? Math.max(...values) : null;
          };
        return {
          ...user,
          quantity,
          sessions: sessions.length,
          days: byDay.size,
          hours,
          capturesPerHour: hours ? quantity / hours : null,
          identifiedSpecies: new Set(
            rows
              .filter((c) => c.identification_level === "species_name")
              .map((c) => c.taxon_id),
          ).size,
          declaredKg: weighted.length
            ? weighted.reduce((sum, c) => sum + c.total_weight_kg!, 0)
            : null,
          weightCoverage: { batches: weighted.length, total: rows.length },
          maxLengthCm: max("max_length_cm"),
          maxWeightKg: max("max_weight_kg"),
          evolution: Array.from(byDay, ([day, time]) => ({
            day,
            hours: time,
            quantity: rows
              .filter((c) => c.fishing_day === day)
              .reduce((sum, c) => sum + c.quantity, 0),
          })).sort((a, b) => a.day.localeCompare(b.day)),
        };
      });
    const identified = captures.filter(
        (c) => c.identification_level === "species_name",
      ),
      ids = new Set(identified.map((c) => c.taxon_id));
    const species = Array.from(
      new Set(captures.map((c) => c.taxon_id)),
      (id) => {
        const rows = captures.filter((c) => c.taxon_id === id),
          weights = rows.filter((c) => c.total_weight_kg !== null),
          lengths = rows
            .map((c) => c.max_length_cm)
            .filter((x): x is number => x !== null),
          maxWeights = rows
            .map((c) => c.max_weight_kg)
            .filter((x): x is number => x !== null);
        return {
          taxonId: id,
          scientificName: rows[0]!.scientific_name,
          quantity: rows.reduce((sum, c) => sum + c.quantity, 0),
          declaredKg: weights.length
            ? weights.reduce((sum, c) => sum + c.total_weight_kg!, 0)
            : null,
          maxLengthCm: lengths.length ? Math.max(...lengths) : null,
          maxWeightKg: maxWeights.length ? Math.max(...maxWeights) : null,
        };
      },
    );
    // Exclusivity always considers the whole registered community, even on a personal profile.
    const exclusive = Array.from(ids).flatMap((id) => {
      const matches = allCaptures.filter(
          (c) =>
            c.taxon_id === id &&
            (!bounds ||
              (c.caught_at >= bounds.start && c.caught_at < bounds.end)),
        ),
        owners = new Set(matches.map((c) => c.owner_id));
      return owners.size === 1
        ? [
            {
              taxonId: id,
              scientificName: matches[0]!.scientific_name,
              userId: matches[0]!.owner_id,
            },
          ]
        : [];
    });
    return {
      users: records,
      exclusive,
      species,
      totals: {
        quantity: records.reduce((sum, u) => sum + u.quantity, 0),
        hours: records.reduce((sum, u) => sum + u.hours, 0),
      },
      generatedAt: now,
    };
  });
}
