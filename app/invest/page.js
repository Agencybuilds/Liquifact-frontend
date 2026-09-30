"tuse client";

import { Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import ErrorBanner from "@/components/ErrorBanner";
import InvoiceListSkeleton from "@/components/InvoiceListSkeleton";
import InvoiceSearch from "@/components/InvoiceSearch";
import InvoiceFilters, {
  DEFAULT_FILTERS,
  StatusLegendFilter,
  hasAnyActiveFilters,
  parseSortState,
} from "@/components/InvoiceFilters";
import BulkActionsToolbar from "@/components/BulkActionsToolbar";
import ConfirmDialog from "@/components/ConfirmDialog";
import NavMenu from "@/components/NavMenu";
import WatchlistSection from "@/components/WatchlistSection";
import { useWatchlist } from "@/lib/hooks/useWatchlist";
import { copy } from "../copy/en";
// Mock data is sourced exclusively from lib.js (single source of truth until the API client lands).
import { loadMockInvoices } from "./lib";
import { exportAsCSV, exportAsJSON } from "@/utils/export";
import DensityToggle from "@/components/DensityToggle";
import { useDensity } from "@/lib/hooks/useDensity";
import { INVOICE_STATUSES } from "@/lib/types/invoice";
import useBulkSelection from "@/lib/hooks/useBulkSelection";
import { useSettingsAnnouncer } from "@/components/useSettingsAnnouncer";

import { ToastContext } from "@/components/ToastProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import MarketplaceErrorBoundary from "@/components/MarketplaceErrorBoundary";
import { reportError } from "@/lib/observability/reportError";
import { getInvoiceDetailHref, sanitizeMarketplaceSearchParams } from "@/lib/marketplaceRoute";

export const PAGE_SIZE = 10;
export const SEARCH_DEBOUNCE_MS = 300;
export const URL_SYNC_DEBOUNCE_MS = 200;

const VALID_CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "CHF"]);
const VALID_SORT_COLUMNS = new Set(["amount", "yield", "maturity"]);
const VALID_SORT_DIRS = new Set(["asc", "desc"]);
const VALID_STATUSES = new Set(Object.values(INVOICE_STATUSES));

function isValidISODate(str) {
  if (typeof str !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  // new Date("2026-09-99") rolls over in some engines, so verify round-trip.
  return d.toISOString().slice(0, 10) === str;
}

function isValidYieldString(value) {
  if (typeof value !== "string" || value === "") return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

/**
 * Parse a shareable URL query into validated marketplace filters and search.
 * Unknown/invalid params are ignored and fall back to defaults.
 *
 * @param {URLSearchParams} searchParams
 * @param {object} [defaults=DEFAULT_FILTERS]
 * @returns {{filters: object, searchQuery: string}}
 */
export function parseFiltersFromSearchParams(searchParams, defaults = DEFAULT_FILTERS) {
  const params = sanitizeMarketplaceSearchParams(searchParams ?? new URLSearchParams());

  const rawSort = params.get("sort") ?? "";
  const rawSortDir = params.get("sortDir") ?? "";
  let sort = "";
  let sortDir = "desc";
  const compound = rawSort.match(/^(amount|yield|maturity)_(asc|desc)$/);
  if (compound) {
    sort = compound[1];
    sortDir = compound[2];
  } else if (VALID_SORT_COLUMNS.has(rawSort)) {
    sort = rawSort;
  }
  if (VALID_SORT_DIRS.has(rawSortDir)) {
    sortDir = rawSortDir;
  }

  const currency = VALID_CURRENCIES.has(params.get("currency")) ? params.get("currency") : "";
  const yieldMin = isValidYieldString(params.get("yieldMin")) ? params.get("yieldMin") : "";
  const yieldMax = isValidYieldString(params.get("yieldMax")) ? params.get("yieldMax") : "";
  const maturityFrom = isValidISODate(params.get("maturityFrom")) ? params.get("maturityFrom") : "";
  const maturityTo = isValidISODate(params.get("maturityTo")) ? params.get("maturityTo") : "";

  const statuses = (params.get("statuses") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => VALID_STATUSES.has(s));

  const searchQuery = (params.get("q") ?? "").trim();

  return {
    filters: {
      ...defaults,
      currency,
      yieldMin,
      yieldMax,
      maturityFrom,
      maturityTo,
      sort,
      sortDir,
      statuses,
    },
    searchQuery,
  };
}

/**
 * Build a shareable URLSearchParams object from the current filters and search.
 * Empty/default values are omitted so the URL stays clean.
 *
 * @param {object} filters
 * @param {string} [searchQuery=""]
 * @returns {URLSearchParams}
 */
export function buildSearchParams(filters, searchQuery = "") {
  const params = new URLSearchParams();
  const trimmedSearch = (searchQuery ?? "").trim();
  if (trimmedSearch) params.set("q", trimmedSearch);

  if (filters.currency) params.set("currency", filters.currency);
  if (filters.yieldMin !== "") params.set("yieldMin", filters.yieldMin);
  if (filters.yieldMax !== "") params.set("yieldMax", filters.yieldMax);
  if (filters.maturityFrom) params.set("maturityFrom", filters.maturityFrom);
  if (filters.maturityTo) params.set("maturityTo", filters.maturityTo);

  if (filters.sort) {
    params.set("sort", filters.sort);
    params.set("sortDir", filters.sortDir || "desc");
  }

  if (Array.isArray(filters.statuses) && filters.statuses.length > 0) {
    params.set("statuses", filters.statuses.filter((status) => VALID_STATUSES.has(status)).join(","));
  }

  return params;
}

// Delay before an async load/retry outcome reaches the polite live region.
export const ANNOUNCE_DEBOUNCE_MS = 200;

export function getInvoiceLoadAnnouncement(invoices, { filterActive, filteredCount } = {}) {
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return copy.invest.announceNoInvoices;
  }

  if (filterActive) {
    if (filteredCount === 0) {
      return copy.invest.announceNoMatch;
    }
    return copy.invest.announceFilteredCount
      .replace("{matched}", filteredCount)
      .replace("{total}", invoices.length);
  }

  return copy.invest.announceInvoicesLoaded.replace("{count}", invoices.length);
}

export function getPaginationAnnouncement(shown, total) {
  if (total === 0) return copy.invest.announceNoInvoices;
  return copy.invest.announceShowing.replace("{shown}", shown).replace("{total}", total);
}

export function toExportRecord(inv) {
  return {
    id: inv.id,
    issuer: inv.issuer,
    amount: inv.amount,
    currency: inv.currency,
    dueDate: inv.dueDate,
    yield: inv.yield,
    status: inv.status,
  };
}

function parseAmount(str) {
  return parseFloat(String(str).replace(/,/g, "")) || 0;
}

function parseYield(str) {
  return parseFloat(String(str).replace(/%/g, "")) || 0;
}

export function applySortToList(list, filters) {
  if (!Array.isArray(list) || list.length === 0) return list;

  const { column, dir } = parseSortState(filters);
  if (!column) return list;

  const multiplier = dir === "asc" ? 1 : -1;

  return [...list].sort((a, b) => {
    let diff = 0;
    if (column === "amount") {
      diff = parseAmount(a.amount) - parseAmount(b.amount);
    } else if (column === "yield") {
      diff = parseYield(a.yield) - parseYield(b.yield);
    } else if (column === "maturity") {
      diff = new Date(a.dueDate) - new Date(b.dueDate);
    }
    return multiplier * diff;
  });
}

function triggerDownload(text, filename, mimeType = "application/json") {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Downloads are only supported in browser environments");
  }
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function defaultBulkExport(selectedInvoices) {
  const safeRecords = Array.isArray(selectedInvoices) ? selectedInvoices.map(toExportRecord) : [];
  if (
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof document === "undefined"
  ) {
    return { count: safeRecords.length };
  }
  const json = JSON.stringify(
    { exportedAt: new Date().toISOString(), invoices: safeRecords },
    null,
    2
  );
  triggerDownload(json, `liquifact-invoices-${Date.now()}.json`);
  return { count: safeRecords.length };
}

function useSafeRouter() {
  try {
    return useRouter();
  } catch {
    return { replace: () => {}, push: () => {}, prefetch: () => {} };
  }
}

function useSafeSearchParams() {
  try {
    return useSearchParams();
  } catch {
    return new URLSearchParams();
  }
}

function normalizeInvoicePageResult(payload) {
  if (Array.isArray(payload)) {
    return { items: payload, nextCursor: null, hasMore: false, invalidCursor: false };
  }

  const result = payload ?? {};
  const items = Array.isArray(result.items) ? result.items : [];
  const nextCursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
  const hasMore = Boolean(result.hasMore) || nextCursor !== null;

  return {
    items,
    nextCursor,
    hasMore,
    invalidCursor: Boolean(result.invalidCursor),
  };
}

function mergeInvoicePages(current = [], incoming = []) {
  const merged = new Map();

  for (const invoice of current) {
    if (invoice && invoice.id) merged.set(invoice.id, invoice);
  }

  for (const invoice of incoming) {
    if (invoice && invoice.id) merged.set(invoice.id, invoice);
  }

  return Array.from(merged.values());
}

export function InvestMarketplace({
  loadInvoices = loadMockInvoices,
  onBulkDelete = async () => {},
  onBulkExport = defaultBulkExport,
}) {
  const router = useSafeRouter();
  const searchParams = useSafeSearchParams();
  const searchParamsValue = searchParams ?? new URLSearchParams();
  const searchParamsString = searchParamsValue.toString();

  const initialUrlState = useMemo(
    () => parseFiltersFromSearchParams(searchParamsValue, DEFAULT_FILTERS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [density, setDensity] = useDensity();
  const { watchlists } = useWatchlist();

  const [pendingDeleteIds, setPendingDeleteIds] = useState(null);
  const [bulkRunning, setBulkRunning] = useState({ export: false, delete: false });
  const toastApi = useContext(ToastContext);
  const bulkLabels = useMemo(() => copy.invest?.bulkActions || {}, []);

  const [invoices, setInvoices] = useState(null); // null = loading
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursorError, setCursorError] = useState("");
  const [pageLoading, setPageLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Monotoonic request token: only the latest in-flight load may commit state.
  // Prevents stale/out-of-order responses from clobbering newer results.
  const loadRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [loadError, setLoadError] = useState("");
  const [filters, setFilters] = useState(initialUrlState.filters);
  const [debouncedSearch, setDebouncedSearch] = useState(initialUrlState.searchQuery);

  const committedSearchRef = useRef(
    buildSearchParams(initialUrlState.filters, initialUrlState.searchQuery).toString()
  );
  const urlUpdateTimerRef = useRef(null);

  /**
   * When the URL query changes (back/forward, shared link), parse and apply
   * validated filters. committedSearchRef prevents overwriting our own writes.
   */
  useEffect(() => {
    if (searchParamsString === committedSearchRef.current) return;
    const parsed = parseFiltersFromSearchParams(searchParamsValue, DEFAULT_FILTERS);
    setFilters(parsed.filters);
    setSearchQuery(parsed.searchQuery);
    setDebouncedSearch(parsed.searchQuery);
    committedSearchRef.current = searchParamsString;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsString]);
}
