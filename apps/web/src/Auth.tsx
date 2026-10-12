import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { write, ApiFailure } from "./api";
import { useOnline } from "./connectivity";
const formSchema = z.object({
  username: z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/),
  password: z.string().min(12).max(128),
  displayName: z.string().max(80),
  token: z.string().max(100),
});
type Values = z.infer<typeof formSchema>;
export function Auth({
  mode = "login",
  done,
}: {
  mode?: "login" | "register" | "reset";
  done: () => Promise<void>;
}) {
  const { t } = useTranslation(),
    navigate = useNavigate(),
    online = useOnline();
  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: mode === "reset" ? "reset" : "",
      password: "",
      displayName: "",
      token: "",
    },
  });
  const mutation = useMutation({
    mutationFn: (values: Values) =>
      write(
        `/auth/${mode}`,
        mode === "login"
          ? { username: values.username, password: values.password }
          : mode === "reset"
            ? { token: values.token, password: values.password }
            : values,
      ),
    onSuccess: async () => {
      form.reset();
      await done();
      navigate(mode === "login" ? "/" : "/login");
    },
  });
  return (
    <section className="authpanel">
      <p className="eyebrow">Cebo de Pemento</p>
      <h1>{t(mode)}</h1>
      <p className="muted">{t("authIntro")}</p>
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <fieldset disabled={!online || mutation.isPending}>
          {mode !== "reset" && (
            <label>
              {t("username")}
              <input autoComplete="username" {...form.register("username")} />
            </label>
          )}
          {mode === "register" && (
            <label>
              {t("displayName")}
              <input {...form.register("displayName")} required />
            </label>
          )}
          {mode !== "login" && (
            <label>
              {t("token")}
              <input autoComplete="off" {...form.register("token")} required />
            </label>
          )}
          <label>
            {t(mode === "reset" ? "newPassword" : "password")}
            <input
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              {...form.register("password")}
            />
          </label>
          <p className="muted">{t("passwordHelp")}</p>
          {!!Object.keys(form.formState.errors).length && (
            <p role="alert" className="error">
              {t("invalidForm")}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className="error">
              {t(
                mutation.error instanceof ApiFailure
                  ? `error_${mutation.error.code}`
                  : "offline",
              )}
            </p>
          )}
          <button className="primary" disabled={mutation.isPending}>
            {mutation.isPending ? t("saving") : t(mode)}
          </button>
        </fieldset>
      </form>
      <div className="authlinks">
        <Link to="/login">{t("login")}</Link>
        <Link to="/register">{t("register")}</Link>
        <Link to="/reset">{t("reset")}</Link>
      </div>
    </section>
  );
}
