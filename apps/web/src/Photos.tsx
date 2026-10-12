import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "./api";
import { useOnline } from "./connectivity";
import { useConfirmedWrite } from "./useConfirmedWrite";
import { ErrorMessage } from "./ErrorMessage";
export interface Photo {
  id: string;
  author: string;
  license: string;
  license_url: string;
  original_url: string;
  status: string;
  is_primary: number;
  remote_thumbnail: string | null;
}
export function Gallery({
  id,
  capture = false,
}: {
  id: string;
  capture?: boolean;
}) {
  const { t } = useTranslation(),
    online = useOnline(),
    photos = useQuery({
      queryKey: ["photos", id],
      queryFn: () =>
        api<Photo[]>(
          capture ? `/captures/${id}/photos` : `/catalog/${id}/photos`,
        ),
      enabled: online,
    });
  return (
    <>
      {online &&
        photos.data
          ?.filter((p) => p.status === "approved")
          .map((photo) => (
            <figure key={photo.id}>
              <img
                className="speciesphoto"
                src={`/api/photos/${photo.id}/image`}
                alt={t(capture ? "capturePhoto" : "speciesPhoto")}
              />
              <figcaption>
                {photo.author} ·{" "}
                <a href={photo.license_url} target="_blank" rel="noreferrer">
                  {photo.license}
                </a>{" "}
                ·{" "}
                <a href={photo.original_url} target="_blank" rel="noreferrer">
                  {t("source")}
                </a>
              </figcaption>
            </figure>
          ))}
    </>
  );
}
function PhotoActions({
  photo,
  refresh,
}: {
  photo: Photo;
  refresh: () => Promise<void>;
}) {
  const { t } = useTranslation(),
    online = useOnline(),
    [rights, setRights] = useState(false);
  const approve = useConfirmedWrite(
      `/admin/photos/${photo.id}/approve`,
      "POST",
      refresh,
    ),
    reject = useConfirmedWrite(
      `/admin/photos/${photo.id}/reject`,
      "POST",
      refresh,
    ),
    primary = useConfirmedWrite(
      `/admin/photos/${photo.id}/primary`,
      "POST",
      refresh,
    );
  const actions = [approve, reject, primary];
  return (
    <article className="adminbox">
      <img
        className="candidatephoto"
        src={
          photo.status === "approved"
            ? `/api/photos/${photo.id}/thumbnail`
            : (photo.remote_thumbnail ?? "")
        }
        alt={t("photoCandidate")}
      />
      <p className="eyebrow">{t(`photo_${photo.status}`)}</p>
      <p>
        {photo.author} · {photo.license}
      </p>
      <a href={photo.original_url} target="_blank" rel="noreferrer">
        {t("source")} ↗
      </a>
      {photo.status === "candidate" && (
        <label className="check">
          <input
            type="checkbox"
            checked={rights}
            onChange={(e) => setRights(e.target.checked)}
          />
          {t("rightsConfirmed")}
        </label>
      )}
      <div className="filters">
        {photo.status === "candidate" && (
          <button
            disabled={
              !online || !rights || approve.isPending || approve.uncertain
            }
            onClick={() =>
              approve.mutate({ rightsConfirmed: true, isPrimary: false })
            }
          >
            {t("approvePhoto")}
          </button>
        )}
        {photo.status === "approved" && !photo.is_primary && (
          <button
            disabled={!online || primary.isPending || primary.uncertain}
            onClick={() => primary.mutate({})}
          >
            {t("mainPhoto")}
          </button>
        )}
        {photo.status !== "rejected" && (
          <button
            disabled={!online || reject.isPending || reject.uncertain}
            onClick={() => reject.mutate({})}
          >
            {t("rejectPhoto")}
          </button>
        )}
      </div>
      {actions.map((action, index) => (
        <div key={index}>
          <ErrorMessage error={action.error} />
          {action.uncertain && (
            <button disabled={!online} onClick={action.reconcile}>
              {t("reconcile")}
            </button>
          )}
        </div>
      ))}
    </article>
  );
}
export function PhotoManager({
  id,
  capture = false,
}: {
  id: string;
  capture?: boolean;
}) {
  const { t } = useTranslation(),
    online = useOnline(),
    client = useQueryClient(),
    [file, setFile] = useState(""),
    [author, setAuthor] = useState(""),
    [originalUrl, setOriginal] = useState(""),
    [license, setLicense] = useState("CC BY 4.0"),
    [rights, setRights] = useState(false),
    [fileError, setFileError] = useState(false);
  const photos = useQuery({
    queryKey: ["photos", id],
    queryFn: () =>
      api<Photo[]>(
        capture ? `/captures/${id}/photos` : `/catalog/${id}/photos`,
      ),
    enabled: online,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["photos", id] });
  };
  const upload = useConfirmedWrite(
      capture ? `/captures/${id}/photos` : `/admin/catalog/${id}/photos`,
      "POST",
      async () => {
        setFile("");
        setRights(false);
        await refresh();
      },
    ),
    candidates = useConfirmedWrite<{ ids: string[] }, unknown>(
      `/admin/catalog/${id}/photo-candidates`,
      "POST",
      refresh,
    );
  return (
    <section>
      <h2>{t("photos")}</h2>
      <p className="notice">{t("photoNotice")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          upload.mutate({
            base64: file,
            author,
            originalUrl,
            license,
            rightsConfirmed: rights,
            isPrimary: !capture,
          });
        }}
      >
        <fieldset disabled={!online || upload.isPending || upload.uncertain}>
          <label>
            {t("uploadPhoto")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={async (e) => {
                const selected = e.target.files?.[0];
                setFileError(!!selected && selected.size > 8 * 1024 * 1024);
                if (!selected || selected.size > 8 * 1024 * 1024) {
                  setFile("");
                  return;
                }
                const bytes = new Uint8Array(await selected.arrayBuffer());
                let binary = "";
                for (let i = 0; i < bytes.length; i += 8192)
                  binary += String.fromCharCode(...bytes.slice(i, i + 8192));
                setFile(btoa(binary));
              }}
            />
          </label>
          <label>
            {t("photoAuthor")}
            <input
              required
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <label>
            {t("sourceUrl")}
            <input
              type="url"
              value={originalUrl}
              onChange={(e) => setOriginal(e.target.value)}
            />
          </label>
          <label>
            {t("license")}
            <select
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            >
              {[
                "CC0",
                "CC BY 4.0",
                "CC BY 3.0",
                "CC BY-SA 4.0",
                "CC BY-SA 3.0",
                "Public domain",
              ].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              required
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
            />
            {t("rightsConfirmed")}
          </label>
          {fileError && <p className="error">{t("error_IMAGE_TOO_LARGE")}</p>}
          <button disabled={!file || !rights} className="primary">
            {t("uploadPhoto")}
          </button>
        </fieldset>
      </form>
      <ErrorMessage error={upload.error} />
      {upload.uncertain && (
        <button disabled={!online} onClick={upload.reconcile}>
          {t("reconcile")}
        </button>
      )}
      {!capture && (
        <>
          <h3>{t("findCandidates")}</h3>
          <div className="filters">
            {["commons", "inaturalist"].map((provider) => (
              <button
                key={provider}
                disabled={
                  !online || candidates.isPending || candidates.uncertain
                }
                onClick={() => candidates.mutate({ provider })}
              >
                {provider === "commons" ? "Wikimedia Commons" : "iNaturalist"}
              </button>
            ))}
          </div>
          {candidates.isSuccess && (
            <p role="status">
              {t("candidatesFound", {
                count: candidates.data?.ids.length ?? 0,
              })}
            </p>
          )}
          <ErrorMessage error={candidates.error} />
          {candidates.uncertain && (
            <button disabled={!online} onClick={candidates.reconcile}>
              {t("reconcile")}
            </button>
          )}
        </>
      )}
      <ErrorMessage error={photos.error} />
      <div className="grid">
        {photos.data?.map((photo) =>
          capture ? (
            <figure key={photo.id}>
              <img
                className="candidatephoto"
                src={`/api/photos/${photo.id}/thumbnail`}
                alt={t(capture ? "capturePhoto" : "speciesPhoto")}
              />
              <figcaption>
                {photo.author} · {photo.license}
              </figcaption>
            </figure>
          ) : (
            <PhotoActions key={photo.id} photo={photo} refresh={refresh} />
          ),
        )}
      </div>
    </section>
  );
}
