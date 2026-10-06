import { useEffect, useRef, useState } from "react";
import { searchTasks } from "./api";
import type { Task, StatusFilter } from "./types";

/**
 * T1：异步竞态修复。
 *
 * 竞态来源：查询条件每变化一次就发起一个新请求，而较早的请求不会自动失效。
 * 「登录」模拟 450ms、其他查询 200ms，先查「登录」再立刻查「接口」时，
 * 较早的请求会晚于较新的请求结束，于是用旧结果覆盖新结果；同理，较早请求
 * 的失败会污染新请求的 error，较早请求的结束会提前关闭新查询的 loading。
 *
 * 方案：每次查询分配一个自增序号，并配合 AbortController。
 * 只有「序号仍是当前最新序号」的回调才能提交结果、错误和结束状态；
 * 过期请求即使已经成功或失败，其回调也会被直接忽略。
 * 组件离开（卸载或条件变化）时使本次请求失效并取消，不再提交任何状态。
 */
export function useTaskSearch(q: string, status: StatusFilter) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 最新一次查询的序号：只有它有权提交结果/错误/结束状态。
  const requestIdRef = useRef(0);
  // 当前进行中请求的控制器：用于取消已经过期的请求。
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    // 本次查询是否仍是当前有效查询（没有被更新的查询或卸载取代）。
    const isCurrent = () => requestIdRef.current === requestId;

    // 新查询开始：上一次查询立即失效，并取消其未完成的请求。
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError("");

    // 让 token 指向本次请求的 promise：即使请求被取消、其结果不再被采纳，
    // 它的 rejection 也已经在本链上被消费，不会变成未处理的 Promise 拒绝。
    searchTasks(q, status, controller.signal)
      .then((result) => {
        // 较早的成功不得覆盖新结果。
        if (!isCurrent()) return;
        setTasks(result);
      })
      .catch((e: unknown) => {
        // 较早的失败不得污染新错误；主动取消不是业务错误。
        if (!isCurrent()) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        // 较早的结束不得提前关闭新查询的 loading。
        if (!isCurrent()) return;
        setLoading(false);
      });

    // 组件离开或条件变化时清理本次请求生命周期。
    return () => {
      if (requestIdRef.current === requestId) requestIdRef.current += 1;
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [q, status]);

  return { tasks, loading, error };
}
