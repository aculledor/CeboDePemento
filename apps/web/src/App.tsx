import { useState, useEffect, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Routes, Route, useParams } from "react-router-dom";
import type {
  Taxon,
  CatalogResponse,
  HealthResponse,
  User,
} from "@cebo/shared";
import { api, write, ApiFailure } from "./api";
const Auth = lazy(() => import("./Auth").then((m) => ({ default: m.Auth })));

import { useOnline } from "./connectivity";
const Admin = lazy(() => import("./Admin").then((m) => ({ default: m.Admin })));
const TaxonEditor = lazy(() =>
  import("./Admin").then((m) => ({ default: m.TaxonEditor })),
);
const Sessions = lazy(() =>
  import("./Sessions").then((m) => ({ default: m.Sessions })),
);
const SessionPage = lazy(() =>
  import("./Sessions").then((m) => ({ default: m.SessionPage })),
);
const Leagues = lazy(() =>
  import("./Leagues").then((m) => ({ default: m.Leagues })),
);
const LeaguePage = lazy(() =>
  import("./Leagues").then((m) => ({ default: m.LeaguePage })),
);
const Statistics = lazy(() =>
  import("./Community").then((m) => ({ default: m.Statistics })),
);
const MapPage = lazy(() =>
  import("./Community").then((m) => ({ default: m.MapPage })),
);
import { Gallery } from "./Photos";
import { ErrorMessage } from "./ErrorMessage";
function Home({ user, health }: { user: User; health?: HealthResponse }) {
  const { t } = useTranslation();
  return (
    <>
      <section className="hero">
        <p className="eyebrow">{t("phase")}</p>
        <h1>{t("welcome", { name: user.displayName })}</h1>
        <p>{t("homeIntro")}</p>
        <Link className="button primary" to="/species">
          {t("openCatalog")} →
        </Link>
        <div className="filters">
          <Link className="button" to="/sessions/new">
            + {t("newSession")}
          </Link>
          <Link className="button" to="/map">
            {t("mapZones")}
          </Link>
          <Link className="button" to="/community">
            {t("community")}
          </Link>
        </div>
      </section>
      <div className="adminbox">
        <p className="eyebrow">{t("selection")}</p>
        <h2>
          {health?.catalog.initial ?? "…"} {t("entries")}
        </h2>
        <p className="muted">
          {health?.catalog.pending ?? "…"} {t("pending")}
        </p>
        <p className="notice">{t("notice")}</p>
        {user.role === "admin" && (
          <Link className="button" to="/admin">
            {t("admin")} →
          </Link>
        )}
      </div>
    </>
  );
}
function Profile({ user }: { user: User }) {
  const { t } = useTranslation();
  return (
    <section className="detail">
      <p className="eyebrow">{t("profile")}</p>
      <h1>{user.displayName}</h1>
      <dl>
        <dt>{t("username")}</dt>
        <dd>{user.username}</dd>
        <dt>{t("role")}</dt>
        <dd>{t(user.role === "admin" ? "admin" : "member")}</dd>
      </dl>
      {user.role === "admin" && (
        <Link className="button primary" to="/admin">
          {t("admin")}
        </Link>
      )}
    </section>
  );
}
const name = (taxon: Taxon, lang: string) =>
  taxon.names.find((n) => n.language === lang && n.isPrimary)?.name ??
  taxon.names.find((n) => n.language === lang)?.name ??
  taxon.scientificName ??
  taxon.names[0]?.name ??
  "—";
function Fish() {
  return (
    <svg viewBox="0 0 180 100" aria-hidden="true">
      <path
        d="M37 50C63 9 124 9 149 50C124 91 63 91 37 50Z M37 50L12 27V73Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="126" cy="44" r="3" fill="currentColor" />
      <path
        d="M95 19L81 6L68 24M73 73L86 89L102 78"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
function Catalog() {
  const { t, i18n } = useTranslation(),
    [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: ["catalog", q, category, page],
    queryFn: () =>
      api<CatalogResponse>(
        `/catalog?${new URLSearchParams({ q, category, page: String(page) }).toString().replace("category=&", "")}`,
      ),
  });
  return (
    <>
      <section className="hero">
        <p className="eyebrow">{t("selection")}</p>
        <h1>{t("title")}</h1>
        <p>{t("intro")}</p>
      </section>
      <section aria-label={t("catalog")}>
        <label className="search">
          <span>⌕</span>
          <input
            type="search"
            maxLength={100}
            placeholder={t("search")}
            aria-label={t("search")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <div className="filters">
          {["", "fish", "cephalopod", "crustacean"].map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              className={category === c ? "selected" : ""}
              onClick={() => {
                setCategory(c);
                setPage(1);
              }}
            >
              {t(c || "all")}
            </button>
          ))}
        </div>
        <p className="muted">
          {result.data?.total ?? "…"} {t("entries")} · GL / ES
        </p>
        {result.isPending ? (
          <p role="status">{t("loading")}</p>
        ) : result.isError ? (
          <ErrorState
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : (
          <>
            <div className="grid">
              {result.data.items.map((x) => (
                <Link className="card" key={x.id} to={`/species/${x.id}`}>
                  <div className="placeholder">
                    {x.primaryPhotoId ? (
                      <img
                        className="candidatephoto"
                        src={`/api/photos/${x.primaryPhotoId}/thumbnail`}
                        alt={name(x, i18n.language)}
                      />
                    ) : (
                      <>
                        <Fish />
                        <span>{t("nofoto")}</span>
                      </>
                    )}
                  </div>
                  <div className="cardbody">
                    <p className="eyebrow">{t(x.category)}</p>
                    <h2>{name(x, i18n.language)}</h2>
                    <p>{name(x, i18n.language === "gl" ? "es" : "gl")}</p>
                    <em>{x.scientificName ?? t("generic")}</em>
                  </div>
                </Link>
              ))}
            </div>
            {!result.data.items.length && <p>{t("empty")}</p>}
            <div className="pagination">
              <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                {t("previous")}
              </button>
              <span>
                {page} /{" "}
                {Math.max(
                  1,
                  Math.ceil(result.data.total / result.data.pageSize),
                )}
              </span>
              <button
                disabled={page * result.data.pageSize >= result.data.total}
                onClick={() => setPage(page + 1)}
              >
                {t("next")}
              </button>
            </div>
          </>
        )}
      </section>
      <p className="notice">{t("notice")}</p>
    </>
  );
}
function ErrorState({
  retry,
  error,
}: {
  retry: () => void;
  error?: Error | null;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="error">
      <p>
        {t(
          error instanceof ApiFailure && error.status < 500
            ? `error_${error.code}`
            : "offline",
        )}
      </p>
      <button onClick={retry}>{t("retry")}</button>
    </div>
  );
}
function Detail() {
  const { id } = useParams(),
    { t, i18n } = useTranslation(),
    online = useOnline();
  const result = useQuery({
    queryKey: ["taxon", id],
    queryFn: () => api<Taxon>(`/catalog/${id}`),
    enabled: online,
  });
  const sources = useQuery({
    queryKey: ["sources", id],
    queryFn: () =>
      api<{ id: string; title: string; url: string }[]>(
        `/catalog/${id}/sources`,
      ),
    enabled: online,
  });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/auth/me"),
    enabled: online,
  });
  if (!online) return null;
  if (result.isPending) return <p role="status">{t("loading")}</p>;
  if (result.isError)
    return (
      <ErrorState error={result.error} retry={() => void result.refetch()} />
    );
  const taxon = result.data,
    description =
      i18n.language === "gl" ? taxon.descriptionGl : taxon.descriptionEs,
    tips = i18n.language === "gl" ? taxon.tipsGl : taxon.tipsEs;
  return (
    <>
      <Link to="/species">← {t("back")}</Link>
      <article className="detail">
        <p className="eyebrow">
          {t(taxon.category)} ·{" "}
          {t(taxon.reviewStatus === "reviewed" ? "reviewed" : "review")}
        </p>
        <h1>{name(taxon, i18n.language)}</h1>
        <p>
          <em>{taxon.scientificName ?? t("generic")}</em>
        </p>
        {!taxon.primaryPhotoId && (
          <div className="placeholder">
            <Fish />
            <span>{t("nofoto")}</span>
          </div>
        )}
        <Gallery id={taxon.id} />
        <h2>{t("names")}</h2>
        <dl>
          <dt>{t("glName")}</dt>
          <dd>
            {taxon.names
              .filter((n) => n.language === "gl")
              .map((n) => n.name)
              .join(" · ") || t("missing")}
          </dd>
          <dt>{t("esName")}</dt>
          <dd>
            {taxon.names
              .filter((n) => n.language === "es")
              .map((n) => n.name)
              .join(" · ") || t("missing")}
          </dd>
        </dl>
        {description && (
          <>
            <h2>{t("description")}</h2>
            <p className="editorialtext">{description}</p>
          </>
        )}
        {tips && (
          <>
            <h2>{t("tips")}</h2>
            <p className="editorialtext">{tips}</p>
          </>
        )}
        {(taxon.taxonomicClass || taxon.taxonomicOrder || taxon.family) && (
          <>
            <h2>{t("taxonomy")}</h2>
            <p>
              {[taxon.taxonomicClass, taxon.taxonomicOrder, taxon.family]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </>
        )}
        <h2>{t("sizeReference")}</h2>
        <p>
          {t(`size_${taxon.sizeStatus}`)}
          {taxon.minimumCm !== null ? ` · ${taxon.minimumCm} cm` : ""}
        </p>
        {taxon.minimumSource && (
          <p className="muted">
            {taxon.minimumSource} ·{" "}
            {taxon.minimumReviewedAt
              ? new Date(taxon.minimumReviewedAt).toLocaleDateString(
                  i18n.language === "gl" ? "gl-ES" : "es-ES",
                  { timeZone: "Europe/Madrid" },
                )
              : ""}
          </p>
        )}
        <p className="notice">{t("sizeNotice")}</p>
        <h2>{t("sources")}</h2>
        <ul>
          {sources.data?.map((source) => (
            <li key={source.id}>
              {source.url && /^https?:/.test(source.url) ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title} ↗
                </a>
              ) : (
                source.title
              )}
            </li>
          ))}
        </ul>
        {sources.isError && <ErrorState retry={() => void sources.refetch()} />}
        <p className="notice">{t("notice")}</p>
        {me.data?.role === "admin" && (
          <Link className="button primary" to={`/admin/species/${taxon.id}`}>
            {t("editTaxon")}
          </Link>
        )}
      </article>
    </>
  );
}
export function App() {
  const { t, i18n } = useTranslation(),
    online = useOnline(),
    client = useQueryClient();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<HealthResponse>("/health"),
    refetchInterval: 10000,
  });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<User>("/auth/me");
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) return null;
        throw error;
      }
    },
    enabled: online,
  });
  const refresh = async () => {
    client.removeQueries({
      predicate: (q) => q.queryKey[0] !== "health" && q.queryKey[0] !== "me",
    });
    await client.invalidateQueries({ queryKey: ["me"] });
  };
  const logout = useMutation({
    mutationFn: () => write("/auth/logout", {}),
    onSuccess: refresh,
  });
  useEffect(() => {
    const expired = () => void client.invalidateQueries({ queryKey: ["me"] });
    window.addEventListener("cebo-auth-expired", expired);
    return () => window.removeEventListener("cebo-auth-expired", expired);
  }, [client]);
  const user = me.isSuccess ? me.data : null,
    unauthenticated = me.isSuccess && !user;
  return (
    <>
      <header>
        <Link className="brand" to="/">
          Cebo<span>de Pemento</span>
        </Link>
        <div className="headeractions">
          <select
            aria-label="Idioma"
            value={i18n.language}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
          >
            <option value="gl">Galego</option>
            <option value="es">Castellano</option>
          </select>
          {user && (
            <button
              onClick={() => logout.mutate()}
              disabled={!online || logout.isPending}
            >
              {t("logout")}
            </button>
          )}
        </div>
      </header>
      <main>
        <div className="topline">
          <p className="eyebrow">{t("phase")}</p>
          <span className={`status ${!online ? "down" : ""}`}>
            {online ? t("online") : t("loading")}
          </span>
        </div>
        <ErrorMessage error={logout.error} />
        {!online && <ErrorState retry={() => void health.refetch()} />}
        <Suspense fallback={<p>{t("loading")}</p>}>
          <Routes>
            <Route path="/login" element={<Auth done={refresh} />} />
            <Route
              path="/register"
              element={<Auth key="register" mode="register" done={refresh} />}
            />
            <Route
              path="/reset"
              element={<Auth key="reset" mode="reset" done={refresh} />}
            />
            <Route
              path="/*"
              element={
                user ? (
                  <Routes>
                    <Route
                      path="/"
                      element={<Home user={user} health={health.data} />}
                    />
                    <Route path="/species" element={<Catalog />} />
                    <Route path="/species/:id" element={<Detail />} />
                    <Route
                      path="/profile"
                      element={<Statistics own={user} />}
                    />
                    <Route path="/profiles/:id" element={<Statistics />} />
                    <Route path="/community" element={<Statistics />} />
                    <Route path="/map" element={<MapPage user={user} />} />
                    <Route
                      path="/sessions"
                      element={<Sessions user={user} />}
                    />
                    <Route
                      path="/sessions/:id"
                      element={<SessionPage user={user} />}
                    />
                    <Route path="/leagues" element={<Leagues />} />
                    <Route
                      path="/leagues/:id"
                      element={<LeaguePage user={user} />}
                    />
                    <Route
                      path="/admin"
                      element={
                        user.role === "admin" ? <Admin /> : <Navigate to="/" />
                      }
                    />
                    <Route
                      path="/admin/species/:id"
                      element={
                        user.role === "admin" ? (
                          <TaxonEditor />
                        ) : (
                          <Navigate to="/" />
                        )
                      }
                    />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                ) : unauthenticated ? (
                  <Navigate to="/login" replace />
                ) : (
                  <p role="status">{t("loading")}</p>
                )
              }
            />
          </Routes>
        </Suspense>
      </main>
      {user && (
        <nav className="bottomnav" aria-label={t("home")}>
          <Link to="/">
            ⌂<span>{t("home")}</span>
          </Link>
          <Link to="/sessions">
            ＋<span>{t("sessions")}</span>
          </Link>
          <Link to="/leagues">
            ♜<span>{t("leagues")}</span>
          </Link>
          <Link to="/species">
            ≋<span>{t("catalog")}</span>
          </Link>
          <Link to="/profile">
            ○<span>{t("profile")}</span>
          </Link>
        </nav>
      )}
      <footer>
        {t("selection")} · {health.data?.catalog.initial ?? "…"} /{" "}
        {health.data?.catalog.reference ?? "…"} ·{" "}
        {health.data?.catalog.pending ?? "…"} {t("pending")}
      </footer>
    </>
  );
}
