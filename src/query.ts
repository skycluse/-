import type { Filters, StatusFilter } from "./types";

const STATUS_VALUES: readonly StatusFilter[] = [
  "ALL",
  "TODO",
  "DOING",
  "DONE",
];

/** 缺省/未知状态一律回落到 ALL；只接受四个合法值。 */
function parseStatus(raw: string | null): StatusFilter {
  return STATUS_VALUES.includes(raw as StatusFilter)
    ? (raw as StatusFilter)
    : "ALL";
}

/**
 * 缺省、非正安全整数、非整数或非数值页码一律为 1。
 * 用正则严格校验十进制整数，避免 Number() 把 ""、"1e2"、"0x2"、" 2 " 等
 * 当成合法页码，也避免超出安全整数范围后失去精度。
 */
function parsePage(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) return 1;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) return 1;
  return n;
}

/**
 * T2：从 URL 查询串恢复已提交的搜索词、筛选与页码；缺省值按题目规范回落。
 * 只读取 q/status/page，其余参数由写回时原样保留。
 */
export function readQuery(search: string): Filters {
  const params = new URLSearchParams(search);
  return {
    q: params.get("q") ?? "",
    status: parseStatus(params.get("status")),
    page: parsePage(params.get("page")),
  };
}

/**
 * T2：把查询状态写回地址栏。
 * 默认参数省略（空搜索词、ALL、第 1 页不写入 URL）；
 * 编码交给 URLSearchParams，中文、空格与 & 都不会被破坏；
 * 无关参数与 hash 原样保留。
 */
export function writeQuery(filters: Filters, mode: "push" | "replace"): void {
  const params = new URLSearchParams(window.location.search);
  if (filters.q === "") params.delete("q");
  else params.set("q", filters.q);
  if (filters.status === "ALL") params.delete("status");
  else params.set("status", filters.status);
  if (filters.page === 1) params.delete("page");
  else params.set("page", String(filters.page));

  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function pageOf<T>(items: T[], page: number, size = 6) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(pages, Math.max(1, page));
  return {
    items: items.slice((current - 1) * size, current * size),
    current,
    pages,
  };
}
