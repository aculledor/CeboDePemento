import { test, expect } from "@playwright/test";
import { DateTime } from "luxon";
test("Mobile login, real catalog, session/capture, league, statistics, map and invitation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("combobox", { name: "Idioma" }).selectOption("es");
  await page.getByLabel("Usuario", { exact: true }).fill("admin");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("only-for-browser-tests");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Buena pesca, Browser Test Admin." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Explorar especies" }).click();
  await page.getByRole("searchbox").fill("xúrelo");
  await page.getByRole("heading", { name: "Jurel", exact: true }).click();
  await expect(
    page.getByText("Trachurus trachurus", { exact: true }),
  ).toBeVisible();
  await page.goto("/sessions/new");
  await page
    .getByRole("button", { name: "Guardar en el servidor", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Añadir lote" }),
  ).toBeVisible();
  await page
    .getByLabel("Nombre común o científico", { exact: true })
    .fill("jurel");
  await page.getByLabel("Especies").selectOption({ label: "Jurel" });
  await page.getByLabel("Ejemplares", { exact: true }).fill("7");
  const form = page
    .getByRole("heading", { name: "Añadir lote" })
    .locator("..")
    .locator("..");
  // The server commits but its response is lost; reconciliation must not create a duplicate.
  await page.route("**/api/sessions/*/captures", async (route) => {
    if (route.request().method() === "POST") {
      await route.fetch();
      await route.abort("failed");
      await page.unroute("**/api/sessions/*/captures");
    } else await route.continue();
  });
  await form.getByRole("button", { name: "Guardar en el servidor" }).click();
  await expect(
    page.getByRole("button", { name: "Comprobar conexión" }),
  ).toBeVisible();
  await expect(
    form.getByRole("button", { name: "Guardar en el servidor" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Comprobar conexión" }).click();
  await expect(page.getByText("API conectada", { exact: true })).toBeVisible();
  await form
    .getByRole("button", { name: "Consultar resultado / reintentar" })
    .click();
  await expect(page.locator(".capturelist details")).toHaveCount(1);
  await page.getByRole("button", { name: "Cerrar ahora", exact: true }).click();
  await expect(
    page.getByLabel("Fin (vacío si está activa)", { exact: true }),
  ).not.toHaveValue("");
  const now = DateTime.now().setZone("Europe/Madrid");
  await page.goto("/leagues/new");
  await page.getByLabel("Nombre", { exact: true }).fill("Liga browser test");
  await page
    .getByLabel("Primera jornada", { exact: true })
    .fill(now.startOf("month").toISODate()!);
  await page
    .getByLabel("Última jornada", { exact: true })
    .fill(now.endOf("month").toISODate()!);
  await page
    .getByRole("button", { name: "Guardar en el servidor", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Clasificación", exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody tr").first()).toHaveText(
    "1Browser Test Admin77",
  );
  await page.goto("/profile");
  await expect(
    page.getByRole("heading", { name: "Browser Test Admin", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/map");
  await expect(
    page.getByRole("heading", { name: "Corrubedo", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".leaflet-container")).toHaveCount(1);
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Crear invitación · 72 horas", exact: true })
    .click();
  await expect(page.locator("code.token")).toHaveText(/[A-Za-z0-9_-]{43}/);
  expect(errors).toEqual([]);
});
