export const PANEL_PAGE_SIZE = 6;

export function pageCountFor(itemCount: number, pageSize = PANEL_PAGE_SIZE): number {
  if (itemCount <= 0) return 1;
  return Math.ceil(itemCount / pageSize);
}

export function clampPage(page: number, itemCount: number, pageSize = PANEL_PAGE_SIZE): number {
  const last = pageCountFor(itemCount, pageSize);
  if (page < 1) return 1;
  return page > last ? last : page;
}

export function pageSlice<T>(items: readonly T[], page: number, pageSize = PANEL_PAGE_SIZE): readonly T[] {
  const current = clampPage(page, items.length, pageSize);
  const start = (current - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
