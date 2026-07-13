import { calculateResponsivePageSize, recalculatePageForPageSize } from './responsive-page-size';

describe('responsive page size helpers', () => {
  it('returns two rows for one, two, three and four columns', () => {
    const base = {
      minItemWidth: 320,
      gap: 16,
      rows: 2
    };

    expect(calculateResponsivePageSize({ ...base, containerWidth: 319 })).toBe(2);
    expect(calculateResponsivePageSize({ ...base, containerWidth: 656 })).toBe(4);
    expect(calculateResponsivePageSize({ ...base, containerWidth: 992 })).toBe(6);
    expect(calculateResponsivePageSize({ ...base, containerWidth: 1328 })).toBe(8);
  });

  it('keeps growing beyond four columns', () => {
    expect(calculateResponsivePageSize({
      containerWidth: 1664,
      minItemWidth: 320,
      gap: 16,
      rows: 2
    })).toBe(10);
  });

  it('keeps the first visible item roughly stable when page size changes', () => {
    expect(recalculatePageForPageSize(3, 8, 12)).toBe(2);
    expect(recalculatePageForPageSize(4, 6, 4)).toBe(5);
  });
});
