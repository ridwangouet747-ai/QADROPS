"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class RequestError extends Error {
  constructor(public status: number | null, message?: string) { super(message); }
}

type Page<T, S> = { items?: T[]; nextCursor?: string | null; summary?: S } & Record<string, unknown>;

/** Valeur stabilisée après une pause de frappe, pour ne pas interroger le serveur à chaque touche. */
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Liste paginée côté serveur par curseur : la première page se recharge à chaque changement de
 * filtre (la requête précédente est annulée), « charger la suite » ajoute la page suivante.
 */
export function usePagedList<T, S>(url: string, params: Record<string, string>) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "")).toString();
  const [items, setItems] = useState<T[]>([]);
  const [summary, setSummary] = useState<S | null>(null);
  const [body, setBody] = useState<Page<T, S> | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<RequestError | null>(null);
  const controller = useRef<AbortController | null>(null);

  const fetchPage = useCallback(async (cursor: string | null, signal: AbortSignal) => {
    const search = new URLSearchParams(query);
    if (cursor) search.set("cursor", cursor);
    let response: Response;
    try { response = await fetch(`${url}?${search}`, { cache: "no-store", signal }); } catch (caught) {
      if (signal.aborted) throw caught;
      throw new RequestError(null);
    }
    const page = await response.json().catch(() => ({})) as Page<T, S> & { error?: string };
    if (!response.ok) throw new RequestError(response.status, page.error);
    return page;
  }, [url, query]);

  const reload = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true); setError(null);
    try {
      const page = await fetchPage(null, current.signal);
      setItems(page.items ?? []); setSummary(page.summary ?? null); setBody(page); setNextCursor(page.nextCursor ?? null);
    } catch (caught) {
      if (current.signal.aborted) return;
      setItems([]); setNextCursor(null);
      setError(caught instanceof RequestError ? caught : new RequestError(null));
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const signal = controller.current?.signal ?? new AbortController().signal;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextCursor, signal);
      setItems((current) => [...current, ...(page.items ?? [])]); setNextCursor(page.nextCursor ?? null);
    } catch (caught) {
      if (!signal.aborted) setError(caught instanceof RequestError ? caught : new RequestError(null));
    } finally { setLoadingMore(false); }
  }, [fetchPage, nextCursor, loadingMore]);

  useEffect(() => {
    void reload();
    return () => controller.current?.abort();
  }, [reload]);

  return { items, summary, body, nextCursor, loading, loadingMore, error, reload, loadMore };
}
