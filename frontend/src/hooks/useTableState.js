import { useCallback, useMemo, useState } from 'react';

/**
 * The query state every server-paginated list screen carries: page, page size,
 * sort, search and filters.
 *
 * Each list was repeating the same four `useState` calls plus the same
 * "reset to page 1 when a filter changes" rule -- and forgetting that rule is
 * how a screen ends up showing page 4 of a result set that now has one page,
 * which reads as an empty table.
 *
 * `params` is the object to hand the service. It is memoised so it can be a
 * dependency of the fetch effect without re-firing on every render.
 */
const useTableState = ({
  initialFilters = {},
  initialSort = null,
  initialLimit = 25,
  initialSortOrder = 'desc',
} = {}) => {
  const [page, setPage] = useState(1);
  const [limit, setLimitState] = useState(initialLimit);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState(initialSort);
  const [sortOrder, setSortOrder] = useState(initialSortOrder);
  const [search, setSearchState] = useState('');
  const [filters, setFiltersState] = useState(initialFilters);

  /** Any change to what is being asked for sends the view back to page 1. */
  const setFilter = useCallback((field, value) => {
    setFiltersState((previous) => ({ ...previous, [field]: value }));
    setPage(1);
  }, []);

  const setFilters = useCallback((next) => {
    setFiltersState(next);
    setPage(1);
  }, []);

  const setSearch = useCallback((value) => {
    setSearchState(value);
    setPage(1);
  }, []);

  const setLimit = useCallback((value) => {
    setLimitState(value);
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(initialFilters);
    setSearchState('');
    setPage(1);
    // `initialFilters` is a literal at most call sites, so a new object every
    // render. Serialising it keeps this callback stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialFilters)]);

  /** Click a column: ascending first, then descending, then back to default. */
  const toggleSort = useCallback(
    (field) => {
      if (sortBy !== field) {
        setSortBy(field);
        setSortOrder('asc');
        return;
      }

      if (sortOrder === 'asc') {
        setSortOrder('desc');
        return;
      }

      setSortBy(initialSort);
      setSortOrder(initialSortOrder);
    },
    [sortBy, sortOrder, initialSort, initialSortOrder],
  );

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((value) => value !== '' && value !== null && value !== undefined).length +
      (search ? 1 : 0),
    [filters, search],
  );

  const params = useMemo(
    () => ({
      ...filters,
      ...(search ? { search } : {}),
      ...(sortBy ? { sortBy, sortOrder } : {}),
      page,
      limit,
    }),
    [filters, search, sortBy, sortOrder, page, limit],
  );

  return {
    page,
    limit,
    total,
    sortBy,
    sortOrder,
    search,
    filters,
    params,
    activeFilterCount,

    setPage,
    setLimit,
    setTotal,
    setSearch,
    setFilter,
    setFilters,
    resetFilters,
    toggleSort,
  };
};

export default useTableState;
