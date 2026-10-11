"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Loads data on mount (and when `key` changes); `reload` refetches without clearing data. */
export function useApi<T>(load: () => Promise<T>, key = "") {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const gen = useRef(0);

  const reload = useCallback(async () => {
    const id = ++gen.current;
    setLoading(true);
    try {
      const result = await loadRef.current();
      if (id === gen.current) {
        setData(result);
        setError(null);
      }
      return result;
    } catch (err) {
      if (id === gen.current) setError(err);
      return undefined;
    } finally {
      if (id === gen.current) setLoading(false);
    }
  }, []);

  // Refetch when the key changes (e.g. a different id).
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the trigger
  useEffect(() => {
    void reload();
  }, [key, reload]);

  return { data, error, loading, reload, setData };
}
