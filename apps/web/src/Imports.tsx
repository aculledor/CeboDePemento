import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useOnline } from "./connectivity";
import { useConfirmedWrite } from "./useConfirmedWrite";
import { ErrorMessage } from "./ErrorMessage";

interface ImportRow {
  id: string;
  external_id: string;
  scientific_name: string | null;
  taxon_id: string | null;
  review_status: string;
  match_kind: string;
  revision: number;
  url: string;
  payload_json: string;
  pending_images: number;
  conflicts: number;
}
interface Conflict {
  id: string;
  field: string;
  kind: string;
  current_json: string;
  proposed_json: string;
  status: string;
}
interface Size {
  id: string;
  revision: number;
  value: number | null;
  unit: string | null;
  measurement_method: string | null;
  literal: string;
  scope: string;
  source_url: string;
  verification_status: string;
}
interface SourceImage {
  id: string;
  revision: number;
  original_url: string;
  page_url: string;
  author: string | null;
  license_url: string | null;
  rights_evidence: string | null;
  authorization: string;
  image_type: string;
}
interface Detail extends Omit<ImportRow, "conflicts"> {
  conflicts: Conflict[];
  sizes: Size[];
  images: SourceImage[];
  manualFields: { field: string; edited_at: string }[];
  versions: { id: number; payload_json: string; retrieved_at: string }[];
}
function useRefresh() {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries();
  };
}
function ActionState({
  action,
}: {
  action: { error: Error | null; uncertain: boolean; reconcile: () => void };
}) {
  const { t } = useTranslation(),
    online = useOnline();
  return (
    <>
      <ErrorMessage error={action.error} />
      {action.uncertain && (
        <button disabled={!online} onClick={action.reconcile}>
          {t("reconcile")}
        </button>
      )}
    </>
  );
}
function JsonView({ value }: { value: string }) {
  let formatted = value;
  try {
    formatted = JSON.stringify(JSON.parse(value), null, 2);
  } catch {}
  return <pre className="import-json">{formatted}</pre>;
}

export function ImportReview() {
  const { t } = useTranslation(),
    online = useOnline(),
    [page, setPage] = useState(1),
    [status, setStatus] = useState("all"),
    [kind, setKind] = useState("all"),
    [selected, setSelected] = useState<string | null>(null);
  const runs = useQuery({
    queryKey: ["importRuns"],
    queryFn: () =>
      api<
        {
          id: string;
          status: string;
          started_at: string;
          summary_json: string;
          error: string | null;
        }[]
      >("/admin/imports/runs"),
    enabled: online,
  });
  const records = useQuery({
    queryKey: ["imports", page, status, kind],
    queryFn: () =>
      api<{ items: ImportRow[]; total: number }>(
        `/admin/imports/records?${new URLSearchParams({ page: String(page), status, kind })}`,
      ),
    enabled: online,
  });
  return (
    <section className="adminbox">
      <h2>{t("import_title")}</h2>
      <p className="notice">{t("import_notice")}</p>
      <p>{t("import_cli")}</p>
      <details>
        <summary>{t("import_runs")}</summary>
        {runs.data?.length === 0 && <p>{t("import_empty")}</p>}
        {runs.data?.map((run) => (
          <article key={run.id}>
            <p>
              {run.started_at} · {t(`import_${run.status}`)}
            </p>
            <JsonView value={run.summary_json} />
            {run.error && <p className="error">{run.error}</p>}
          </article>
        ))}
        <ErrorMessage error={runs.error} />
      </details>
      <div className="filters">
        <label>
          {t("import_status")}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
              setSelected(null);
            }}
          >
            {["all", "pending", "verified", "conflict", "rejected"].map((x) => (
              <option key={x} value={x}>
                {t(`import_${x}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("import_match")}
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
              setSelected(null);
            }}
          >
            {["all", "new", "exact", "fao", "synonym", "conflict"].map((x) => (
              <option key={x} value={x}>
                {t(`import_${x}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorMessage error={records.error} />
      {records.data?.total === 0 && <p>{t("import_empty")}</p>}
      <div className="userlist">
        {records.data?.items.map((row) => (
          <button key={row.id} onClick={() => setSelected(row.id)}>
            {row.scientific_name ?? row.external_id} ·{" "}
            {t(`import_${row.match_kind}`)} · {t(`import_${row.review_status}`)}{" "}
            · {t("import_conflicts")}: {row.conflicts} · {t("import_images")}:{" "}
            {row.pending_images}
          </button>
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
          disabled={!online || !records.data || page * 20 >= records.data.total}
          onClick={() => setPage(page + 1)}
        >
          {t("next")}
        </button>
      </div>
      {selected && <RecordReview key={selected} id={selected} />}
    </section>
  );
}
function RecordReview({ id }: { id: string }) {
  const { t } = useTranslation(),
    online = useOnline(),
    refresh = useRefresh(),
    [target, setTarget] = useState(""),
    [search, setSearch] = useState(""),
    [reason, setReason] = useState("");
  const detail = useQuery({
    queryKey: ["importDetail", id],
    queryFn: () => api<Detail>(`/admin/imports/records/${id}`),
    enabled: online,
  });
  const candidates = useQuery({
    queryKey: ["importTaxa", search],
    queryFn: () =>
      api<{ items: { id: string; scientificName: string | null }[] }>(
        `/admin/catalog?${new URLSearchParams({ q: search, pageSize: "30" })}`,
      ),
    enabled: online && !!search,
  });
  const taxon = useQuery({
    queryKey: ["importTaxon", detail.data?.taxon_id],
    queryFn: () =>
      api<{ revision: number }>(`/catalog/${detail.data!.taxon_id}`),
    enabled: online && !!detail.data?.taxon_id,
  });
  const review = useConfirmedWrite(
    `/admin/imports/records/${id}/review`,
    "POST",
    refresh,
  );
  const row = detail.data;
  if (!row) return <ErrorMessage error={detail.error} />;
  return (
    <article className="adminbox">
      <h3>{row.scientific_name}</h3>
      <p>
        <a href={row.url} target="_blank" rel="noreferrer">
          {t("source")} ↗
        </a>
        {row.taxon_id && (
          <>
            {" "}
            ·{" "}
            <Link to={`/admin/species/${row.taxon_id}`}>
              {t("import_edit")}
            </Link>
          </>
        )}
      </p>
      <details>
        <summary>{t("import_sourceData")}</summary>
        <JsonView value={row.payload_json} />
      </details>
      <p>
        {t("import_manualFields")}:{" "}
        {row.manualFields.map((f) => f.field).join(", ") || "—"}
      </p>
      <fieldset disabled={!online || review.isPending || review.uncertain}>
        <label>
          {t("import_reason")}
          <input
            value={reason}
            minLength={5}
            maxLength={2000}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {!row.taxon_id && (
          <>
            <label>
              {t("import_searchTarget")}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              {t("import_target")}
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">—</option>
                {candidates.data?.items.map((taxon) => (
                  <option key={taxon.id} value={taxon.id}>
                    {taxon.scientificName ?? taxon.id}
                  </option>
                ))}
              </select>
            </label>
            <ErrorMessage error={candidates.error} />
          </>
        )}
        <div className="filters">
          {(row.taxon_id
            ? ["verify", "reject"]
            : ["link", "create", "reject"]
          ).map((action) => (
            <button
              key={action}
              disabled={
                reason.trim().length < 5 || (action === "link" && !target)
              }
              onClick={() =>
                review.mutate({
                  revision: row.revision,
                  action,
                  ...(action === "link" ? { taxonId: target } : {}),
                  reason,
                })
              }
            >
              {t(`import_action_${action}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <ActionState action={review} />
      <h4>{t("import_conflicts")}</h4>
      {row.conflicts.map((conflict) => (
        <ConflictReview
          key={conflict.id}
          conflict={conflict}
          taxonRevision={taxon.data?.revision}
        />
      ))}
      <h4>{t("import_sizes")}</h4>
      <p className="notice">{t("import_sizeNotice")}</p>
      {row.sizes.map((size) => (
        <SizeReview key={`${size.id}:${size.revision}`} size={size} />
      ))}
      <h4>{t("import_images")}</h4>
      <p>{t("import_imageNotice")}</p>
      {row.images.map((image) => (
        <ImageReview key={`${image.id}:${image.revision}`} image={image} />
      ))}
      <details>
        <summary>{t("import_versions")}</summary>
        {row.versions.map((version) => (
          <details key={version.id}>
            <summary>{version.retrieved_at}</summary>
            <JsonView value={version.payload_json} />
          </details>
        ))}
      </details>
    </article>
  );
}
function ConflictReview({
  conflict,
  taxonRevision,
}: {
  conflict: Conflict;
  taxonRevision?: number;
}) {
  const { t } = useTranslation(),
    online = useOnline(),
    refresh = useRefresh(),
    [reason, setReason] = useState("");
  const action = useConfirmedWrite(
    `/admin/imports/conflicts/${conflict.id}/resolve`,
    "POST",
    refresh,
  );
  const canApply = [
    "names.gl",
    "names.es",
    "descriptionGl",
    "descriptionEs",
  ].includes(conflict.field);
  return (
    <details>
      <summary>
        {conflict.kind} · {conflict.field} · {t(`import_${conflict.status}`)}
      </summary>
      <div className="grid">
        <div>
          <h4>{t("import_current")}</h4>
          <JsonView value={conflict.current_json} />
        </div>
        <div>
          <h4>{t("import_proposed")}</h4>
          <JsonView value={conflict.proposed_json} />
        </div>
      </div>
      {conflict.status === "pending" && conflict.field !== "identity" && (
        <fieldset disabled={!online || action.isPending || action.uncertain}>
          <label>
            {t("import_reason")}
            <input
              value={reason}
              minLength={5}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={reason.trim().length < 5}
            onClick={() => action.mutate({ decision: "keep", reason })}
          >
            {t("import_keep")}
          </button>
          {canApply && (
            <button
              disabled={reason.trim().length < 5 || !taxonRevision}
              onClick={() =>
                action.mutate({ decision: "apply", taxonRevision, reason })
              }
            >
              {t("import_apply")}
            </button>
          )}
        </fieldset>
      )}
      <ActionState action={action} />
    </details>
  );
}
export function SizeReview({
  size,
  taxonId,
}: {
  size?: Size;
  taxonId?: string;
}) {
  const { t } = useTranslation(),
    online = useOnline(),
    refresh = useRefresh(),
    [value, setValue] = useState(
      size?.value === null || !size ? "" : String(size.value),
    ),
    [unit, setUnit] = useState(size?.unit ?? "cm"),
    [method, setMethod] = useState(size?.measurement_method ?? ""),
    [scope, setScope] = useState(size?.scope ?? ""),
    [source, setSource] = useState(size?.source_url ?? ""),
    [status, setStatus] = useState(size?.verification_status ?? "pending"),
    [use, setUse] = useState(false),
    [noMinimum, setNoMinimum] = useState(false);
  const action = useConfirmedWrite(
    size
      ? `/admin/imports/sizes/${size.id}/review`
      : `/admin/catalog/${taxonId}/size-references`,
    "POST",
    refresh,
  );
  return (
    <details>
      <summary>
        {size
          ? `${size.value ?? "?"} ${size.unit ?? ""} · ${t(`import_${size.verification_status}`)}`
          : t("import_addSize")}
      </summary>
      {size && <p>{size.literal}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action.mutate({
            revision: size?.revision ?? 0,
            value: value ? Number(value) : null,
            unit: value ? unit : null,
            method: method || null,
            scope,
            sourceUrl: source,
            verificationStatus: status,
            useForLeagues: use,
            noMinimumConfirmed: noMinimum,
          });
        }}
      >
        <fieldset disabled={!online || action.isPending || action.uncertain}>
          <label>
            {t("import_value")}
            <input
              type="number"
              min="0.001"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <label>
            {t("import_unit")}
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {["cm", "mm", "g", "kg"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            {t("import_method")}
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">{t("import_unknown")}</option>
              {[
                "total_length",
                "mantle_length",
                "cephalothorax_length",
                "individual_weight",
              ].map((x) => (
                <option key={x} value={x}>
                  {t(`import_${x}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("import_scope")}
            <input
              required
              minLength={5}
              maxLength={1000}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
          </label>
          <label>
            {t("sourceUrl")}
            <input
              required
              type="url"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <label>
            {t("import_status")}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["pending", "approved", "rejected"].map((x) => (
                <option value={x} key={x}>
                  {t(`import_${x}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={noMinimum}
              onChange={(e) => setNoMinimum(e.target.checked)}
            />
            {t("import_noMinimum")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={use}
              onChange={(e) => setUse(e.target.checked)}
            />
            {t("import_useLeague")}
          </label>
          <p>{t("import_methodNotice")}</p>
          <button className="primary">{t("save")}</button>
        </fieldset>
      </form>
      <ActionState action={action} />
    </details>
  );
}
function ImageReview({ image }: { image: SourceImage }) {
  const { t } = useTranslation(),
    online = useOnline(),
    refresh = useRefresh(),
    [author, setAuthor] = useState(image.author ?? ""),
    [license, setLicense] = useState(image.license_url ?? ""),
    [evidence, setEvidence] = useState(image.rights_evidence ?? ""),
    [rights, setRights] = useState(false);
  const approve = useConfirmedWrite(
      `/admin/imports/images/${image.id}/approve`,
      "POST",
      refresh,
    ),
    reject = useConfirmedWrite(
      `/admin/imports/images/${image.id}/reject`,
      "POST",
      refresh,
    );
  return (
    <details>
      <summary>
        {t(`import_${image.authorization}`)} ·{" "}
        {t(`import_image_${image.image_type}`)}
      </summary>
      <p>
        <a href={image.page_url} target="_blank" rel="noreferrer">
          {t("source")} ↗
        </a>
      </p>
      {image.authorization === "downloaded" ? (
        <p>{t("import_selectInEditor")}</p>
      ) : (
        image.authorization !== "rejected" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              approve.mutate({
                revision: image.revision,
                author,
                licenseUrl: license,
                rightsEvidence: evidence,
                rightsConfirmed: rights,
              });
            }}
          >
            <fieldset
              disabled={
                !online ||
                approve.isPending ||
                approve.uncertain ||
                reject.isPending ||
                reject.uncertain
              }
            >
              <label>
                {t("photoAuthor")}
                <input
                  required
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </label>
              <label>
                {t("import_licenseUrl")}
                <input
                  required
                  type="url"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                />
              </label>
              <label>
                {t("import_evidence")}
                <textarea
                  required
                  minLength={10}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                />
              </label>
              <label className="check">
                <input
                  required
                  type="checkbox"
                  checked={rights}
                  onChange={(e) => setRights(e.target.checked)}
                />
                {t("rightsConfirmed")}
              </label>
              <button disabled={!rights}>{t("import_download")}</button>
              <button
                type="button"
                onClick={() => reject.mutate({ revision: image.revision })}
              >
                {t("rejectPhoto")}
              </button>
            </fieldset>
          </form>
        )
      )}
      <ActionState action={approve} />
      <ActionState action={reject} />
    </details>
  );
}
export function SizeReferences({
  taxonId,
  admin = false,
}: {
  taxonId: string;
  admin?: boolean;
}) {
  const { t } = useTranslation(),
    online = useOnline(),
    refs = useQuery({
      queryKey: ["sizeReferences", taxonId],
      queryFn: () => api<Size[]>(`/catalog/${taxonId}/size-references`),
      enabled: online,
    });
  return (
    <section>
      <h2>{t("import_sizes")}</h2>
      <p className="notice">{t("import_sizeNotice")}</p>
      <ErrorMessage error={refs.error} />
      {refs.data?.map((size) =>
        admin ? (
          <SizeReview key={`${size.id}:${size.revision}`} size={size} />
        ) : (
          <p key={size.id}>
            {size.value ?? t("import_unknown")} {size.unit ?? ""} ·{" "}
            {size.measurement_method
              ? t(`import_${size.measurement_method}`)
              : t("import_unknown")}{" "}
            · {t(`import_${size.verification_status}`)} ·{" "}
            <a href={size.source_url} target="_blank" rel="noreferrer">
              {t("source")}
            </a>
          </p>
        ),
      )}
      {admin && <SizeReview taxonId={taxonId} />}
    </section>
  );
}
