import { useEffect, useRef, useState } from "react";
import type { Filters, StatusFilter } from "./types";
import { useTaskSearch } from "./useTaskSearch";
import { pageOf, readQuery, writeQuery } from "./query";

/** 把越界页码钳制到 1..pages 的纯函数版本，供成功结果判定使用。 */
function clampPage(page: number, pages: number): number {
  return Math.min(pages, Math.max(1, page));
}

export default function App() {
  // 首次渲染即从 URL 恢复；尚未提交的输入只存在于 draft，不写 URL。
  const initial = useRef<Filters>(readQuery(window.location.search)).current;

  const [draft, setDraft] = useState(initial.q);
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState<StatusFilter>(initial.status);
  const [page, setPage] = useState(initial.page);

  const { tasks, loading, error } = useTaskSearch(q, status);
  const view = pageOf(tasks, page);
  const viewCurrent = view.current;
  const viewPages = view.pages;

  // 本组件读到过的「上一次查询成功结果」，null 表示还没有任何成功结果。
  // 它是钳制判断的唯一依据，避免被加载前空列表或失败状态误导。
  const shownResultRef = useRef<{ tasks: typeof tasks; error: string } | null>(
    null,
  );

  useEffect(() => {
    // tasks/error 是本次查询的结果：loading 结束后它们必然已经提交，
    // 所以此刻读取到的就是当前查询的结果，不存在读到过期值的问题。
    if (loading) return;
    const isFresh =
      shownResultRef.current !== null && shownResultRef.current.tasks !== tasks;
    shownResultRef.current = { tasks, error };
    // 只有「当前查询成功返回的新结果」才允许钳制越界页码。
    // 初始状态、加载中、失败，或沿用上一次结果时都不钳制：
    // 否则加载前的空列表会把恢复出来的页码错误地改成 1。
    if (!isFresh || error) return;
    const clamped = clampPage(page, viewPages);
    if (clamped === page) return;
    setPage(clamped);
    // 规范越界页码使用 replace，不新增历史项。
    writeQuery({ q, status, page: clamped }, "replace");
  }, [loading, tasks, error, page, viewPages, q, status]);

  // 浏览器前进/后退：恢复输入、筛选、页码，并发起对应查询。
  useEffect(() => {
    function onPopState() {
      const next = readQuery(window.location.search);
      setDraft(next.q);
      setQ(next.q);
      setStatus(next.status);
      setPage(next.page);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function search(e: React.FormEvent) {
    e.preventDefault();
    const nextQ = draft.trim();
    setQ(nextQ);
    setPage(1);
    // 提交搜索：页码回 1，replace 当前历史项。
    writeQuery({ q: nextQ, status, page: 1 }, "replace");
  }

  function changeStatus(next: StatusFilter) {
    setStatus(next);
    setPage(1);
    // 筛选变化：页码回 1，push 历史项。
    writeQuery({ q, status: next, page: 1 }, "push");
  }

  function goToPage(nextPage: number) {
    const target = clampPage(nextPage, viewPages);
    if (target === viewCurrent) return;
    setPage(target);
    // 翻页：push 历史项。
    writeQuery({ q, status, page: target }, "push");
  }

  return (
    <>
      <header>
        <div className="brand">
          TaskBoard<span>任务看板</span>
        </div>
      </header>
      <main>
        <h1>项目任务</h1>
        <p className="subtitle">搜索、筛选和查看团队任务。</p>
        <form className="toolbar" onSubmit={search}>
          <label className="search">
            搜索任务
            <input
              placeholder="搜索任务标题"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <label>
            状态
            <select
              value={status}
              onChange={(e) => changeStatus(e.target.value as StatusFilter)}
            >
              <option value="ALL">全部状态</option>
              <option value="TODO">待办</option>
              <option value="DOING">进行中</option>
              <option value="DONE">已完成</option>
            </select>
          </label>
          <button className="primary">查询</button>
        </form>
        <p className="count muted" aria-live="polite">
          {tasks.length}项任务
        </p>
        <section className="panel" aria-label="任务列表" aria-busy={loading}>
          <div className="table-row table-head">
            <span>任务</span>
            <span>状态</span>
            <span className="owner">负责人</span>
          </div>
          {error ? (
            <div role="alert" className="error">
              {error}
            </div>
          ) : loading ? (
            <div role="status" className="state">
              正在查询…
            </div>
          ) : tasks.length === 0 ? (
            <div className="state">没有匹配的任务</div>
          ) : (
            view.items.map((t) => (
              <div className="table-row" key={t.id}>
                <div>
                  <div className="task-title">{t.title}</div>
                  <div className="task-detail">{t.description}</div>
                </div>
                <div>
                  <span className={"tag " + t.status}>{t.status}</span>
                </div>
                <span className="owner">{t.owner}</span>
              </div>
            ))
          )}
        </section>
        <nav className="pager" aria-label="分页">
          <button
            disabled={loading || viewCurrent === 1}
            onClick={() => goToPage(viewCurrent - 1)}
          >
            上一页
          </button>
          <span>
            第{viewCurrent}页 共{viewPages}页
          </span>
          <button
            disabled={loading || viewCurrent === viewPages}
            onClick={() => goToPage(viewCurrent + 1)}
          >
            下一页
          </button>
        </nav>
      </main>
    </>
  );
}
