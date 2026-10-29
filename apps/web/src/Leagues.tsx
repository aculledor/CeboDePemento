import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import type { CatalogResponse, User } from "@cebo/shared";
import { api, newOperationId } from "./api";
import { useOnline } from "./connectivity";
import { useConfirmedWrite } from "./useConfirmedWrite";
import { ErrorMessage } from "./ErrorMessage";
interface Group {
  id: string;
  name: string;
  below: number;
  above: number;
  single: number;
  taxonIds: string[];
}
interface Rules {
  mode: "simple" | "custom";
  defaultPoints: number;
  allowUngrouped: boolean;
  allowGeneric: boolean;
  categories: string[];
  taxonIds: string[];
  groups: Group[];
}
interface League {
  id: string;
  created_by: string;
  name: string;
  visibility: string;
  first_day: string;
  last_day: string;
  current_version: number;
  joined: boolean;
  rules: Rules;
  ranking: {
    id: string;
    display_name: string;
    points: number;
    quantity: number;
  }[];
  explanations: {
    captureId: string;
    sessionId: string;
    taxonId: string;
    caughtAt: string;
    qualifying: number | null;
    userId: string;
    quantity: number;
    points: number;
    reason: string;
  }[];
  history: { version: number; created_at: string }[];
}
export function Leagues() {
  const { t } = useTranslation(),
    online = useOnline(),
    client = useQueryClient(),
    navigate = useNavigate(),
    [token, setToken] = useState(""),
    leagues = useQuery({
      queryKey: ["leagues"],
      queryFn: () => api<League[]>("/leagues"),
      enabled: online,
    });
  const accept = useConfirmedWrite<{ leagueId: string }, unknown>(
    "/league-invitations/accept",
    "POST",
    async (result) => {
      await client.invalidateQueries({ queryKey: ["leagues"] });
      navigate(`/leagues/${result.leagueId}`);
    },
  );
  return (
    <>
      <section className="hero">
        <p className="eyebrow">{t("competition")}</p>
        <h1>{t("leagues")}</h1>
        <Link className="button primary" to="/leagues/new">
          + {t("newLeague")}
        </Link>
      </section>
      <form
        className="adminbox"
        onSubmit={(e) => {
          e.preventDefault();
          accept.mutate({ token });
        }}
      >
        <label>
          {t("leagueInvite")}
          <input
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <button disabled={!online || accept.isPending || accept.uncertain}>
          {t("joinLeague")}
        </button>
        <ErrorMessage error={accept.error} />
        {accept.uncertain && (
          <button type="button" disabled={!online} onClick={accept.reconcile}>
            {t("reconcile")}
          </button>
        )}
      </form>
      <ErrorMessage error={leagues.error} />
      <div className="editlist">
        {online &&
          leagues.data?.map((league) => (
            <Link key={league.id} to={`/leagues/${league.id}`}>
              <span>
                <strong>{league.name}</strong>
                <em>
                  {league.first_day} → {league.last_day}
                </em>
              </span>
              <span>{t(league.joined ? "joined" : "available")} →</span>
            </Link>
          ))}
      </div>
      {leagues.data?.length === 0 && <p>{t("noLeagues")}</p>}
    </>
  );
}
export function LeaguePage({ user }: { user: User }) {
  const { id } = useParams(),
    { t } = useTranslation(),
    online = useOnline(),
    client = useQueryClient(),
    [editing, setEditing] = useState(false),
    [version, setVersion] = useState(""),
    [token, setToken] = useState(""),
    isNew = id === "new";
  const result = useQuery({
    queryKey: ["league", id, version],
    queryFn: () =>
      api<League>(`/leagues/${id}${version ? `?version=${version}` : ""}`),
    enabled: online && !isNew,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["league", id] });
    await client.invalidateQueries({ queryKey: ["leagues"] });
  };
  const join = useConfirmedWrite(`/leagues/${id}/join`, "POST", refresh),
    invite = useConfirmedWrite<{ token: string }, unknown>(
      `/leagues/${id}/invitations`,
      "POST",
      (result) => setToken(result.token),
    );
  if (isNew) return <LeagueEditor done={() => setEditing(false)} />;
  if (!result.data)
    return (
      <>
        <ErrorMessage error={result.error} />
        <p>{t("loading")}</p>
      </>
    );
  const league = result.data;
  if (editing)
    return (
      <LeagueEditor
        key={league.current_version}
        league={league}
        done={() => setEditing(false)}
      />
    );
  return (
    <>
      <Link to="/leagues">← {t("back")}</Link>
      <section className="hero">
        <p className="eyebrow">
          {t("competition")} · {league.first_day} → {league.last_day}
        </p>
        <h1>{league.name}</h1>
        <p>{t("leagueDays")}</p>
        <div className="filters">
          {!league.joined && (
            <button
              className="primary"
              disabled={!online || join.isPending || join.uncertain}
              onClick={() => join.mutate({})}
            >
              {t("joinLeague")}
            </button>
          )}
          {league.created_by === user.id && (
            <>
              <button
                disabled={!online}
                onClick={() => {
                  setVersion("");
                  setEditing(true);
                }}
              >
                {t("editLeague")}
              </button>
              <button
                disabled={!online || invite.isPending || invite.uncertain}
                onClick={() => invite.mutate({})}
              >
                {t("leagueInvite")}
              </button>
            </>
          )}
        </div>
        {token && <code className="token notice">{token}</code>}
        <ErrorMessage error={join.error} />
        <ErrorMessage error={invite.error} />
        {join.uncertain && (
          <button disabled={!online} onClick={join.reconcile}>
            {t("reconcile")}
          </button>
        )}
        {invite.uncertain && (
          <button disabled={!online} onClick={invite.reconcile}>
            {t("reconcile")}
          </button>
        )}
      </section>
      <label>
        {t("ruleVersion")}
        <select value={version} onChange={(e) => setVersion(e.target.value)}>
          <option value="">
            {t("currentVersion")} · {league.current_version}
          </option>
          {league.history.map((h) => (
            <option key={h.version} value={h.version}>
              {h.version} · {new Date(h.created_at).toLocaleDateString()}
            </option>
          ))}
        </select>
      </label>
      <h2>{t("ranking")}</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t("owner")}</th>
              <th>{t("points")}</th>
              <th>{t("quantity")}</th>
            </tr>
          </thead>
          <tbody>
            {online &&
              league.ranking.map((row, index) => (
                <tr key={row.id}>
                  <td>{index + 1}</td>
                  <td>
                    <Link to={`/profiles/${row.id}`}>{row.display_name}</Link>
                  </td>
                  <td>
                    <strong>{row.points}</strong>
                  </td>
                  <td>{row.quantity}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="muted">{t("tieBreak")}</p>
      <details>
        <summary>{t("pointsExplanation")}</summary>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>{t("owner")}</th>
                <th>{t("caughtTime")}</th>
                <th>{t("quantity")}</th>
                <th>{t("points")}</th>
                <th>{t("criterion")}</th>
              </tr>
            </thead>
            <tbody>
              {league.explanations.map((e) => (
                <tr key={e.captureId}>
                  <td>
                    {
                      league.ranking.find((r) => r.id === e.userId)
                        ?.display_name
                    }
                  </td>
                  <td>
                    <Link to={`/sessions/${e.sessionId}`}>
                      {DateTime.fromISO(e.caughtAt)
                        .setZone("Europe/Madrid")
                        .toFormat("dd/MM HH:mm")}
                    </Link>
                  </td>
                  <td>{e.quantity}</td>
                  <td>{e.points}</td>
                  <td>{t(`score_${e.reason}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
function LeagueEditor({ league, done }: { league?: League; done: () => void }) {
  const { t, i18n } = useTranslation(),
    online = useOnline(),
    client = useQueryClient(),
    navigate = useNavigate(),
    [name, setName] = useState(league?.name ?? ""),
    [visibility, setVisibility] = useState(league?.visibility ?? "open"),
    [first, setFirst] = useState(
      league?.first_day ?? DateTime.now().setZone("Europe/Madrid").toISODate()!,
    ),
    [last, setLast] = useState(
      league?.last_day ??
        DateTime.now().setZone("Europe/Madrid").endOf("month").toISODate()!,
    ),
    [rules, setRules] = useState<Rules>(
      league?.rules ?? {
        mode: "simple",
        defaultPoints: 1,
        allowUngrouped: true,
        allowGeneric: false,
        categories: ["fish"],
        taxonIds: [],
        groups: [],
      },
    ),
    [templates, setTemplates] = useState(false);
  const taxa = useQuery({
    queryKey: ["leagueCatalog"],
    queryFn: () => api<CatalogResponse>("/catalog?pageSize=100"),
    enabled: online,
  });
  const save = useConfirmedWrite<League, unknown>(
    league ? `/leagues/${league.id}` : "/leagues",
    league ? "PATCH" : "POST",
    async (result) => {
      await client.invalidateQueries({ queryKey: ["leagues"] });
      await client.invalidateQueries({ queryKey: ["league", result.id] });
      navigate(`/leagues/${result.id}`);
      done();
    },
  );
  const update = (index: number, change: Partial<Group>) =>
    setRules({
      ...rules,
      groups: rules.groups.map((g, i) =>
        i === index ? { ...g, ...change } : g,
      ),
    });
  const options = taxa.data?.items.map((taxon) => (
    <option key={taxon.id} value={taxon.id}>
      {taxon.names.find((n) => n.language === i18n.language && n.isPrimary)
        ?.name ??
        taxon.scientificName ??
        taxon.id}
    </option>
  ));
  return (
    <section className="editor">
      <h1>{t(league ? "editLeague" : "newLeague")}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            name,
            visibility,
            firstDay: first,
            lastDay: last,
            rules,
            useTemplates: templates,
            revision: league?.current_version ?? 0,
          });
        }}
      >
        <fieldset disabled={!online || save.isPending || save.uncertain}>
          <label>
            {t("name")}
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="formgrid">
            <label>
              {t("firstDay")}
              <input
                type="date"
                required
                value={first}
                onChange={(e) => setFirst(e.target.value)}
              />
            </label>
            <label>
              {t("lastDay")}
              <input
                type="date"
                required
                value={last}
                onChange={(e) => setLast(e.target.value)}
              />
            </label>
            <label>
              {t("visibility")}
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                <option value="open">{t("openLeague")}</option>
                <option value="private">{t("privateLeague")}</option>
              </select>
            </label>
            <label>
              {t("scoringMode")}
              <select
                value={rules.mode}
                onChange={(e) =>
                  setRules({ ...rules, mode: e.target.value as Rules["mode"] })
                }
              >
                <option value="simple">{t("simpleLeague")}</option>
                <option value="custom">{t("customLeague")}</option>
              </select>
            </label>
          </div>
          <h2>{t("admission")}</h2>
          <div className="filters">
            {["fish", "cephalopod", "crustacean"].map((category) => (
              <label key={category} className="check">
                <input
                  type="checkbox"
                  checked={rules.categories.includes(category)}
                  onChange={(e) =>
                    setRules({
                      ...rules,
                      categories: e.target.checked
                        ? [...rules.categories, category]
                        : rules.categories.filter((c) => c !== category),
                    })
                  }
                />
                {t(category)}
              </label>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={rules.allowGeneric}
              onChange={(e) =>
                setRules({ ...rules, allowGeneric: e.target.checked })
              }
            />
            {t("allowGeneric")}
          </label>
          <label>
            {t("speciesScope")}
            <select
              multiple
              value={rules.taxonIds}
              onChange={(e) =>
                setRules({
                  ...rules,
                  taxonIds: Array.from(
                    e.target.selectedOptions,
                    (x) => x.value,
                  ),
                })
              }
            >
              {options}
            </select>
          </label>
          <p className="muted">{t("scopeHelp")}</p>
          {rules.mode === "custom" && (
            <>
              <label>
                {t("defaultPoints")}
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={rules.defaultPoints}
                  onChange={(e) =>
                    setRules({
                      ...rules,
                      defaultPoints: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={rules.allowUngrouped}
                  onChange={(e) =>
                    setRules({ ...rules, allowUngrouped: e.target.checked })
                  }
                />
                {t("allowUngrouped")}
              </label>
              {!league && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={templates}
                    onChange={(e) => setTemplates(e.target.checked)}
                  />
                  {t("copyTemplates")}
                </label>
              )}
              {!templates &&
                rules.groups.map((group, index) => (
                  <section key={group.id} className="adminbox">
                    <label>
                      {t("groupName")}
                      <input
                        required
                        value={group.name}
                        onChange={(e) =>
                          update(index, { name: e.target.value })
                        }
                      />
                    </label>
                    <div className="formgrid">
                      {(["below", "above", "single"] as const).map((field) => (
                        <label key={field}>
                          {t(`points_${field}`)}
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={group[field]}
                            onChange={(e) =>
                              update(index, { [field]: Number(e.target.value) })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <label>
                      {t("catalog")}
                      <select
                        multiple
                        value={group.taxonIds}
                        onChange={(e) =>
                          update(index, {
                            taxonIds: Array.from(
                              e.target.selectedOptions,
                              (x) => x.value,
                            ),
                          })
                        }
                      >
                        {options}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setRules({
                          ...rules,
                          groups: rules.groups.filter((g) => g.id !== group.id),
                        })
                      }
                    >
                      {t("removeGroup")}
                    </button>
                  </section>
                ))}
              {!templates && (
                <button
                  type="button"
                  onClick={() =>
                    setRules({
                      ...rules,
                      groups: [
                        ...rules.groups,
                        {
                          id: newOperationId(),
                          name: "",
                          below: 1,
                          above: 2,
                          single: 1,
                          taxonIds: [],
                        },
                      ],
                    })
                  }
                >
                  + {t("newGroup")}
                </button>
              )}
            </>
          )}
          <p className="notice">{t("rulesNotice")}</p>
          <button className="primary">{t("save")}</button>
        </fieldset>
      </form>
      <ErrorMessage error={save.error} />
      {save.uncertain && (
        <button disabled={!online} onClick={save.reconcile}>
          {t("reconcile")}
        </button>
      )}
    </section>
  );
}
