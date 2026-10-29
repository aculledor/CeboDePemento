import { fetch, EnvHttpProxyAgent } from "undici";
import robotsModule from "robots-parser";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import {
  origin,
  landing,
  categories,
  safeUrl,
  digest,
  discover,
  externalId,
  parseDetail,
  mergeTranslations,
  policySchema,
  type Policy,
  type Category,
  type SourceRecord,
} from "./parser.js";

export const userAgent =
  "CeboDePementoCatalog/0.2 (+https://github.com/aculledor/CeboDePemento; metadata review)";
// robots-parser ships an ambient declaration as well as a default function.
const robotsParser = robotsModule as unknown as (
  url: string,
  text: string,
) => {
  isAllowed: (url: string, ua: string) => boolean | undefined;
  getCrawlDelay: (ua: string) => number | undefined;
};
export interface Page {
  url: string;
  status: number;
  html: string;
  retrievedAt: string;
  sha256: string;
}
export type Transport = (url: string) => Promise<{
  status: number;
  body: string;
  location?: string;
  retryAfter?: string;
}>;
const agent = new EnvHttpProxyAgent();
export const httpTransport: Transport = async (url) => {
  const res = await fetch(safeUrl(url), {
    dispatcher: agent,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": userAgent, Accept: "text/html,text/plain;q=0.9" },
  }).catch((error: unknown) => {
    const parts: string[] = [];
    let current: unknown = error;
    for (let n = 0; n < 5 && current instanceof Error; n++) {
      parts.push(current.message);
      current = current.cause;
    }
    if (/403|forbidden|access denied/i.test(parts.join(" ")))
      throw new Error(`SOURCE_ACCESS_DENIED proxy/HTTP 403 ${url}`);
    throw error;
  });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of res.body!) {
    const b = Buffer.from(part);
    size += b.length;
    if (size > 2 * 1024 * 1024) {
      await res.body?.cancel().catch(() => {});
      throw new Error("SOURCE_BODY_TOO_LARGE");
    }
    chunks.push(b);
  }
  return {
    status: res.status,
    body: Buffer.concat(chunks).toString("utf8"),
    location: res.headers.get("location") ?? undefined,
    retryAfter: res.headers.get("retry-after") ?? undefined,
  };
};
export function saveJson(file: string, value: unknown) {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
export class SourceClient {
  private lastRequest = 0;
  private robots: ReturnType<typeof robotsParser> | null = null;
  constructor(
    readonly directory: string,
    private transport: Transport = httpTransport,
    private wait = pause,
    private minimumPause = 1500,
  ) {
    mkdirSync(resolve(directory, "pages"), { recursive: true });
  }
  async page(value: string, robotsExempt = false): Promise<Page> {
    const url = safeUrl(value);
    if (!robotsExempt) {
      if (!this.robots) throw new Error("ROBOTS_NOT_CHECKED");
      if (this.robots.isAllowed(url, userAgent) === false)
        throw new Error(`ROBOTS_DENIED ${url}`);
    }
    const file = resolve(this.directory, "pages", `${digest(url)}.json`);
    if (existsSync(file)) {
      const cached = JSON.parse(readFileSync(file, "utf8")) as Page;
      if (cached.url !== url || cached.sha256 !== digest(cached.html))
        throw new Error("CACHE_INTEGRITY_FAILED");
      return cached;
    }
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const crawlDelay = (this.robots?.getCrawlDelay(userAgent) ?? 0) * 1000;
      const delay =
        Math.max(this.minimumPause, crawlDelay) -
        (Date.now() - this.lastRequest);
      if (delay > 60000)
        throw new Error("CRAWL_DELAY_EXCEEDS_ONE_MINUTE; resume later");
      if (delay > 0) await this.wait(delay);
      this.lastRequest = Date.now();
      let response: Awaited<ReturnType<Transport>>;
      try {
        response = await this.transport(url);
      } catch (error) {
        if (/SOURCE_ACCESS_DENIED|SOURCE_CHALLENGE/.test(String(error)))
          throw error;
        last = error;
        if (attempt < 2) await this.wait(1500 * 2 ** attempt);
        continue;
      }
      if (response.status >= 300 && response.status < 400)
        throw new Error(
          `SOURCE_REDIRECT_REVIEW_REQUIRED ${url} ${response.location ?? ""}`,
        );
      if (response.status === 401 || response.status === 403)
        throw new Error(`SOURCE_ACCESS_DENIED ${response.status} ${url}`);
      if (response.status === 429 || response.status >= 500) {
        last = new Error(`SOURCE_TEMPORARY_ERROR ${response.status} ${url}`);
        const retry = response.retryAfter
          ? Number(response.retryAfter) * 1000
          : 1500 * 2 ** attempt;
        if (!Number.isFinite(retry) || retry > 60000) throw last;
        if (attempt < 2) await this.wait(Math.max(retry, 1500));
        continue;
      }
      if (response.status !== 200 && !(robotsExempt && response.status === 404))
        throw new Error(`SOURCE_HTTP_${response.status} ${url}`);
      if (/captcha|cf-chl-|access denied|acceso denegado/i.test(response.body))
        throw new Error(`SOURCE_CHALLENGE ${url}`);
      const page = {
        url,
        status: response.status,
        html: response.body,
        retrievedAt: new Date().toISOString(),
        sha256: digest(response.body),
      };
      saveJson(file, page);
      return page;
    }
    throw last ?? new Error("SOURCE_UNAVAILABLE");
  }
  async checkRobots() {
    const page = await this.page(`${origin}/robots.txt`, true);
    this.robots = robotsParser(page.url, page.status === 404 ? "" : page.html);
    return page;
  }
}
export async function inspectSource(client: SourceClient) {
  const robots = await client.checkRobots(),
    page = await client.page(landing);
  const found = discover(page.html, page.url, "fish"),
    legal: Page[] = [];
  for (const url of found.legal.slice(0, 10))
    legal.push(await client.page(url));
  const inspection = {
    inspectedAt: new Date().toISOString(),
    robots: { url: robots.url, status: robots.status, sha256: robots.sha256 },
    legal: legal.map((p) => ({ url: p.url, sha256: p.sha256 })),
    legalReviewRequired: true,
  };
  saveJson(resolve(client.directory, "inspection.json"), inspection);
  saveJson(resolve(client.directory, "policy.example.json"), {
    reviewedBy: "",
    reviewedAt: new Date().toISOString(),
    automatedAccessAllowed: false,
    metadataReuseAllowed: false,
    descriptionsReuseAllowed: false,
    imagesReuseAllowed: false,
    evidence: inspection.legal,
    notes:
      "Revisar las condiciones guardadas; no autoriza la reutilización por defecto.",
  });
  return inspection;
}
export async function verifyPolicy(
  client: SourceClient,
  input: unknown,
): Promise<Policy> {
  const policy = policySchema.parse(input);
  await client.checkRobots();
  for (const evidence of policy.evidence) {
    const page = await client.page(safeUrl(evidence.url));
    if (page.sha256 !== evidence.sha256)
      throw new Error("LEGAL_EVIDENCE_CHANGED; inspect and review again");
  }
  return policy;
}
export interface CrawlResult {
  records: SourceRecord[];
  found: number;
  errors: { url: string; error: string }[];
  partial: boolean;
}
export async function crawlSource(
  client: SourceClient,
  policy: Policy,
  selected: Category[],
  limit = 1000,
  onProgress?: (message: string) => void,
): Promise<CrawlResult> {
  const result: CrawlResult = {
      records: [],
      found: 0,
      errors: [],
      partial: false,
    },
    details = new Map<string, { url: string; category: Category }>();
  const checkpoint = () =>
    saveJson(resolve(client.directory, "checkpoint.json"), result);
  // Category URLs are entry points only. Every detail and pagination URL comes from HTML.
  for (const category of selected) {
    const queue = [`${landing}/${categories[category]}`],
      seen = new Set<string>();
    while (queue.length) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      if (seen.size >= 100) throw new Error("CATEGORY_PAGE_LIMIT");
      seen.add(url);
      onProgress?.(`category ${url}`);
      const page = await client.page(url),
        links = discover(page.html, url, category);
      for (const link of links.details)
        details.set(`${category}:${externalId(link)}`, { url: link, category });
      queue.push(...links.pages.filter((x) => !seen.has(x)));
      for (const translation of links.translations)
        if (
          !new URL(translation).search &&
          /\/(gl|es)\//.test(translation) &&
          !/especie|ficha/.test(translation)
        )
          queue.push(translation);
    }
  }
  result.found = details.size;
  if (!details.size)
    throw new Error(
      "NO_DETAILS_DISCOVERED; inspect HTML/selectors before importing",
    );
  for (const { url, category } of details.values()) {
    if (result.records.length >= limit) {
      result.partial = true;
      break;
    }
    try {
      onProgress?.(`detail ${url}`);
      const page = await client.page(url);
      let record = parseDetail(
        page.html,
        url,
        category,
        policy,
        page.retrievedAt,
      );
      if (!record.scientificName)
        throw new Error("DETAIL_SCHEMA_UNRECOGNIZED; scientific field missing");
      const links = discover(page.html, url, category);
      for (const translation of links.translations) {
        if (
          externalId(translation) !== record.externalId ||
          translation === url
        )
          continue;
        const other = await client.page(translation);
        record = mergeTranslations(
          record,
          parseDetail(
            other.html,
            translation,
            category,
            policy,
            other.retrievedAt,
          ),
        );
      }
      result.records.push(record);
    } catch (error) {
      result.errors.push({
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      checkpoint();
      if (/ACCESS_DENIED|CHALLENGE|ROBOTS_DENIED/.test(String(error)))
        throw error;
    }
    checkpoint();
  }
  checkpoint();
  return result;
}
