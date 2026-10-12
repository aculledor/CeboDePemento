export const normalizeSearch = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
export type Category = 'fish' | 'cephalopod' | 'crustacean';
export interface TaxonName { language: 'gl' | 'es' | 'la'; name: string; isPrimary: number; sourceId: string }
export interface Taxon {
  id: string; scientificName: string | null; category: Category;
  identificationLevel: 'species_name' | 'aggregate' | 'unresolved';
  reviewStatus: string; localPresenceStatus: string; initialSelection: number; notes: string;
  names: TaxonName[];
}
export interface CatalogResponse { items: Taxon[]; total: number; page: number; pageSize: number }
export interface HealthResponse { status: 'ok'; catalog: { reference: number; initial: number; pending: number }; migrations: number }
export interface ApiError { code: string; message: string }
