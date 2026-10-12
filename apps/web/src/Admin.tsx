import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  taxonInputSchema,
  toTaxonInput,
  type TaxonInput,
  type Taxon,
  type User,
  type CatalogResponse,
} from "@cebo/shared";
import { api, ApiFailure } from "./api";
import { useOnline } from "./connectivity";
import { useConfirmedWrite } from "./useConfirmedWrite";
import { PhotoManager } from "./Photos";

import { ErrorMessage } from "./ErrorMessage";
export function Admin() {
  const { t, i18n } = useTranslation(),
    online = useOnline(),
    client = useQueryClient(),
    [token, setToken] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [active, setActive] = useState("all");
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/admin/users"),
    enabled: online,
  });
  const catalog = useQuery({
    queryKey: ["adminCatalog", q, page, active],
    queryFn: () =>
      api<CatalogResponse>(
        `/admin/catalog?${new URLSearchParams({ q, page: String(page), active })}`,
      ),
    enabled: online,
  });
  const invites = useQuery({
    queryKey: ["invites"],
    queryFn: () =>
      api<
        {
          id: string;
          expires_at: string;
          used_by: string | null;
          revoked_at: string | null;
        }[]
      >("/admin/invitations"),
    enabled: online,
  });
  const invite = useConfirmedWrite<
    { token: string; expiresAt: string },
    { expiresInHours: number }
  >("/admin/invitations", "POST", async (result) => {
    setToken(result.token);
    await client.invalidateQueries({ queryKey: ["invites"] });
  });
  const recovery = useConfirmedWrite<
    { token: string; expiresAt: string },
    { userId: string }
  >("/admin/recovery", "POST", (result) => {
    setToken(result.token);
  });
  return (
    <>
      <section className="hero">
        <p className="eyebrow">{t("admin")}</p>
        <h1>{t("reviewCatalog")}</h1>
        <p>{t("adminIntro")}</p>
      </section>
      <section className="adminbox">
        <h2>{t("invitations")}</h2>
        <button
          className="primary"
          disabled={!online || invite.isPending || invite.uncertain}
          onClick={() => invite.mutate({ expiresInHours: 72 })}
        >
          {t("newInvitation")}
        </button>
        {invite.uncertain && (
          <button disabled={!online} onClick={invite.reconcile}>
            {t("reconcile")}
          </button>
        )}
        <ErrorMessage error={invite.error} />
        {token && (
          <div className="notice">
            <p>{t("shareToken")}</p>
            <code className="token">{token}</code>
          </div>
        )}
        <ul>
          {invites.data?.slice(0, 10).map((x) => (
            <li key={x.id}>
              {t(x.used_by ? "used" : x.revoked_at ? "revoked" : "expires")} ·{" "}
              {new Date(x.expires_at).toLocaleString(
                i18n.language === "gl" ? "gl-ES" : "es-ES",
                { timeZone: "Europe/Madrid" },
              )}
            </li>
          ))}
        </ul>
        <ErrorMessage error={invites.error} />
        <h3>{t("reset")}</h3>
        <div className="userlist">
          {users.data?.map((user) => (
            <button
              key={user.id}
              disabled={!online || recovery.isPending || recovery.uncertain}
              onClick={() => recovery.mutate({ userId: user.id })}
            >
              {user.displayName} · {t("recoveryToken")}
            </button>
          ))}
        </div>
        {recovery.uncertain && (
          <button disabled={!online} onClick={recovery.reconcile}>
            {t("reconcile")}
          </button>
        )}
        <ErrorMessage error={recovery.error} />
      </section>
      <section>
        <div className="sectionhead">
          <h2>{t("catalog")}</h2>
          <Link className="button primary" to="/admin/species/new">
            + {t("createTaxon")}
          </Link>
        </div>
        <label className="search">
          <span>⌕</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder={t("search")}
            aria-label={t("search")}
          />
        </label>
        <div className="filters">
          {["all", "1", "0"].map((value) => (
            <button
              key={value}
              aria-pressed={active === value}
              onClick={() => {
                setActive(value);
                setPage(1);
              }}
            >
              {t(
                value === "all" ? "all" : value === "1" ? "visible" : "hidden",
              )}
            </button>
          ))}
        </div>
        <p className="muted">
          {catalog.data?.total ?? "…"} {t("entries")}
        </p>
        <ErrorMessage error={catalog.error} />
        {catalog.isPending && <p>{t("loading")}</p>}
        <div className="editlist">
          {online &&
            catalog.data?.items.map((taxon) => (
              <Link key={taxon.id} to={`/admin/species/${taxon.id}`}>
                <span>
                  <strong>
                    {taxon.names.find(
                      (n) => n.language === i18n.language && n.isPrimary,
                    )?.name ??
                      taxon.scientificName ??
                      taxon.id}
                  </strong>
                  <em>{taxon.scientificName ?? t("generic")}</em>
                </span>
                <span>{t(taxon.active ? "visible" : "hidden")} →</span>
              </Link>
            ))}
        </div>
        <div className="pagination">
          <button
            disabled={page === 1 || !online}
            onClick={() => setPage(page - 1)}
          >
            {t("previous")}
          </button>
          <span>{page}</span>
          <button
            disabled={
              !online ||
              !catalog.data ||
              page * catalog.data.pageSize >= catalog.data.total
            }
            onClick={() => setPage(page + 1)}
          >
            {t("next")}
          </button>
        </div>
      </section>
    </>
  );
}
const empty: TaxonInput = {
  scientificName: null,
  category: "fish",
  identificationLevel: "unresolved",
  reviewStatus: "pending",
  localPresenceStatus: "not_verified",
  notes: "",
  names: [
    { language: "gl", name: "", isPrimary: 1 },
    { language: "es", name: "", isPrimary: 1 },
  ],
  active: 0,
  descriptionGl: "",
  descriptionEs: "",
  tipsGl: "",
  tipsEs: "",
  taxonomicClass: "",
  taxonomicOrder: "",
  family: "",
  sizeStatus: "pending",
  minimumCm: null,
  minimumSource: "",
  minimumReviewedAt: null,
  revision: 0,
};
const inputFrom = toTaxonInput;
export function TaxonEditor() {
  const { id } = useParams(),
    { t } = useTranslation(),
    online = useOnline(),
    isNew = id === "new";
  const taxon = useQuery({
    queryKey: ["editTaxon", id],
    queryFn: () => api<Taxon>(`/catalog/${id}`),
    enabled: online && !isNew,
  });
  if (!isNew && !taxon.data)
    return (
      <>
        <ErrorMessage error={taxon.error} />
        <p>{t("loading")}</p>
      </>
    );
  return (
    <Editor
      key={id}
      id={id!}
      initial={isNew ? empty : inputFrom(taxon.data!)}
    />
  );
}
function Editor({ id, initial }: { id: string; initial: TaxonInput }) {
  const { t } = useTranslation(),
    online = useOnline(),
    navigate = useNavigate(),
    client = useQueryClient(),
    isNew = id === "new";
  const form = useForm<TaxonInput>({
    resolver: zodResolver(taxonInputSchema),
    defaultValues: initial,
  });
  const aliases = useFieldArray({ control: form.control, name: "names" }),
    sizeStatus = form.watch("sizeStatus");
  const save = useConfirmedWrite<Taxon, TaxonInput>(
    isNew ? "/admin/catalog" : `/admin/catalog/${id}`,
    isNew ? "POST" : "PATCH",
    async (result) => {
      form.reset(inputFrom(result));
      await client.invalidateQueries({ queryKey: ["catalog"] });
      client.removeQueries({ queryKey: ["editTaxon"] });
      navigate("/admin");
    },
  );
  const history = useQuery({
    queryKey: ["taxonHistory", id],
    queryFn: () =>
      api<
        {
          id: number;
          action: string;
          created_at: string;
          actor_id: string;
          actor_name: string;
        }[]
      >(`/admin/catalog/${id}/history`),
    enabled: online && !isNew,
  });
  return (
    <>
      <Link to="/admin">← {t("back")}</Link>
      <section className="editor">
        <p className="eyebrow">{t("admin")}</p>
        <h1>{t(isNew ? "createTaxon" : "editTaxon")}</h1>
        <p className="notice">{t("editorNotice")}</p>
        <form onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <fieldset disabled={!online || save.isPending || save.uncertain}>
            <div className="formgrid">
              <label>
                {t("scientificName")}
                <input
                  {...form.register("scientificName", {
                    setValueAs: (v: string) => v.trim() || null,
                  })}
                />
              </label>
              <label>
                {t("category")}
                <select {...form.register("category")}>
                  {["fish", "cephalopod", "crustacean"].map((c) => (
                    <option key={c} value={c}>
                      {t(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("identification")}
                <select {...form.register("identificationLevel")}>
                  {["species_name", "aggregate", "unresolved"].map((c) => (
                    <option key={c} value={c}>
                      {t(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("reviewState")}
                <select {...form.register("reviewStatus")}>
                  <option value="pending">{t("review")}</option>
                  <option value="reviewed">{t("reviewed")}</option>
                </select>
              </label>
              <label>
                {t("visibility")}
                <select {...form.register("active", { valueAsNumber: true })}>
                  <option value="0">{t("hidden")}</option>
                  <option value="1">{t("visible")}</option>
                </select>
              </label>
              <label>
                {t("presence")}
                <input {...form.register("localPresenceStatus")} />
              </label>
            </div>
            <h2>{t("names")}</h2>
            <p className="muted">{t("missingTranslation")}</p>
            {aliases.fields.map((field, index) => (
              <div className="aliasrow" key={field.id}>
                <label>
                  {t("language")}
                  <select {...form.register(`names.${index}.language`)}>
                    <option value="gl">GL</option>
                    <option value="es">ES</option>
                    <option value="la">LA</option>
                  </select>
                </label>
                <label>
                  {t("name")}
                  <input {...form.register(`names.${index}.name`)} />
                </label>
                <label>
                  {t("primaryName")}
                  <select
                    {...form.register(`names.${index}.isPrimary`, {
                      valueAsNumber: true,
                    })}
                  >
                    <option value="0">{t("alias")}</option>
                    <option value="1">{t("primaryName")}</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => aliases.remove(index)}
                  aria-label={t("removeAlias")}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                aliases.append({ language: "gl", name: "", isPrimary: 0 })
              }
            >
              + {t("addAlias")}
            </button>
            <h2>{t("taxonomy")}</h2>
            <div className="formgrid">
              {(["taxonomicClass", "taxonomicOrder", "family"] as const).map(
                (key) => (
                  <label key={key}>
                    {t(key)}
                    <input {...form.register(key)} />
                  </label>
                ),
              )}
            </div>
            <h2>{t("editorial")}</h2>
            <div className="formgrid">
              {(
                ["descriptionGl", "descriptionEs", "tipsGl", "tipsEs"] as const
              ).map((key) => (
                <label key={key}>
                  {t(key)}
                  <textarea {...form.register(key)} />
                </label>
              ))}
            </div>
            <label>
              {t("notes")}
              <textarea {...form.register("notes")} />
            </label>
            <h2>{t("sizeReference")}</h2>
            <p className="notice">{t("sizeNotice")}</p>
            <label>
              {t("sizeState")}
              <select
                {...form.register("sizeStatus")}
                onChange={(e) => {
                  form.setValue(
                    "sizeStatus",
                    e.target.value as TaxonInput["sizeStatus"],
                  );
                  if (e.target.value !== "has_minimum")
                    form.setValue("minimumCm", null);
                  if (e.target.value === "pending") {
                    form.setValue("minimumSource", "");
                    form.setValue("minimumReviewedAt", null);
                  } else
                    form.setValue(
                      "minimumReviewedAt",
                      new Date().toISOString(),
                    );
                }}
              >
                {["pending", "has_minimum", "confirmed_no_minimum"].map(
                  (value) => (
                    <option key={value} value={value}>
                      {t(`size_${value}`)}
                    </option>
                  ),
                )}
              </select>
            </label>
            {sizeStatus === "has_minimum" && (
              <label>
                {t("minimumCm")}
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  {...form.register("minimumCm", {
                    setValueAs: (v: string) => (v === "" ? null : Number(v)),
                  })}
                />
              </label>
            )}
            {sizeStatus !== "pending" && (
              <>
                <label>
                  {t("minimumSource")}
                  <input {...form.register("minimumSource")} />
                </label>
                <label>
                  {t("minimumReviewedAt")}
                  <input
                    type="datetime-local"
                    value={
                      form.watch("minimumReviewedAt")
                        ? new Date(form.watch("minimumReviewedAt")!)
                            .toLocaleString("sv-SE")
                            .replace(" ", "T")
                            .slice(0, 16)
                        : ""
                    }
                    onChange={(e) =>
                      form.setValue(
                        "minimumReviewedAt",
                        e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      )
                    }
                  />
                </label>
              </>
            )}
            {!!Object.keys(form.formState.errors).length && (
              <div className="error" role="alert">
                <p>{t("invalidForm")}</p>
                <ul>
                  {Object.entries(form.formState.errors).map(([key, error]) => (
                    <li key={key}>
                      {t(key)}:{" "}
                      {t(key === "names" ? "checkAliases" : "invalidField")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button className="primary">
              {save.isPending ? t("saving") : t("save")}
            </button>
          </fieldset>
        </form>
        <ErrorMessage error={save.error} />
        {save.uncertain && (
          <div className="notice">
            <p>{t("uncertain")}</p>
            <button
              disabled={!online || save.isPending}
              onClick={save.reconcile}
            >
              {t("reconcile")}
            </button>
          </div>
        )}
        {!isNew && (
          <>
            <PhotoManager id={id} />
            <h2>{t("history")}</h2>
            <ul>
              {history.data?.map((row) => (
                <li key={row.id}>
                  {new Date(row.created_at).toLocaleString()} ·{" "}
                  {t(
                    row.action === "taxon.updated"
                      ? "catalogUpdated"
                      : "catalogCreated",
                  )}{" "}
                  · {row.actor_name ?? "—"}
                </li>
              ))}
            </ul>
            <ErrorMessage error={history.error} />
          </>
        )}
      </section>
    </>
  );
}
