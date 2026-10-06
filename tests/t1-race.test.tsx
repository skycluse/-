import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import App from "../src/App";
import { searchTasks } from "../src/api";

/**
 * T3：T1 异步竞态场景。
 *
 * 异步顺序全部用受控 Promise 精确编排（以固定 sleep 作主要断言），
 * 因此这些用例既确定又可离线重复执行。
 */

// 用受控的 deferred 替换 searchTasks 的实现（不是断言里的期望值），
// 让「较早请求晚于较新请求结束」这种时序可以稳定复现。
vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>();
  return { ...actual, searchTasks: vi.fn() };
});

const mockedSearch = vi.mocked(searchTasks);

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  let reject!: (reason?: unknown) => void;
  // 注意：promise 由「本 mock」创建，而不是像 api 那样由请求方通过回调产生。
  // 因此它的 rejection 只有挂在组件链上时才存在处理者；如果实现因请求已被取消
  // 而没有调用 .catch，这个 promise 就会成为未处理的拒绝。
  // 造这种「旧请求在已被取代之后才失败」的场景时，必须在测试里自己兜底消费，
  // 否则报错来源是 mock 自身，与 useTaskSearch 无关。
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 预置一批 deferred，按调用顺序返回。 */
function queue(...items: Deferred[]) {
  let index = 0;
  mockedSearch.mockImplementation((_q, _status, signal) => {
    const d = items[index];
    index += 1;
    if (!d) throw new Error(`unexpected extra searchTasks call #${index}`);
    if (signal?.aborted) {
      // 模拟真实 api：已经取消的请求直接拒绝（与既有取消测试一致）。
      return Promise.reject(
        new DOMException("已取消", "AbortError"),
      ) as Promise<never>;
    }
    // 兜底消费：请求被取消后实现不再采纳结果，这里避免 mock 自身产生噪声。
    d.promise.catch(() => {});
    return d.promise as Promise<never>;
  });
}

const loginTasks = [
  { id: 1, title: "登录功能开发", description: "d", status: "TODO", owner: "张三" },
  { id: 2, title: "登录输入校验", description: "d", status: "TODO", owner: "张三" },
];
const apiTasks = [
  { id: 3, title: "任务列表接口对接", description: "d", status: "DOING", owner: "李四" },
];

/** 渲染后提交一次搜索，触发第二次查询。 */
async function submitSearch(text: string) {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  await user.clear(screen.getByPlaceholderText("搜索任务标题"));
  await user.type(screen.getByPlaceholderText("搜索任务标题"), text);
  await user.click(screen.getByRole("button", { name: "查询" }));
}

const flush = () => act(async () => {});

beforeEach(() => {
  mockedSearch.mockReset();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("T1 较早成功不得覆盖新结果", () => {
  it("较慢的旧查询晚于新查询结束，列表仍是新查询结果", async () => {
    const old = deferred();
    const fresh = deferred();
    queue(old, fresh);

    render(<App />);
    await submitSearch("接口");

    // 让新查询的加载状态生效。
    await flush();
    await act(async () => {
      fresh.resolve(apiTasks);
    });
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();

    // 较早的「登录」查询此刻才成功，不得覆盖新结果。
    await act(async () => {
      old.resolve(loginTasks);
    });
    expect(screen.queryByText("登录功能开发")).not.toBeInTheDocument();
    expect(screen.getByText("任务列表接口对接")).toBeInTheDocument();
  });
});

describe("T1 较早失败不得污染新错误", () => {
  it("新查询成功时，较早请求的失败不会显示错误", async () => {
    const old = deferred();
    const fresh = deferred();
    queue(old, fresh);

    render(<App />);
    await submitSearch("接口");
    await flush();

    await act(async () => {
      fresh.resolve(apiTasks);
    });
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();

    // 较早请求这时才失败。它已被新查询取代，其结果不得被采纳。
    await act(async () => {
      old.reject(new Error("模拟查询失败"));
    });
    // 归因用：若这里是 true，说明未处理拒绝来自 mock 自身创建的 promise，
    // 与 useTaskSearch 无关（mock 没把它挂到组件链上）。
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("任务列表接口对接")).toBeInTheDocument();
  });

  it("新查询自身的失败仍要显示错误", async () => {
    const old = deferred();
    const fresh = deferred();
    queue(old, fresh);

    render(<App />);
    await submitSearch("失败");

    await act(async () => {
      fresh.reject(new Error("模拟查询失败"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("模拟查询失败");
  });
});

describe("T1 较早结束不得提前关闭新 loading", () => {
  it("旧查询先结束时页面仍处于加载中", async () => {
    const old = deferred();
    const fresh = deferred();
    queue(old, fresh);

    render(<App />);
    await submitSearch("接口");
    expect(screen.getByText("正在查询…")).toBeInTheDocument();

    await act(async () => {
      old.resolve(loginTasks);
    });
    expect(screen.getByText("正在查询…")).toBeInTheDocument();

    await act(async () => {
      fresh.resolve(apiTasks);
    });
    expect(screen.queryByText("正在查询…")).not.toBeInTheDocument();
    expect(screen.getByText("任务列表接口对接")).toBeInTheDocument();
  });
});

describe("T1 成功、空结果、失败与重试都可用", () => {
  it("空结果显示空态且保持第1页共1页", async () => {
    const only = deferred();
    queue(only);

    render(<App />);
    await act(async () => {
      only.resolve([]);
    });
    expect(await screen.findByText("没有匹配的任务")).toBeInTheDocument();
    expect(screen.getByText("第1页 共1页")).toBeInTheDocument();
  });

  it("失败后重试同一查询可以恢复", async () => {
    const first = deferred();
    const second = deferred();
    queue(first, second);

    render(<App />);
    await act(async () => {
      first.reject(new Error("模拟查询失败"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("模拟查询失败");

    // 重试：再次提交同样的查询词，应当重新发起请求并成功。
    await submitSearch("接口");
    await act(async () => {
      second.resolve(apiTasks);
    });
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("T1 组件离开时清理请求生命周期", () => {
  it("卸载后不再提交任何状态（无警告、无异常）", async () => {
    const pending = deferred();
    queue(pending);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<App />);
    unmount();

    // 卸载后即使请求成功返回，也不得再往已卸载的组件提交状态。
    await act(async () => {
      pending.resolve(apiTasks);
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
