import { z } from "zod";
export const normalizeSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
export type Category = "fish" | "cephalopod" | "crustacean";
export interface TaxonName {
  language: "gl" | "es" | "la";
  name: string;
  isPrimary: number;
  sourceId: string;
}
export interface Taxon {
  id: string;
  scientificName: string | null;
  category: Category;
  identificationLevel: "species_name" | "aggregate" | "unresolved";
  reviewStatus: string;
  localPresenceStatus: string;
  initialSelection: number;
  notes: string;
  names: TaxonName[];
  primaryPhotoId: string | null;
  active: number;
  descriptionGl: string;
  descriptionEs: string;
  tipsGl: string;
  tipsEs: string;
  taxonomicClass: string;
  taxonomicOrder: string;
  family: string;
  sizeStatus: "pending" | "has_minimum" | "confirmed_no_minimum";
  minimumCm: number | null;
  minimumSource: string;
  minimumReviewedAt: string | null;
  minimumReviewedBy: string | null;
  revision: number;
}
export interface CatalogResponse {
  items: Taxon[];
  total: number;
  page: number;
  pageSize: number;
}
export interface HealthResponse {
  status: "ok";
  catalog: { reference: number; initial: number; pending: number };
  migrations: number;
}
export interface ApiError {
  code: string;
  message: string;
}
export interface User {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  active: number;
  createdAt: string;
}
const editorial = z.string().max(5000),
  taxonomy = z.string().trim().max(120);
export const taxonInputSchema = z
  .object({
    scientificName: z.string().trim().min(1).max(200).nullable(),
    category: z.enum(["fish", "cephalopod", "crustacean"]),
    identificationLevel: z.enum(["species_name", "aggregate", "unresolved"]),
    reviewStatus: z.enum(["pending", "reviewed"]),
    localPresenceStatus: z.string().trim().min(1).max(80),
    notes: editorial,
    names: z
      .array(
        z
          .object({
            language: z.enum(["gl", "es", "la"]),
            name: z.string().trim().min(1).max(200),
            isPrimary: z.number().int().min(0).max(1),
          })
          .strict(),
      )
      .min(1)
      .max(60),
    active: z.number().int().min(0).max(1),
    descriptionGl: editorial,
    descriptionEs: editorial,
    tipsGl: editorial,
    tipsEs: editorial,
    taxonomicClass: taxonomy,
    taxonomicOrder: taxonomy,
    family: taxonomy,
    sizeStatus: z.enum(["pending", "has_minimum", "confirmed_no_minimum"]),
    minimumCm: z.number().positive().max(1000).nullable(),
    minimumSource: z.string().trim().max(1000),
    minimumReviewedAt: z.iso.datetime().nullable(),
    revision: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const n of value.names) {
      const key = `${n.language}:${n.name}`;
      if (seen.has(key))
        ctx.addIssue({
          code: "custom",
          path: ["names"],
          message: "Duplicate alias",
        });
      seen.add(key);
    }
    for (const language of ["gl", "es", "la"])
      if (
        value.names.filter((n) => n.language === language && n.isPrimary === 1)
          .length > 1
      )
        ctx.addIssue({
          code: "custom",
          path: ["names"],
          message: "More than one primary name",
        });
    if (value.identificationLevel === "species_name" && !value.scientificName)
      ctx.addIssue({
        code: "custom",
        path: ["scientificName"],
        message: "Scientific name required",
      });
    if (value.sizeStatus === "has_minimum" && value.minimumCm === null)
      ctx.addIssue({
        code: "custom",
        path: ["minimumCm"],
        message: "Minimum required",
      });
    if (value.sizeStatus !== "has_minimum" && value.minimumCm !== null)
      ctx.addIssue({
        code: "custom",
        path: ["minimumCm"],
        message: "Minimum must be empty",
      });
    if (
      value.sizeStatus !== "pending" &&
      (!value.minimumSource || !value.minimumReviewedAt)
    )
      ctx.addIssue({
        code: "custom",
        path: ["minimumSource"],
        message: "Reviewed size requires source and date",
      });
  });
export type TaxonInput = z.infer<typeof taxonInputSchema>;
export function toTaxonInput(taxon: Taxon): TaxonInput {
  const {
    id,
    initialSelection,
    minimumReviewedBy,
    primaryPhotoId,
    names,
    ...fields
  } = taxon;
  return {
    ...fields,
    reviewStatus: fields.reviewStatus === "reviewed" ? "reviewed" : "pending",
    names: names.map(({ sourceId, ...name }) => name),
  };
}
