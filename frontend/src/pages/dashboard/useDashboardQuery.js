import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One dashboard request, with its own loading, error and retry.
 *
 * The dashboard reads a dozen endpoints and the panels must fail
 * independently: a caller without `payroll:read` gets a 403 on three of them
 * as a matter of course, and that has to leave the other nine alone. Each
 * panel therefore owns a call rather than the page owning one big fetch.
 *
 * `enabled` is how a panel the caller may not see is skipped -- no request is
 * made at all, so an expected 403 never reaches the network tab.
 *
 * Responses are sequenced: when the month filter changes twice quickly, a slow
 * first reply must not overwrite the second. Only the newest request may write.
 *
 * @param {Function} fetcher  Returns a promise. Re-run when `deps` change.
 * @param {Array}    deps     What the request depends on.
 * @param {object}   options  `{ enabled }`.
 */
const useDashboardQuery = (fetcher, deps = [], { enabled = true } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  const requestId = useRef(0);
  // Held in a ref so a fetcher defined inline in the component body does not
  // re-trigger the effect on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const id = requestId.current + 1;
    requestId.current = id;

    setLoading(true);
    setError(null);

    Promise.resolve()
      .then(() => fetcherRef.current())
      .then((result) => {
        if (requestId.current !== id) return;
        setData(result ?? null);
      })
      .catch((rejection) => {
        if (requestId.current !== id) return;
        setData(null);
        setError(rejection?.message ?? 'The request failed');
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    run();
  }, [run]);

  return { data, loading, error, reload: run };
};

export default useDashboardQuery;
