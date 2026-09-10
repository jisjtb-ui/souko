import type { Layout, LayoutObject, LayoutSnapshot, Location, Product, Warehouse } from '@ws/shared';

export interface WarehouseSummary extends Warehouse {
  layoutCount: number;
}

export interface SaveResult extends LayoutSnapshot {
  warnings?: { duplicateLocationCodes?: string[] };
}

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `通信に失敗しました (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; apiVersion: number }>('/health'),

  listWarehouses: () => request<{ warehouses: WarehouseSummary[] }>('/warehouses'),

  getWarehouse: (id: string) => request<{ warehouse: Warehouse; layouts: Layout[] }>(`/warehouses/${id}`),

  createWarehouse: (input: Partial<Warehouse> & { sample?: boolean }) =>
    request<LayoutSnapshot>('/warehouses', { method: 'POST', body: JSON.stringify(input) }),

  updateWarehouse: (id: string, patch: Partial<Warehouse>) =>
    request<{ warehouse: Warehouse }>(`/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteWarehouse: (id: string) => request<void>(`/warehouses/${id}`, { method: 'DELETE' }),

  getLayout: (id: string) => request<LayoutSnapshot>(`/layouts/${id}`),

  createLayout: (input: { warehouseId?: string; name?: string; cloneFromLayoutId?: string }) =>
    request<LayoutSnapshot>('/layouts', { method: 'POST', body: JSON.stringify(input) }),

  renameLayout: (id: string, name: string) =>
    request<{ layout: Layout }>(`/layouts/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),

  deleteLayout: (id: string) => request<void>(`/layouts/${id}`, { method: 'DELETE' }),

  saveLayout: (
    id: string,
    payload: { objects: LayoutObject[]; locations: Location[]; warehouse?: Partial<Warehouse> },
  ) => request<SaveResult>(`/layouts/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  listProducts: (warehouseId: string) => request<{ products: Product[] }>(`/warehouses/${warehouseId}/products`),

  exportUrl: (layoutId: string, type: 'locations' | 'objects' | 'json') =>
    `${BASE}/layouts/${layoutId}/export?type=${type}`,
};
