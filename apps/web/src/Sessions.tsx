import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { DateTime } from "luxon";
import type { User, Taxon, CatalogResponse } from "@cebo/shared";
import { api } from "./api";
import { useOnline } from "./connectivity";
import { useConfirmedWrite } from "./useConfirmedWrite";
import { ErrorMessage } from "./ErrorMessage";
import { Gallery, PhotoManager } from "./Photos";
interface Capture {
  name_gl: string | null;
  name_es: string | null;
  scientific_name: string | null;
  id: string;
  taxon_id: string;
  caught_at: string;
  quantity: number;
  qualifying: number | null;
  retained: number;
  total_weight_kg: number | null;
  max_length_cm: number | null;
  max_weight_kg: number | null;
  revision: number;
  size_status_snapshot: string;
  minimum_cm_snapshot: number | null;
  fishing_day: string;
}
interface Session {
  id: string;
  owner_id: string;
  proposed_by: string;
  start_at: string;
  end_at: string | null;
  zone_id: string | null;
  privacy: string;
  latitude: number | null;
  longitude: number | null;
  notes: string;
  status: string;
  revision: number;
  owner_name: string;
  captures: Capture[];
}
const local = (date: string) =>
  DateTime.fromISO(date)
    .setZone("Europe/Madrid")
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
function toInstant(value: string, offset = "") {
  const time = DateTime.fromISO(value, { zone: "Europe/Madrid" }),
    possible = time.getPossibleOffsets();
  if (
    !time.isValid ||
    time.toFormat("yyyy-MM-dd'T'HH:mm") !== value.slice(0, 16) ||
    (possible.length > 1 && !offset)
  )
    throw new Error("Choose Madrid UTC offset");
  return (possible.length > 1 ? possible[Number(offset) - 1]! : time)
    .toUTC()
    .toISO()!;
}
function storedOffset(value?: string) {
  if (!value) return "";
  const time = DateTime.fromISO(value).setZone("Europe/Madrid"),
    possible = time.getPossibleOffsets();
  return possible.length > 1
    ? String(possible.findIndex((p) => p.offset === time.offset) + 1)
    : "";
}
function TimeOffset({
  value,
  offset,
  set,
}: {
  value: string;
  offset: string;
  set: (value: string) => void;
}) {
  const { t } = useTranslation(),
    possible = DateTime.fromISO(value, {
      zone: "Europe/Madrid",
    }).getPossibleOffsets();
  return possible.length > 1 ? (
    <label>
      {t("clockOffset")}
      <select required value={offset} onChange={(e) => set(e.target.value)}>
        <option value="">{t("chooseOffset")}</option>
        {possible.map((time, index) => (
          <option key={index} value={index + 1}>
            {time.toFormat("ZZ")} · UTC
          </option>
        ))}
      </select>
    </label>
  ) : null;
}
const optional = (value: string) => (value === "" ? null : Number(value));
export function Sessions({ user }: { user: User }) {
  const { t } = useTranslation(),
    online = useOnline(),
    [params] = useSearchParams(),
    ownerQuery = params.get("owner"),
    [filter, setFilter] = useState(ownerQuery ? "profile" : "mine"),
    [page, setPage] = useState(1);
  const query = new URLSearchParams({
    page: String(page),
    pageSize: "50",
    ...(filter === "profile" && ownerQuery
      ? { ownerId: ownerQuery }
      : filter === "mine" || filter === "pending"
        ? { ownerId: user.id }
        : {}),
    ...(filter === "all"
      ? { status: "approved" }
      : filter === "pending"
        ? { status: "pending" }
        : {}),
  });
  const sessions = useQuery({
    queryKey: ["sessions", filter, ownerQuery, page],
    queryFn: () => api<Session[]>(`/sessions?${query}`),
    enabled: online,
  });
  const list = sessions.data?.filter((s) =>
    filter === "profile"
      ? s.owner_id === ownerQuery
      : filter === "all"
        ? s.status === "approved"
        : filter === "pending"
          ? s.status === "pending" && s.owner_id === user.id
          : s.owner_id === user.id,
  );
  return (
    <>
      <section className="hero">
        <p className="eyebrow">{t("fishingDiary")}</p>
        <h1>{t("sessions")}</h1>
        <Link className="button primary" to="/sessions/new">
          + {t("newSession")}
        </Link>
      </section>
      <div className="filters">
        {(ownerQuery
          ? ["profile", "mine", "all", "pending"]
          : ["mine", "all", "pending"]
        ).map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
          >
            {t(`sessions_${f}`)}
          </button>
        ))}
      </div>
      <ErrorMessage error={sessions.error} />
      {sessions.isPending && <p>{t("loading")}</p>}
      <div className="editlist">
        {online &&
          list?.map((session) => (
            <Link key={session.id} to={`/sessions/${session.id}`}>
              <span>
                <strong>{session.owner_name}</strong>
                <em>
                  {local(session.start_at).replace("T", " · ")} →{" "}
                  {session.end_at
                    ? local(session.end_at).replace("T", " · ")
                    : t("activeSession")}
                </em>
              </span>
              <span>{t(`session_${session.status}`)} →</span>
            </Link>
          ))}
      </div>
      {list?.length === 0 && <p>{t("noSessions")}</p>}
      <div className="pagination">
        <button
          disabled={!online || page === 1}
          onClick={() => setPage(page - 1)}
        >
          {t("previous")}
        </button>
        <span>{page}</span>
        <button
          disabled={!online || (sessions.data?.length ?? 0) < 50}
          onClick={() => setPage(page + 1)}
        >
          {t("next")}
        </button>
      </div>
    </>
  );
}
export function SessionPage({ user }: { user: User }) {
  const { id } = useParams(),
    online = useOnline(),
    isNew = id === "new",
    client = useQueryClient(),
    { t, i18n } = useTranslation(),
    navigate = useNavigate();
  const result = useQuery({
    queryKey: ["session", id],
    queryFn: () => api<Session>(`/sessions/${id}`),
    enabled: online && !isNew,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["session", id] });
    await client.invalidateQueries({ queryKey: ["sessions"] });
    await client.invalidateQueries({ queryKey: ["stats"] });
    await client.invalidateQueries({ queryKey: ["league"] });
  };
  const decision = useConfirmedWrite(
    `/sessions/${id}/decision`,
    "POST",
    refresh,
  );
  const remove = useConfirmedWrite(
    `/sessions/${id}/delete`,
    "POST",
    async () => {
      await refresh();
      navigate("/sessions");
    },
  );
  if (!isNew && !result.data)
    return (
      <>
        <ErrorMessage error={result.error} />
        <p>{t("loading")}</p>
      </>
    );
  const session = result.data,
    editable =
      !session ||
      session.owner_id === user.id ||
      (session.status === "pending" && session.proposed_by === user.id);
  return (
    <>
      <Link to="/sessions">← {t("back")}</Link>
      {editable && session?.status !== "rejected" ? (
        <SessionForm
          key={`${id}-${session?.revision ?? 0}`}
          user={user}
          session={session}
        />
      ) : (
        <section className="hero">
          <h1>{session?.owner_name}</h1>
          <p>{session?.notes}</p>
        </section>
      )}
      {session && (
        <>
          <p className="notice">
            {t(`session_${session.status}`)} · {t(`privacy_${session.privacy}`)}
            {session.latitude !== null
              ? ` · ${session.latitude}, ${session.longitude}`
              : ""}
          </p>
          {session.status === "pending" && session.owner_id === user.id && (
            <>
              <div className="filters">
                <button
                  disabled={!online || decision.isPending || decision.uncertain}
                  onClick={() =>
                    decision.mutate({
                      approve: true,
                      revision: session.revision,
                    })
                  }
                >
                  {t("approveSession")}
                </button>
                <button
                  disabled={!online || decision.isPending || decision.uncertain}
                  onClick={() =>
                    decision.mutate({
                      approve: false,
                      revision: session.revision,
                    })
                  }
                >
                  {t("rejectSession")}
                </button>
              </div>
              <ErrorMessage error={decision.error} />
              {decision.uncertain && (
                <button disabled={!online} onClick={decision.reconcile}>
                  {t("reconcile")}
                </button>
              )}
            </>
          )}
          {editable && (
            <>
              <button
                disabled={!online || remove.isPending || remove.uncertain}
                onClick={() => remove.mutate({ revision: session.revision })}
              >
                {t("deleteSession")}
              </button>
              <ErrorMessage error={remove.error} />
              {remove.uncertain && (
                <button disabled={!online} onClick={remove.reconcile}>
                  {t("reconcile")}
                </button>
              )}
            </>
          )}
          <h2>{t("captures")}</h2>
          {editable && session.status !== "rejected" && (
            <CaptureForm
              key={`${id}-new`}
              session={session}
              refresh={refresh}
            />
          )}
          <div className="capturelist">
            {session.captures.map((capture) =>
              editable && session.status !== "rejected" ? (
                <details key={`${capture.id}-${capture.revision}`}>
                  <summary>
                    {capture.quantity} ·{" "}
                    {(i18n.language === "gl"
                      ? capture.name_gl
                      : capture.name_es) ??
                      capture.scientific_name ??
                      t("generic")}{" "}
                    · {local(capture.caught_at).replace("T", " · ")} ·{" "}
                    {t("editCapture")}
                  </summary>
                  <CaptureForm
                    session={session}
                    capture={capture}
                    refresh={refresh}
                  />
                  <PhotoManager id={capture.id} capture />
                </details>
              ) : (
                <article className="adminbox" key={capture.id}>
                  {capture.quantity} ·{" "}
                  {(i18n.language === "gl"
                    ? capture.name_gl
                    : capture.name_es) ??
                    capture.scientific_name ??
                    t("generic")}{" "}
                  · {local(capture.caught_at)} ·{" "}
                  {capture.total_weight_kg ?? "—"} kg
                  <Gallery id={capture.id} capture />
                </article>
              ),
            )}
          </div>
        </>
      )}
    </>
  );
}
function SessionForm({ session, user }: { session?: Session; user: User }) {
  const { t, i18n } = useTranslation(),
    online = useOnline(),
    navigate = useNavigate(),
    client = useQueryClient();
  const [start, setStart] = useState(
      session ? local(session.start_at) : local(new Date().toISOString()),
    ),
    [end, setEnd] = useState(session?.end_at ? local(session.end_at) : ""),
    [owner, setOwner] = useState(session?.owner_id ?? user.id),
    [privacy, setPrivacy] = useState(session?.privacy ?? "private"),
    [lat, setLat] = useState(session?.latitude?.toString() ?? ""),
    [lng, setLng] = useState(session?.longitude?.toString() ?? ""),
    [notes, setNotes] = useState(session?.notes ?? ""),
    [zone, setZone] = useState(session?.zone_id ?? ""),
    [invalidDate, setInvalidDate] = useState(false),
    [startOffset, setStartOffset] = useState(storedOffset(session?.start_at)),
    [endOffset, setEndOffset] = useState(
      storedOffset(session?.end_at ?? undefined),
    );
  const users = useQuery({
      queryKey: ["publicUsers"],
      queryFn: () => api<{ id: string; display_name: string }[]>("/users"),
      enabled: online,
    }),
    zones = useQuery({
      queryKey: ["zones"],
      queryFn: () =>
        api<{ id: string; name_gl: string; name_es: string }[]>("/zones"),
      enabled: online,
    });
  const save = useConfirmedWrite<Session, unknown>(
    session ? `/sessions/${session.id}` : "/sessions",
    session ? "PATCH" : "POST",
    async (result) => {
      await client.invalidateQueries({ queryKey: ["sessions"] });
      await client.invalidateQueries({ queryKey: ["session", result.id] });
      navigate(`/sessions/${result.id}`);
    },
  );
  const submit = (closed = false) => {
    try {
      setInvalidDate(false);
      save.mutate({
        ownerId: owner,
        startAt: toInstant(start, startOffset),
        endAt: closed
          ? new Date().toISOString()
          : end
            ? toInstant(end, endOffset)
            : null,
        zoneId: zone || null,
        privacy,
        latitude: optional(lat),
        longitude: optional(lng),
        notes,
        revision: session?.revision ?? 0,
      });
    } catch {
      setInvalidDate(true);
    }
  };
  return (
    <section className="editor">
      <h1>{t(session ? "editSession" : "newSession")}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={!online || save.isPending || save.uncertain}>
          <div className="formgrid">
            <label>
              {t("startTime")} · Europe/Madrid
              <input
                type="datetime-local"
                step="1"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              {t("endTime")}
              <input
                type="datetime-local"
                step="1"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <TimeOffset
              value={start}
              offset={startOffset}
              set={setStartOffset}
            />
            <TimeOffset value={end} offset={endOffset} set={setEndOffset} />
            <label>
              {t("owner")}
              <select
                disabled={!!session}
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              >
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("privacy")}
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value)}
              >
                {["private", "general", "exact"].map((p) => (
                  <option key={p} value={p}>
                    {t(`privacy_${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("zone")}
              <select value={zone} onChange={(e) => setZone(e.target.value)}>
                <option value="">{t("noZone")}</option>
                {zone && !zones.data?.some((z) => z.id === zone) && (
                  <option value={zone}>{t("historicalZone")}</option>
                )}
                {zones.data?.map((z) => (
                  <option key={z.id} value={z.id}>
                    {i18n.language === "gl" ? z.name_gl : z.name_es}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("latitude")}
              <input
                type="number"
                min="-90"
                max="90"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
            </label>
            <label>
              {t("longitude")}
              <input
                type="number"
                min="-180"
                max="180"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
              />
            </label>
          </div>
          <label>
            {t("sessionNotes")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <p className="muted">{t("activeHelp")}</p>
          {invalidDate && <p className="error">{t("ambiguousDate")}</p>}
          <div className="filters">
            <button className="primary">{t("save")}</button>
            {session && !session.end_at && (
              <button type="button" onClick={() => submit(true)}>
                {t("closeSession")}
              </button>
            )}
          </div>
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
function CaptureForm({
  session,
  capture,
  refresh,
}: {
  session: Session;
  capture?: Capture;
  refresh: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation(),
    online = useOnline(),
    [q, setQ] = useState(""),
    [species, setSpecies] = useState(capture?.taxon_id ?? ""),
    [caught, setCaught] = useState(
      capture
        ? local(capture.caught_at)
        : local(session.end_at ?? new Date().toISOString()),
    ),
    [quantity, setQuantity] = useState(capture?.quantity ?? 1),
    [qualifying, setQualifying] = useState(
      capture?.qualifying?.toString() ?? "",
    ),
    [retained, setRetained] = useState(capture?.retained ?? 0),
    [weight, setWeight] = useState(capture?.total_weight_kg?.toString() ?? ""),
    [length, setLength] = useState(capture?.max_length_cm?.toString() ?? ""),
    [maxWeight, setMaxWeight] = useState(
      capture?.max_weight_kg?.toString() ?? "",
    ),
    [invalidDate, setInvalidDate] = useState(false),
    [caughtOffset, setCaughtOffset] = useState(
      storedOffset(capture?.caught_at),
    );
  const choices = useQuery({
      queryKey: ["captureCatalog", q],
      queryFn: () =>
        api<CatalogResponse>(
          `/catalog?q=${encodeURIComponent(q)}&pageSize=100`,
        ),
      enabled: online,
    }),
    taxon = useQuery({
      queryKey: ["captureTaxon", species],
      queryFn: () => api<Taxon>(`/catalog/${species}`),
      enabled: online && !!species,
    });
  const remove = useConfirmedWrite(
    `/captures/${capture?.id}/delete`,
    "POST",
    refresh,
  );
  const [reviewSizeReference, setReviewSizeReference] = useState(false);
  const oldReference = capture?.taxon_id === species && !reviewSizeReference;
  const selectedSizeStatus = oldReference
    ? capture!.size_status_snapshot
    : taxon.data?.identificationLevel === "species_name"
      ? taxon.data.sizeStatus
      : "pending";
  const selectedMinimum = oldReference
    ? capture!.minimum_cm_snapshot
    : taxon.data?.minimumCm;
  const save = useConfirmedWrite(
    capture ? `/captures/${capture.id}` : `/sessions/${session.id}/captures`,
    capture ? "PATCH" : "POST",
    async () => {
      await refresh();
      if (!capture) {
        setQuantity(1);
        setRetained(0);
        setQualifying("");
        setWeight("");
        setLength("");
        setMaxWeight("");
      }
    },
  );
  return (
    <form
      className="adminbox"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          setInvalidDate(false);
          save.mutate({
            taxonId: species,
            caughtAt: toInstant(caught, caughtOffset),
            quantity,
            qualifying: optional(qualifying),
            retained,
            totalWeightKg: optional(weight),
            maxLengthCm: optional(length),
            maxWeightKg: optional(maxWeight),
            revision: capture?.revision ?? 0,
            reviewSizeReference,
          });
        } catch {
          setInvalidDate(true);
        }
      }}
    >
      <fieldset disabled={!online || save.isPending || save.uncertain}>
        <h3>{t(capture ? "editCapture" : "newCapture")}</h3>
        <label>
          {t("search")}
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label>
          {t("catalog")}
          <select
            required
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
          >
            <option value="">{t("chooseSpecies")}</option>
            {species && !choices.data?.items.some((x) => x.id === species) && (
              <option value={species}>
                {taxon.data?.scientificName ??
                  capture?.scientific_name ??
                  capture?.name_es ??
                  t("generic")}
              </option>
            )}
            {choices.data?.items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.names.find(
                  (n) => n.language === i18n.language && n.isPrimary,
                )?.name ??
                  x.scientificName ??
                  x.names[0]?.name ??
                  "—"}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          {t(`size_${selectedSizeStatus}`)}
          {selectedMinimum ? ` · ${selectedMinimum} cm` : ""}
        </p>
        {capture && capture.taxon_id === species && taxon.data && (
          <label className="check">
            <input
              type="checkbox"
              checked={reviewSizeReference}
              onChange={(e) => setReviewSizeReference(e.target.checked)}
            />
            {t("reviewCaptureSize")}
          </label>
        )}
        <div className="formgrid">
          <label>
            {t("caughtTime")} · Europe/Madrid
            <input
              type="datetime-local"
              step="1"
              required
              value={caught}
              onChange={(e) => setCaught(e.target.value)}
            />
          </label>
          <TimeOffset
            value={caught}
            offset={caughtOffset}
            set={setCaughtOffset}
          />
          <label>
            {t("quantity")}
            <input
              type="number"
              min="1"
              required
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <label>
            {t("qualifying")}
            <input
              type="number"
              min="0"
              max={quantity}
              value={qualifying}
              required={selectedSizeStatus === "has_minimum"}
              onChange={(e) => setQualifying(e.target.value)}
            />
          </label>
          <label>
            {t("retained")}
            <input
              type="number"
              min="0"
              max={quantity}
              value={retained}
              onChange={(e) => setRetained(Number(e.target.value))}
            />
          </label>
          <label>
            {t("totalWeight")} · kg
            <input
              type="number"
              min="0"
              step="0.001"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
          <label>
            {t("maxLength")} · cm
            <input
              type="number"
              min="0"
              step="0.1"
              value={length}
              onChange={(e) => setLength(e.target.value)}
            />
          </label>
          <label>
            {t("maxWeight")} · kg
            <input
              type="number"
              min="0"
              step="0.001"
              value={maxWeight}
              onChange={(e) => setMaxWeight(e.target.value)}
            />
          </label>
        </div>
        {invalidDate && <p className="error">{t("ambiguousDate")}</p>}
        <button className="primary">{t("save")}</button>
        {capture && (
          <button
            type="button"
            disabled={remove.isPending || remove.uncertain}
            onClick={() => remove.mutate({ revision: capture.revision })}
          >
            {t("deleteCapture")}
          </button>
        )}
      </fieldset>
      <ErrorMessage error={remove.error} />
      {remove.uncertain && (
        <button type="button" disabled={!online} onClick={remove.reconcile}>
          {t("reconcile")}
        </button>
      )}
      <ErrorMessage error={save.error} />
      {save.uncertain && (
        <button type="button" disabled={!online} onClick={save.reconcile}>
          {t("reconcile")}
        </button>
      )}
    </form>
  );
}
