export interface ResponsivePageSizeOptions {
  containerWidth: number;
  minItemWidth: number;
  gap?: number;
  rows?: number;
  minColumns?: number;
  maxColumns?: number;
  fallbackColumns?: number;
}

const sanitizePositiveInteger = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value) || !value) {
    return fallback;
  }

  return Math.max(Math.floor(value), 1);
};

const clamp = (value: number, min: number, max?: number): number => {
  const clampedToMin = Math.max(value, min);
  return typeof max === 'number' ? Math.min(clampedToMin, max) : clampedToMin;
};

export const calculateResponsivePageSize = ({
  containerWidth,
  minItemWidth,
  gap = 0,
  rows = 2,
  minColumns = 1,
  maxColumns,
  fallbackColumns = 1
}: ResponsivePageSizeOptions): number => {
  const safeRows = sanitizePositiveInteger(rows, 2);
  const safeMinColumns = sanitizePositiveInteger(minColumns, 1);
  const safeFallbackColumns = sanitizePositiveInteger(fallbackColumns, safeMinColumns);
  const safeMaxColumns = Number.isFinite(maxColumns)
    ? sanitizePositiveInteger(maxColumns, safeMinColumns)
    : undefined;
  const safeMinItemWidth = Number.isFinite(minItemWidth) && minItemWidth > 0 ? minItemWidth : 1;
  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0;

  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return clamp(safeFallbackColumns, safeMinColumns, safeMaxColumns) * safeRows;
  }

  const columns = Math.floor((containerWidth + safeGap) / (safeMinItemWidth + safeGap));
  return clamp(columns, safeMinColumns, safeMaxColumns) * safeRows;
};

export const recalculatePageForPageSize = (
  currentPage: number,
  currentPageSize: number,
  nextPageSize: number
): number => {
  const safeCurrentPage = sanitizePositiveInteger(currentPage, 1);
  const safeCurrentPageSize = sanitizePositiveInteger(currentPageSize, 1);
  const safeNextPageSize = sanitizePositiveInteger(nextPageSize, 1);
  const currentFirstIndex = (safeCurrentPage - 1) * safeCurrentPageSize;

  return Math.floor(currentFirstIndex / safeNextPageSize) + 1;
};
