import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { User } from "@cebo/shared";
import { api } from "./api";
import { useOnline } from "./connectivity";
import { useConfirmedWrite } from "./useConfirmedWrite";
import { ErrorMessage } from "./ErrorMessage";
interface Stats {
  users: {
    id: string;
    display_name: string;
    quantity: number;
    sessions: number;
    days: number;
    hours: number;
    capturesPerHour: number | null;
    identifiedSpecies: number;
    declaredKg: number | null;
    weightCoverage: { batches: number; total: number };
    maxLengthCm: number | null;
    maxWeightKg: number | null;
    evolution: { day: string; quantity: number; hours: number }[];
  }[];
  exclusive: { taxonId: string; scientificName: string; userId: string }[];
  species: {
    taxonId: string;
    scientificName: string | null;
    quantity: number;
    declaredKg: number | null;
    maxLengthCm: number | null;
    maxWeightKg: number | null;
  }[];
}
export function Statistics({ own }: { own?: User }) {
  const { id } = useParams(),
    { t } = useTranslation(),
    online = useOnline(),
    [first, setFirst] = useState(""),
    [last, setLast] = useState(""),
    [sort, setSort] = useState("quantity");
  const userId = id ?? own?.id,
    params = new URLSearchParams({
      ...(userId ? { userId } : {}),
      ...(first && last ? { firstDay: first, lastDay: last } : {}),
    }),
    result = useQuery({
      queryKey: ["stats", userId, first, last],
      queryFn: () => api<Stats>(`/stats?${params}`),
      enabled: online,
    });
  return (
    <>
      <section className="hero">
        <p className="eyebrow">{t(userId ? "profile" : "community")}</p>
        <h1>{t("statistics")}</h1>
      </section>
      <div className="formgrid">
        <label>
          {t("firstDay")}
          <input
            type="date"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
        </label>
        <label>
          {t("lastDay")}
          <input
            type="date"
            value={last}
            onChange={(e) => setLast(e.target.value)}
          />
        </label>
      </div>
      <p className="muted">{t("statsHelp")}</p>
      <ErrorMessage error={result.error} />
      {!userId && (
        <label>
          {t("recordOrder")}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {[
              "quantity",
              "hours",
              "identifiedSpecies",
              "declaredKg",
              "maxLengthCm",
              "maxWeightKg",
            ].map((key) => (
              <option key={key} value={key}>
                {t(
                  key === "hours"
                    ? "fishingHours"
                    : key === "maxLengthCm"
                      ? "maxLength"
                      : key === "maxWeightKg"
                        ? "maxWeight"
                        : key,
                )}
              </option>
            ))}
          </select>
        </label>
      )}
      {online &&
        result.data?.users
          .slice()
          .sort(
            (a, b) =>
              Number(b[sort as keyof typeof b] ?? -1) -
                Number(a[sort as keyof typeof a] ?? -1) ||
              a.id.localeCompare(b.id),
          )
          .map((user) => (
            <article className="adminbox" key={user.id}>
              <h2>
                <Link to={`/profiles/${user.id}`}>{user.display_name}</Link>
              </h2>
              <div className="statsgrid">
                {[
                  ["quantity", user.quantity],
                  ["fishingHours", user.hours.toFixed(2)],
                  ["fishingDays", user.days],
                  ["sessions", user.sessions],
                  ["identifiedSpecies", user.identifiedSpecies],
                  ["declaredKg", user.declaredKg?.toFixed(3) ?? "—"],
                  ["maxLength", user.maxLengthCm ?? "—"],
                  ["maxWeight", user.maxWeightKg ?? "—"],
                  ["capturesPerHour", user.capturesPerHour?.toFixed(2) ?? "—"],
                ].map(([key, value]) => (
                  <div key={key}>
                    <span>{t(String(key))}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className="muted">
                {t("weightCoverage")} · {user.weightCoverage.batches} /{" "}
                {user.weightCoverage.total}
              </p>
              <details>
                <summary>{t("evolution")}</summary>
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("fishingDay")}</th>
                        <th>{t("quantity")}</th>
                        <th>{t("fishingHours")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {user.evolution.map((day) => (
                        <tr key={day.day}>
                          <td>{day.day}</td>
                          <td>{day.quantity}</td>
                          <td>{day.hours.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <Link className="button" to={`/sessions?owner=${user.id}`}>
                {t("fishingDiary")} →
              </Link>
            </article>
          ))}
      <h2>{t("speciesRecords")}</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>{t("catalog")}</th>
              <th>{t("quantity")}</th>
              <th>{t("declaredKg")}</th>
              <th>{t("maxLength")} · cm</th>
              <th>{t("maxWeight")} · kg</th>
            </tr>
          </thead>
          <tbody>
            {online &&
              result.data?.species.map((s) => (
                <tr key={s.taxonId}>
                  <td>
                    <Link to={`/species/${s.taxonId}`}>
                      {s.scientificName ?? t("generic")}
                    </Link>
                  </td>
                  <td>{s.quantity}</td>
                  <td>{s.declaredKg ?? "—"}</td>
                  <td>{s.maxLengthCm ?? "—"}</td>
                  <td>{s.maxWeightKg ?? "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <h2>{t("exclusiveSpecies")}</h2>
      <p className="muted">{t("exclusiveHelp")}</p>
      <ul>
        {result.data?.exclusive.map((x) => (
          <li key={x.taxonId}>
            <Link to={`/species/${x.taxonId}`}>{x.scientificName}</Link> ·{" "}
            <Link to={`/profiles/${x.userId}`}>
              {result.data.users.find((u) => u.id === x.userId)?.display_name ??
                t("profile")}
            </Link>
          </li>
        ))}
      </ul>
      <Link className="button" to="/community">
        {t("community")}
      </Link>
    </>
  );
}
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
interface MapData {
  zones: Zone[];
  sessions: {
    id: string;
    owner: string;
    latitude: number;
    longitude: number;
    privacy: string;
  }[];
}
function LiveMap({ data }: { data: MapData }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current).setView([42.55, -8.88], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    const text = (value: string) => {
      const el = document.createElement("span");
      el.textContent = value;
      return el;
    };
    for (const zone of data.zones)
      if (zone.latitude !== null && zone.longitude !== null)
        L.circleMarker([zone.latitude, zone.longitude], {
          color: "#34675b",
          radius: 7,
        })
          .bindPopup(text(zone.name_gl))
          .addTo(map);
    for (const session of data.sessions)
      L.circleMarker([session.latitude, session.longitude], {
        color: "#c46331",
        radius: 5,
      })
        .bindPopup(text(session.owner))
        .addTo(map);
    return () => {
      map.remove();
    };
  }, [data]);
  return <div className="map" ref={ref} />;
}
export function MapPage({ user }: { user: User }) {
  const { t, i18n } = useTranslation(),
    online = useOnline(),
    [editing, setEditing] = useState<Zone | "new" | null>(null);
  const zones = useQuery({
      queryKey: ["zones", user.role],
      queryFn: () =>
        api<Zone[]>(user.role === "admin" ? "/admin/zones" : "/zones"),
      enabled: online,
    }),
    map = useQuery({
      queryKey: ["map"],
      queryFn: () => api<MapData>("/map"),
      enabled: online,
    });
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Arousa</p>
        <h1>{t("mapZones")}</h1>
        <p>{t("mapNotice")}</p>
        {user.role === "admin" && (
          <button disabled={!online} onClick={() => setEditing("new")}>
            + {t("newZone")}
          </button>
        )}
      </section>
      <ErrorMessage error={map.error} />
      {online && map.data && <LiveMap data={map.data} />}
      <p className="notice">{t("coordinateNotice")}</p>
      {editing && (
        <ZoneForm
          key={editing === "new" ? "new" : `${editing.id}-${editing.revision}`}
          zone={editing === "new" ? undefined : editing}
          done={() => setEditing(null)}
        />
      )}
      <ErrorMessage error={zones.error} />
      <div className="grid">
        {online &&
          zones.data?.map((zone) => (
            <article key={zone.id} className="adminbox">
              <p className="eyebrow">{zone.source}</p>
              <h2>{i18n.language === "gl" ? zone.name_gl : zone.name_es}</h2>
              <p className="editorialtext">
                {i18n.language === "gl"
                  ? zone.description_gl
                  : zone.description_es}
              </p>
              <p className="muted">
                {zone.latitude === null
                  ? t("unmappedZone")
                  : `${zone.latitude}, ${zone.longitude}`}
              </p>
              {user.role === "admin" && (
                <button disabled={!online} onClick={() => setEditing(zone)}>
                  {t("editZone")}
                </button>
              )}
            </article>
          ))}
      </div>
    </>
  );
}
function ZoneForm({ zone, done }: { zone?: Zone; done: () => void }) {
  const { t } = useTranslation(),
    online = useOnline(),
    client = useQueryClient(),
    [nameGl, setNameGl] = useState(zone?.name_gl ?? ""),
    [nameEs, setNameEs] = useState(zone?.name_es ?? ""),
    [descriptionGl, setDescriptionGl] = useState(zone?.description_gl ?? ""),
    [descriptionEs, setDescriptionEs] = useState(zone?.description_es ?? ""),
    [latitude, setLatitude] = useState(zone?.latitude?.toString() ?? ""),
    [longitude, setLongitude] = useState(zone?.longitude?.toString() ?? ""),
    [source, setSource] = useState(zone?.source ?? ""),
    [active, setActive] = useState(zone?.active ?? 1);
  const save = useConfirmedWrite(
    zone ? `/admin/zones/${zone.id}` : "/admin/zones",
    zone ? "PATCH" : "POST",
    async () => {
      await client.invalidateQueries({ queryKey: ["zones"] });
      await client.invalidateQueries({ queryKey: ["map"] });
      done();
    },
  );
  return (
    <form
      className="adminbox"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          nameGl,
          nameEs,
          descriptionGl,
          descriptionEs,
          latitude: latitude === "" ? null : Number(latitude),
          longitude: longitude === "" ? null : Number(longitude),
          source,
          active,
          revision: zone?.revision ?? 0,
        });
      }}
    >
      <fieldset disabled={!online || save.isPending || save.uncertain}>
        <h2>{t(zone ? "editZone" : "newZone")}</h2>
        <div className="formgrid">
          <label>
            {t("name")} · GL
            <input
              required
              value={nameGl}
              onChange={(e) => setNameGl(e.target.value)}
            />
          </label>
          <label>
            {t("name")} · ES
            <input
              required
              value={nameEs}
              onChange={(e) => setNameEs(e.target.value)}
            />
          </label>
          <label>
            {t("description")} · GL
            <textarea
              value={descriptionGl}
              onChange={(e) => setDescriptionGl(e.target.value)}
            />
          </label>
          <label>
            {t("description")} · ES
            <textarea
              value={descriptionEs}
              onChange={(e) => setDescriptionEs(e.target.value)}
            />
          </label>
          <label>
            {t("latitude")}
            <input
              type="number"
              min="-90"
              max="90"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
            />
          </label>
          <label>
            {t("longitude")}
            <input
              type="number"
              min="-180"
              max="180"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
            />
          </label>
        </div>
        <label>
          {t("source")}
          <input
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label>
          {t("visibility")}
          <select
            value={active}
            onChange={(e) => setActive(Number(e.target.value))}
          >
            <option value="1">{t("visible")}</option>
            <option value="0">{t("hidden")}</option>
          </select>
        </label>
        <button className="primary">{t("save")}</button>
      </fieldset>
      <ErrorMessage error={save.error} />
      {save.uncertain && (
        <button type="button" disabled={!online} onClick={save.reconcile}>
          {t("reconcile")}
        </button>
      )}
    </form>
  );
}
