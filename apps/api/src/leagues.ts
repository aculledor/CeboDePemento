import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Store } from "./database.js";
import {
  audit,
  idempotent,
  requireUser,
  HttpError,
  hashToken,
  newToken,
} from "./security.js";
import { leagueBounds } from "./time.js";
import type { Capture } from "./fishing.js";
const points = z.number().nonnegative().max(10000).multipleOf(0.000001);
const roundPoints = (value: number) => Math.round(value * 1000000) / 1000000;
const rulesSchema = z
  .object({
    mode: z.enum(["simple", "custom"]),
    defaultPoints: points,
    allowUngrouped: z.boolean(),
    allowGeneric: z.boolean(),
    categories: z.array(z.enum(["fish", "cephalopod", "crustacean"])).max(3),
    taxonIds: z.array(z.string()).max(1000),
    groups: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            name: z.string().min(1).max(80),
            below: points,
            above: points,
            single: points,
            taxonIds: z.array(z.string()).max(1000),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    const all = value.groups.flatMap((g) => g.taxonIds);
    if (
      new Set(all).size !== all.length ||
      new Set(value.groups.map((g) => g.id)).size !== value.groups.length
    )
      ctx.addIssue({
        code: "custom",
        message: "A taxon cannot belong to two scoring groups",
      });
    if (!value.categories.length && !value.taxonIds.length)
      ctx.addIssue({ code: "custom", message: "Select categories or taxa" });
  });
export type Rules = z.infer<typeof rulesSchema>;
const inputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    visibility: z.enum(["open", "private"]),
    firstDay: z.iso.date(),
    lastDay: z.iso.date(),
    rules: rulesSchema,
    useTemplates: z.boolean().default(false),
    revision: z.number().int().min(0),
  })
  .strict();
interface League {
  id: string;
  created_by: string;
  name: string;
  visibility: string;
  first_day: string;
  last_day: string;
  start_at: string;
  end_exclusive_at: string;
  current_version: number;
}
function calculateCapture(
  capture: Pick<
    Capture,
    "taxon_id" | "quantity" | "qualifying" | "size_status_snapshot"
  >,
  taxon: { category: string; identification_level: string },
  rules: Rules,
) {
  if (
    (rules.categories.length &&
      !rules.categories.includes(
        taxon.category as Rules["categories"][number],
      )) ||
    (rules.taxonIds.length && !rules.taxonIds.includes(capture.taxon_id))
  )
    return { points: 0, admitted: false, reason: "outside_scope" };
  if (taxon.identification_level !== "species_name" && !rules.allowGeneric)
    return { points: 0, admitted: false, reason: "generic_excluded" };
  if (rules.mode === "simple")
    return { points: capture.quantity, admitted: true, reason: "simple" };
  const group = rules.groups.find((g) => g.taxonIds.includes(capture.taxon_id));
  if (!group && !rules.allowUngrouped)
    return { points: 0, admitted: false, reason: "ungrouped_excluded" };
  const below = group?.below ?? rules.defaultPoints;
  if (
    taxon.identification_level !== "species_name" ||
    capture.size_status_snapshot === "pending"
  )
    return {
      points: capture.quantity * below,
      admitted: true,
      reason: "basic",
    };
  if (capture.size_status_snapshot === "confirmed_no_minimum")
    return {
      points: capture.quantity * (group?.single ?? rules.defaultPoints),
      admitted: true,
      reason: "single",
    };
  const qualifying = capture.qualifying ?? 0;
  return {
    points:
      (capture.quantity - qualifying) * below +
      qualifying * (group?.above ?? rules.defaultPoints),
    admitted: true,
    reason: "size",
  };
}
export function scoreCapture(...args: Parameters<typeof calculateCapture>) {
  const result = calculateCapture(...args);
  return { ...result, points: roundPoints(result.points) };
}
export function registerLeagues(app: FastifyInstance, store: Store) {
  const get = (id: string, userId: string) => {
    const row = store.sqlite
      .prepare("SELECT * FROM leagues WHERE id=?")
      .get(id) as League | undefined;
    if (
      !row ||
      (row.visibility === "private" &&
        !store.sqlite
          .prepare(
            "SELECT 1 FROM league_members WHERE league_id=? AND user_id=?",
          )
          .get(id, userId))
    )
      throw new HttpError(404, "NOT_FOUND");
    return row;
  };
  const rulesFor = (
    league: League,
    version = league.current_version,
  ): Rules => {
    const rule = store.sqlite
      .prepare(
        "SELECT * FROM league_rule_versions WHERE league_id=? AND version=?",
      )
      .get(league.id, version) as
      | {
          mode: Rules["mode"];
          default_points: number;
          allow_ungrouped: number;
          allow_generic: number;
          scope_json: string;
        }
      | undefined;
    if (!rule) throw new HttpError(404, "NOT_FOUND");
    const scope = JSON.parse(rule.scope_json) as {
      categories: Rules["categories"];
      taxonIds: string[];
    };
    const groups = store.sqlite
      .prepare(
        "SELECT * FROM league_scoring_groups WHERE league_id=? AND version=? ORDER BY group_id",
      )
      .all(league.id, version) as {
      group_id: string;
      name: string;
      below_points: number;
      qualifying_points: number;
      single_points: number;
    }[];
    return {
      mode: rule.mode,
      defaultPoints: rule.default_points,
      allowUngrouped: !!rule.allow_ungrouped,
      allowGeneric: !!rule.allow_generic,
      categories: scope.categories,
      taxonIds: scope.taxonIds,
      groups: groups.map((g) => ({
        id: g.group_id,
        name: g.name,
        below: g.below_points,
        above: g.qualifying_points,
        single: g.single_points,
        taxonIds: (
          store.sqlite
            .prepare(
              "SELECT taxon_id FROM league_group_taxa WHERE league_id=? AND version=? AND group_id=?",
            )
            .all(league.id, version, g.group_id) as { taxon_id: string }[]
        ).map((x) => x.taxon_id),
      })),
    };
  };
  const save = (
    input: z.infer<typeof inputSchema>,
    userId: string,
    previous?: League,
  ) => {
    if (previous && previous.created_by !== userId)
      throw new HttpError(403, "FORBIDDEN");
    if (previous && input.revision !== previous.current_version)
      throw new HttpError(409, "REVISION_CONFLICT");
    const id = previous?.id ?? crypto.randomUUID(),
      version = (previous?.current_version ?? 0) + 1,
      bounds = leagueBounds(input.firstDay, input.lastDay),
      now = new Date().toISOString();
    let rules = input.rules;
    if (!previous && input.useTemplates && rules.mode === "custom") {
      const templates = store.sqlite
        .prepare("SELECT * FROM scoring_templates")
        .all() as {
        id: string;
        name_es: string;
        points_below: number;
        points_legal: number;
      }[];
      rules = {
        ...rules,
        groups: templates.map((g) => ({
          id: g.id,
          name: g.name_es,
          below: g.points_below,
          above: g.points_legal,
          single: g.points_below,
          taxonIds: (
            store.sqlite
              .prepare(
                "SELECT taxon_id FROM template_members WHERE template_id=?",
              )
              .all(g.id) as { taxon_id: string }[]
          ).map((x) => x.taxon_id),
        })),
      };
    }
    rulesSchema.parse(rules);
    for (const taxonId of [
      ...rules.taxonIds,
      ...rules.groups.flatMap((g) => g.taxonIds),
    ])
      if (!store.sqlite.prepare("SELECT id FROM taxa WHERE id=?").get(taxonId))
        throw new HttpError(400, "NOT_FOUND");
    if (previous)
      store.sqlite
        .prepare(
          "UPDATE leagues SET name=?,visibility=?,first_day=?,last_day=?,start_at=?,end_exclusive_at=?,current_version=? WHERE id=?",
        )
        .run(
          input.name,
          input.visibility,
          input.firstDay,
          input.lastDay,
          bounds.start,
          bounds.end,
          version,
          id,
        );
    else {
      store.sqlite
        .prepare(
          "INSERT INTO leagues(id,created_by,name,visibility,first_day,last_day,start_at,end_exclusive_at,current_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          userId,
          input.name,
          input.visibility,
          input.firstDay,
          input.lastDay,
          bounds.start,
          bounds.end,
          version,
          now,
        );
      store.sqlite
        .prepare("INSERT INTO league_members VALUES (?,?,?)")
        .run(id, userId, now);
    }
    store.sqlite
      .prepare("INSERT INTO league_rule_versions VALUES (?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        version,
        rules.mode,
        rules.defaultPoints,
        Number(rules.allowUngrouped),
        Number(rules.allowGeneric),
        JSON.stringify({
          categories: rules.categories,
          taxonIds: rules.taxonIds,
          firstDay: input.firstDay,
          lastDay: input.lastDay,
          start: bounds.start,
          end: bounds.end,
        }),
        userId,
        now,
      );
    for (const group of rules.groups) {
      store.sqlite
        .prepare("INSERT INTO league_scoring_groups VALUES (?,?,?,?,?,?,?)")
        .run(
          id,
          version,
          group.id,
          group.name,
          group.below,
          group.above,
          group.single,
        );
      for (const taxonId of group.taxonIds)
        store.sqlite
          .prepare("INSERT INTO league_group_taxa VALUES (?,?,?,?)")
          .run(id, version, group.id, taxonId);
    }
    audit(
      store,
      userId,
      previous ? "league.rules_changed" : "league.created",
      "league",
      id,
      previous ? { ...previous, rules: rulesFor(previous) } : null,
      { ...input, id, version, rules },
    );
    return { ...get(id, userId), rules };
  };
  app.get("/api/leagues", async (req) => {
    const user = requireUser(req);
    return store.sqlite
      .prepare(
        "SELECT l.*, EXISTS(SELECT 1 FROM league_members m WHERE m.league_id=l.id AND m.user_id=?) joined FROM leagues l WHERE l.visibility='open' OR EXISTS(SELECT 1 FROM league_members m WHERE m.league_id=l.id AND m.user_id=?) ORDER BY l.first_day DESC",
      )
      .all(user.id, user.id);
  });
  app.post("/api/leagues", async (req) => {
    const user = requireUser(req),
      input = inputSchema.parse(req.body);
    if (input.revision !== 0) throw new HttpError(400, "VALIDATION");
    return idempotent(store, req, () => save(input, user.id));
  });
  app.patch<{ Params: { id: string } }>("/api/leagues/:id", async (req) => {
    const user = requireUser(req),
      input = inputSchema.parse(req.body);
    return idempotent(store, req, () =>
      save(input, user.id, get(req.params.id, user.id)),
    );
  });
  app.get<{ Params: { id: string } }>("/api/leagues/:id", async (req) => {
    const user = requireUser(req),
      league = get(req.params.id, user.id),
      query = z
        .object({ version: z.coerce.number().int().positive().optional() })
        .parse(req.query),
      rules = rulesFor(league, query.version ?? league.current_version);
    const snapshot = JSON.parse(
      (
        store.sqlite
          .prepare(
            "SELECT scope_json FROM league_rule_versions WHERE league_id=? AND version=?",
          )
          .get(league.id, query.version ?? league.current_version) as {
          scope_json: string;
        }
      ).scope_json,
    ) as { start?: string; end?: string; firstDay?: string; lastDay?: string };
    const members = store.sqlite
      .prepare(
        "SELECT u.id,u.display_name FROM users u JOIN league_members m ON m.user_id=u.id WHERE m.league_id=?",
      )
      .all(league.id) as { id: string; display_name: string }[];
    const rows = store.sqlite
      .prepare(
        "SELECT c.*,s.owner_id,t.category,t.identification_level FROM capture_batches c JOIN fishing_sessions s ON s.id=c.session_id JOIN taxa t ON t.id=c.taxon_id JOIN league_members m ON m.user_id=s.owner_id AND m.league_id=? WHERE c.deleted_at IS NULL AND s.deleted_at IS NULL AND s.status='approved' AND c.caught_at>=? AND c.caught_at<? ORDER BY c.caught_at,c.id",
      )
      .all(
        league.id,
        snapshot.start ?? league.start_at,
        snapshot.end ?? league.end_exclusive_at,
      ) as (Capture & {
      owner_id: string;
      category: string;
      identification_level: string;
    })[];
    const explanations = rows.map((row) => ({
      captureId: row.id,
      sessionId: row.session_id,
      userId: row.owner_id,
      taxonId: row.taxon_id,
      quantity: row.quantity,
      qualifying: row.qualifying,
      caughtAt: row.caught_at,
      ...scoreCapture(row, row, rules),
    }));
    const ranking = members
      .map((member) => {
        const entries = explanations.filter(
          (x) => x.userId === member.id && x.admitted,
        );
        return {
          ...member,
          points: entries.reduce((sum, x) => roundPoints(sum + x.points), 0),
          quantity: entries.reduce((sum, x) => sum + x.quantity, 0),
        };
      })
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.quantity - a.quantity ||
          a.id.localeCompare(b.id),
      );
    const history = store.sqlite
      .prepare(
        "SELECT version,created_by,created_at FROM league_rule_versions WHERE league_id=? ORDER BY version DESC",
      )
      .all(league.id);
    return {
      ...league,
      first_day: snapshot.firstDay ?? league.first_day,
      last_day: snapshot.lastDay ?? league.last_day,
      start_at: snapshot.start ?? league.start_at,
      end_exclusive_at: snapshot.end ?? league.end_exclusive_at,
      rules,
      ranking,
      explanations,
      history,
      joined: members.some((x) => x.id === user.id),
    };
  });
  app.post<{ Params: { id: string } }>("/api/leagues/:id/join", async (req) => {
    const user = requireUser(req);
    z.object({}).strict().parse(req.body);
    return idempotent(store, req, () => {
      const league = get(req.params.id, user.id);
      if (league.visibility !== "open") throw new HttpError(403, "FORBIDDEN");
      store.sqlite
        .prepare("INSERT OR IGNORE INTO league_members VALUES (?,?,?)")
        .run(league.id, user.id, new Date().toISOString());
      audit(store, user.id, "league.joined", "league", league.id);
      return { ok: true };
    });
  });
  app.post<{ Params: { id: string } }>(
    "/api/leagues/:id/invitations",
    async (req) => {
      const user = requireUser(req);
      z.object({}).strict().parse(req.body);
      return idempotent(store, req, () => {
        const league = get(req.params.id, user.id);
        if (league.created_by !== user.id)
          throw new HttpError(403, "FORBIDDEN");
        const token = newToken(),
          id = crypto.randomUUID(),
          expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        store.sqlite
          .prepare(
            "INSERT INTO league_invitations(id,league_id,token_hash,created_by,expires_at) VALUES (?,?,?,?,?)",
          )
          .run(id, league.id, hashToken(token), user.id, expiresAt);
        audit(store, user.id, "league.invitation", "league", league.id);
        return { token, expiresAt };
      });
    },
  );
  app.post("/api/league-invitations/accept", async (req) => {
    const user = requireUser(req),
      input = z
        .object({ token: z.string().min(20).max(100) })
        .strict()
        .parse(req.body);
    return idempotent(store, req, () => {
      const row = store.sqlite
        .prepare(
          "SELECT id,league_id FROM league_invitations WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
        )
        .get(hashToken(input.token), new Date().toISOString()) as
        { id: string; league_id: string } | undefined;
      if (!row) throw new HttpError(400, "INVALID_TOKEN");
      store.sqlite
        .prepare("INSERT OR IGNORE INTO league_members VALUES (?,?,?)")
        .run(row.league_id, user.id, new Date().toISOString());
      store.sqlite
        .prepare("UPDATE league_invitations SET used_at=?,used_by=? WHERE id=?")
        .run(new Date().toISOString(), user.id, row.id);
      audit(
        store,
        user.id,
        "league.invitation_accepted",
        "league",
        row.league_id,
      );
      return { leagueId: row.league_id };
    });
  });
}
