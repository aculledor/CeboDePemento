import { load } from "cheerio";
import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeSearch } from "@cebo/shared";

export const origin = "https://deondesenon.xunta.gal";
export const landing = `${origin}/es/productos-de-la-marca/que-productos-me-ofrece-la-marca`;
export const categories = {
  fish: "peces",
  cephalopod: "cefalopodos",
  crustacean: "crustaceos",
} as const;
export type Category = keyof typeof categories;
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const clean = (value: string) => value.replace(/\s+/g, " ").trim();
export function safeUrl(value: string, base = origin) {
  const url = new URL(value, base);
  if (url.origin !== origin || url.username || url.password || url.port)
    throw new Error("SOURCE_URL_DENIED");
  url.hash = "";
  return url.href;
}
export const policySchema = z
  .object({
    reviewedBy: z.string().trim().min(1),
    reviewedAt: z.iso.datetime(),
    automatedAccessAllowed: z.literal(true),
    metadataReuseAllowed: z.literal(true),
    descriptionsReuseAllowed: z.boolean(),
    imagesReuseAllowed: z.boolean(),
    evidence: z
      .array(
        z
          .object({ url: z.url(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict(),
      )
      .min(1),
    notes: z.string().trim().min(10),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const sizeSchema = z.object({
  literal: z.string().max(2000),
  value: z.number().positive().nullable(),
  unit: z.enum(["cm", "mm", "g", "kg"]).nullable(),
  method: z.string().max(200).nullable(),
});
export const imageSchema = z.object({
  url: z.url(),
  pageUrl: z.url(),
  type: z.enum(["photo", "illustration", "unknown"]),
  author: z.string().max(1000).nullable(),
  license: z.string().max(200).nullable(),
  licenseUrl: z.url().nullable(),
  rightsEvidence: z.string().max(2000).nullable(),
  authorization: z.enum(["authorized", "pending"]),
});
export const recordSchema = z
  .object({
    externalId: z.string().min(1).max(300),
    category: z.enum(["fish", "cephalopod", "crustacean"]),
    url: z.url(),
    retrievedAt: z.iso.datetime(),
    scientificName: z.string().max(300).nullable(),
    faoCode: z.string().max(30).nullable(),
    names: z.object({
      gl: z.array(z.string().min(1).max(300)).max(50),
      es: z.array(z.string().min(1).max(300)).max(50),
    }),
    sizes: z.array(sizeSchema).max(20),
    images: z.array(imageSchema).max(30),
    descriptions: z.object({
      gl: z.record(z.string(), z.string()),
      es: z.record(z.string(), z.string()),
    }),
    pageHashes: z.record(z.string(), z.string()),
    warnings: z.array(z.string()),
  })
  .strict();
export type SourceRecord = z.infer<typeof recordSchema>;
export const isGeneric = (name: string | null) =>
  !name ||
  /\b(spp?|sp|cf|aff)\.?\b|\b(indeterminad|sin identificar|sen identificar)/i.test(
    name,
  ) ||
  !/^[\p{L}-]+\s+[\p{Ll}-]+/u.test(name);

export function externalId(url: string) {
  const u = new URL(safeUrl(url));
  return (
    u.searchParams.get("id") ??
    u.searchParams.get("idEspecie") ??
    `url:${digest(u.pathname).slice(0, 24)}`
  );
}
export function discover(html: string, url: string, category: Category) {
  const $ = load(html),
    details = new Set<string>(),
    pages = new Set<string>(),
    legal = new Set<string>(),
    translations = new Set<string>();
  const categoryPath = new URL(url).pathname.replace(/\/$/, "");
  $("a[href],link[href]").each((_, element) => {
    const link = $(element);
    let target: string;
    try {
      target = safeUrl(link.attr("href")!, url);
    } catch {
      return;
    }
    const u = new URL(target),
      label = normalizeSearch(link.text() + " " + (link.attr("title") ?? ""));
    if (
      /aviso.legal|legal.notice|condicions|condiciones|reutiliza|licenza|licencia|copyright/.test(
        label + u.pathname,
      )
    )
      legal.add(target);
    if (link.attr("hreflang")?.match(/^(gl|es)(-|$)/)) translations.add(target);
    if (/(bivalv|gasterop|equinoderm|algas|antozo)/i.test(u.pathname)) return;
    if (
      !u.pathname.startsWith(categoryPath + "/") &&
      u.pathname !== categoryPath
    )
      return;
    if (
      u.pathname === categoryPath &&
      target !== url &&
      (u.searchParams.has("page") ||
        u.searchParams.has("start") ||
        link.attr("rel") === "next")
    )
      pages.add(target);
    else if (
      u.pathname !== categoryPath &&
      (/especie|ficha|producto/i.test(u.pathname.slice(categoryPath.length)) ||
        u.searchParams.has("id") ||
        link.closest("article,.producto,.product,.especie,.species").length)
    )
      details.add(target);
  });
  return {
    details: [...details],
    pages: [...pages],
    legal: [...legal],
    translations: [...translations],
    category,
  };
}

export function parseSize(literal: string): z.infer<typeof sizeSchema> {
  // Keep the literal and measurement method. Decimal comma and thousands separators differ.
  const found = literal.match(
    /(\d[\d.\s]*(?:,\d+)?|\d+(?:\.\d+)?)\s*(cent[ií]metros?|mil[ií]metros?|quilogramos?|kilogramos?|gramos?|cm|mm|kg|g)\b/i,
  );
  const unitText = found?.[2]?.toLowerCase(),
    unit: z.infer<typeof sizeSchema>["unit"] = !unitText
      ? null
      : /^(cm|cent)/.test(unitText)
        ? "cm"
        : /^(mm|mili|milí)/.test(unitText)
          ? "mm"
          : /^(kg|quilo|kilo)/.test(unitText)
            ? "kg"
            : "g";
  const number = found?.[1]?.replace(/\s/g, "");
  const normalized = number?.includes(",")
    ? number.replaceAll(".", "").replace(",", ".")
    : number?.replace(/\.(?=\d{3}(?:\.|$))/g, "");
  const value = normalized ? Number(normalized) : null;
  const text = normalizeSearch(literal);
  const method = /manto/.test(text)
    ? "mantle_length"
    : /cefalotorax/.test(text)
      ? "cephalothorax_length"
      : /lonxitude total|longitud total/.test(text)
        ? "total_length"
        : /peso (individual|por individuo)|por (exemplar|ejemplar)/.test(text)
          ? "individual_weight"
          : null;
  return {
    literal,
    value: value && Number.isFinite(value) ? value : null,
    unit: value ? unit : null,
    method,
  };
}

export function openLicense(value: string | null) {
  if (!value) return null;
  const u = new URL(value);
  if (u.protocol !== "https:" || u.hostname !== "creativecommons.org")
    return null;
  const m = u.pathname.match(
    /^\/licenses\/(by|by-sa)\/(2\.0|2\.5|3\.0|4\.0)\/?$/,
  );
  if (m) return `CC ${m[1]!.toUpperCase()} ${m[2]}`;
  if (u.pathname === "/publicdomain/zero/1.0/") return "CC0";
  if (u.pathname === "/publicdomain/mark/1.0/") return "Public domain";
  return null;
}

export function parseDetail(
  html: string,
  url: string,
  category: Category,
  policy: Pick<Policy, "descriptionsReuseAllowed" | "imagesReuseAllowed">,
  retrievedAt = new Date().toISOString(),
): SourceRecord {
  safeUrl(url);
  const $ = load(html);
  $("script,style,nav,header,footer").remove();
  const container = $("main,article,.ficha-especie,.species-detail").first();
  const body = container.length ? container : $("body");
  const fields = new Map<string, string>();
  const put = (key: string, value: string) => {
    const k = normalizeSearch(clean(key).replace(/:$/, ""));
    if (k && clean(value)) fields.set(k, clean(value));
  };
  body.find("dt").each((_, e) => put($(e).text(), $(e).next("dd").text()));
  body.find("tr").each((_, e) => {
    const cells = $(e).children("th,td");
    if (cells.length === 2) put(cells.eq(0).text(), cells.eq(1).text());
  });
  body
    .find("[data-field]")
    .each((_, e) => put($(e).attr("data-field")!, $(e).text()));
  body
    .find(".field,.campo")
    .each((_, e) =>
      put(
        $(e).find(".field-label,.label,strong").first().text(),
        $(e).find(".field-value,.value").first().text(),
      ),
    );
  body.find("h2,h3,h4,strong,b,label").each((_, e) => {
    const node = $(e),
      sibling = node.next();
    if (
      sibling.length &&
      /^(p|div|span|ul)$/i.test(sibling.prop("tagName") ?? "")
    )
      put(node.text(), sibling.text());
    else if (node.parent().is("p,li") && node.text().includes(":"))
      put(node.text(), node.parent().text().slice(node.text().length));
  });
  const field = (...labels: string[]) => {
    for (const label of labels) {
      const value = fields.get(normalizeSearch(label));
      if (value) return value;
    }
    return null;
  };
  const scientificName = field(
    "Nombre científico",
    "Nome científico",
    "scientificName",
    "Denominación científica",
  );
  const fao = field("Código FAO", "FAO", "Código", "codigoFao");
  const lang = (
    $("html").attr("lang") ?? new URL(url).pathname.split("/")[1]
  )?.startsWith("gl")
    ? "gl"
    : "es";
  const split = (value: string | null) =>
    value
      ? value
          .split(/\s*[;,\n]\s*/)
          .map(clean)
          .filter(Boolean)
      : [];
  const names = {
    gl: split(
      field("Nome galego", "Nombre gallego", "Nome en galego", "nomeGalego"),
    ),
    es: split(
      field(
        "Nombre castellano",
        "Nome castelán",
        "Nombre en castellano",
        "nombreCastellano",
      ),
    ),
  };
  // Only a detail with a scientific field may use its h1 as a common name.
  if (scientificName && !names[lang].length) {
    const title = clean(body.find("h1").first().text());
    if (title) names[lang] = [title];
  }
  const sizes: SourceRecord["sizes"] = [];
  for (const [label, value] of fields)
    if (
      /talla minima|tamano minimo|tamanho minimo|talla de referencia|minimumsize/.test(
        label,
      )
    ) {
      const method = field(
        "Método de medición",
        "Medición",
        "Metodo de medida",
      );
      sizes.push(parseSize(`${value}${method ? ` · ${method}` : ""}`));
    }
  const descriptions: SourceRecord["descriptions"] = { gl: {}, es: {} };
  if (policy.descriptionsReuseAllowed)
    for (const [key, labels] of Object.entries({
      description: ["Descripción", "Descrición"],
      identification: ["Identificación", "Características"],
      habitat: ["Hábitat", "Habitat"],
      distribution: ["Distribución"],
    })) {
      const value = field(...labels);
      if (value) descriptions[lang][key] = value;
    }
  const images: SourceRecord["images"] = [];
  body.find("img").each((_, e) => {
    const image = $(e),
      src = image.attr("data-src") ?? image.attr("src");
    if (!src || /logo|icon|banner|sprite/i.test(src)) return;
    let imageUrl: string;
    try {
      imageUrl = safeUrl(src, url);
    } catch {
      return;
    }
    const figure = image.closest("figure,.imagen,.image"),
      caption = clean(figure.find("figcaption,.caption").text());
    const credit =
      caption ||
      field(
        "Autoría",
        "Ilustración",
        "Ilustracións",
        "Fotografía",
        "Créditos",
      ) ||
      "";
    const author =
      clean(
        image.attr("data-author") ??
          credit.match(
            /(?:ilustraci[oó]n|fotograf[ií]a|autor[ií]a|autor|©)\s*:?\s+(.+)/i,
          )?.[1] ??
          "",
      ) || null;
    const link = figure.find('a[rel~="license"]').attr("href");
    let licenseUrl: string | null = null;
    try {
      if (link) licenseUrl = new URL(link, url).href;
    } catch {}
    const license = openLicense(licenseUrl);
    images.push({
      url: imageUrl,
      pageUrl: url,
      type: /ilustra|debux|dibujo/i.test(
        credit + " " + (image.attr("alt") ?? ""),
      )
        ? "illustration"
        : /foto/i.test(credit)
          ? "photo"
          : "unknown",
      author,
      license,
      licenseUrl,
      rightsEvidence: licenseUrl ? `${caption} ${licenseUrl}`.trim() : null,
      authorization:
        policy.imagesReuseAllowed && !!author && !!license
          ? "authorized"
          : "pending",
    });
  });
  const warnings = [];
  if (!scientificName) warnings.push("MISSING_SCIENTIFIC_NAME");
  if (!names.gl.length) warnings.push("MISSING_GL_NAME");
  if (!names.es.length) warnings.push("MISSING_ES_NAME");
  if (!policy.descriptionsReuseAllowed)
    warnings.push("DESCRIPTIONS_RIGHTS_PENDING");
  return recordSchema.parse({
    externalId: externalId(url),
    category,
    url,
    retrievedAt,
    scientificName,
    faoCode: fao?.match(/\b[A-Z]{3}\b/)?.[0] ?? null,
    names,
    sizes,
    images,
    descriptions,
    pageHashes: { [url]: digest(html) },
    warnings,
  });
}

export function mergeTranslations(
  a: SourceRecord,
  b: SourceRecord,
): SourceRecord {
  if (
    a.externalId !== b.externalId ||
    a.category !== b.category ||
    (a.scientificName &&
      b.scientificName &&
      normalizeSearch(a.scientificName) !==
        normalizeSearch(b.scientificName)) ||
    (a.faoCode && b.faoCode && a.faoCode !== b.faoCode)
  )
    throw new Error("TRANSLATION_IDENTITY_CONFLICT");
  return {
    ...a,
    scientificName: a.scientificName ?? b.scientificName,
    faoCode: a.faoCode ?? b.faoCode,
    names: {
      gl: [...new Set([...a.names.gl, ...b.names.gl])],
      es: [...new Set([...a.names.es, ...b.names.es])],
    },
    sizes: [...a.sizes, ...b.sizes].filter(
      (s, i, all) =>
        all.findIndex(
          (x) =>
            x.value === s.value && x.unit === s.unit && x.method === s.method,
        ) === i,
    ),
    images: [...a.images, ...b.images].filter(
      (s, i, all) => all.findIndex((x) => x.url === s.url) === i,
    ),
    descriptions: {
      gl: { ...a.descriptions.gl, ...b.descriptions.gl },
      es: { ...a.descriptions.es, ...b.descriptions.es },
    },
    pageHashes: { ...a.pageHashes, ...b.pageHashes },
    warnings: [...new Set([...a.warnings, ...b.warnings])].filter(
      (x) =>
        !(
          x === "MISSING_GL_NAME" &&
          (a.names.gl.length || b.names.gl.length)
        ) &&
        !(x === "MISSING_ES_NAME" && (a.names.es.length || b.names.es.length)),
    ),
  };
}

// Observation times and HTML layout changes do not produce editorial changes.
export function contentHash(record: SourceRecord) {
  const { retrievedAt, pageHashes, warnings, ...content } = record;
  return digest(JSON.stringify(content));
}
