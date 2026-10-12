import { useTranslation } from "react-i18next";
import { ApiFailure } from "./api";
export function ErrorMessage({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return error ? (
    <p role="alert" className="error">
      {t(error instanceof ApiFailure ? `error_${error.code}` : "offline")}
    </p>
  ) : null;
}
