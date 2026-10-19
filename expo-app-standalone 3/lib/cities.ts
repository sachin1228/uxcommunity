/**
 * The city options the event form offers — the same public master list the web
 * form's picker reads (`GET /api/data/cities`), sorted by name by the server.
 */
import { apiFetch } from './api';

export interface CityOption {
  id: string;
  name: string;
  image_url: string | null;
}

export async function getCities(): Promise<CityOption[]> {
  const { data } = await apiFetch<{ cities?: CityOption[] }>('/api/data/cities');
  return data.cities ?? [];
}
