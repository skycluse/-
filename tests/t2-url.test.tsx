import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { readQuery, writeQuery } from "../src/query";
import type { Filters } from "../src/types";

/**
 * T3：T2 URL 状态同步场景。
 *
 * 这里使用真实的 api（真实定时器 / jsdom 环境），因此与浏览器行为一致：
 * 恢复、写入、前进后退、参数规范与结果钳制都在真实异步流程下验证。
 */

const query = () => screen.getByPlaceholderText("搜索任务标题") as HTMLInputElement;
const statusSelect = () => screen.getByLabelText("状态") as HTMLSelectElement;
const pagerText = () => screen.getByText(/第\d+页 共\d+页/).textContent;

async function submit(text: string) {
  const user = userEvent.setup();
  if (text !== "") await user.type(query(), text);
  await user.click(screen.getByRole("button", { name: "查询" }));
}

/** 等到列表结果渲染完成（loading 结束且不在加载中）。 */
async function settled() {
  await waitFor(() => {
    expect(screen.queryByText("正在查询…")).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("T2 URL 首次恢复", () => {
  it("从 URL 恢复已提交搜索词、筛选、页码，并同步输入框", async () => {
    window.history.replaceState(null, "", "/?q=接口&status=DOING&page=2");

    render(<App />);
    await settled();

    // 输入框与 URL 的已提交搜索词同步。
    expect(query().value).toBe("接口");
    expect(statusSelect().value).toBe("DOING");
    // 「接口」4 项、DOING 筛选后为 3 项 → 共 1 页，第 2 页越界被规范为第 1 页。
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();
  });

  it("缺省参数：空搜索词、ALL、第1页", async () => {
    render(<App />);
    await settled();

    expect(query().value).toBe("");
    expect(statusSelect().value).toBe("ALL");
    expect(pagerText()).toBe("第1页 共4页");
    expect(await screen.findByText("登录功能开发")).toBeInTheDocument();
  });

  it("未提交的输入不写 URL", async () => {
    const user = userEvent.setup();
    render(<App />);
    await settled();

    await user.type(query(), "登录");
    // 只在输入框里打字，没有点查询，URL 不应变化。
    expect(window.location.search).toBe("");
  });
});

describe("T2 URL 非法参数", () => {
  it.each([
    ["未知状态回落为 ALL", "?status=UNKNOWN", "ALL"],
    ["空状态回落为 ALL", "?status=", "ALL"],
    ["小写状态回落为 ALL", "?status=doing", "ALL"],
  ])("%s", async (_name, search, expectedStatus) => {
    window.history.replaceState(null, "", "/" + search);
    render(<App />);
    await settled();
    expect(statusSelect().value).toBe(expectedStatus);
  });

  it.each([
    ["page=0", "0"],
    ["page=-3", "-3"],
    ["page=abc", "abc"],
    ["page=1.5", "1.5"],
    ["page=1e2", "1e2"],
    ["page= 2", "%202"],
    ["page=空", ""],
    ["page=超大整数", "99999999999999999999"],
  ])("非法页码 %s 回落为 1", async (_name, raw) => {
    window.history.replaceState(null, "", `/?page=${raw}`);
    render(<App />);
    await settled();
    expect(pagerText()).toBe("第1页 共4页");
  });

  it("readQuery 对非法值返回缺省 Filters", () => {
    expect(readQuery("?q=%20%20&status=NOPE&page=0")).toEqual({
      q: "  ",
      status: "ALL",
      page: 1,
    });
    expect(readQuery("?page=2")).toEqual({ q: "", status: "ALL", page: 2 });
    expect(readQuery("")).toEqual({ q: "", status: "ALL", page: 1 });
  });
});

describe("T2 URL 写入与历史", () => {
  it("点击查询：trim 搜索词、页码回 1、replace 当前历史项", async () => {
    render(<App />);
    await settled();
    const before = window.history.length;

    const user = userEvent.setup();
    await user.type(query(), "  登录  ");
    await user.click(screen.getByRole("button", { name: "查询" }));
    await settled();

    expect(new URLSearchParams(window.location.search).get("q")).toBe("登录");
    expect(window.location.search).not.toContain("page");
    // replace 不增加历史项。
    expect(window.history.length).toBe(before);
  });

  it("筛选变化：push 历史项且页码回 1", async () => {
    render(<App />);
    await settled();
    const before = window.history.length;

    await userEvent.setup().selectOptions(statusSelect(), "DOING");
    await settled();

    expect(new URLSearchParams(window.location.search).get("status")).toBe("DOING");
    expect(window.location.search).not.toContain("page");
    expect(window.history.length).toBe(before + 1);
  });

  it("翻页：push 历史项并写入 page", async () => {
    render(<App />);
    await settled();
    const before = window.history.length;

    await userEvent.setup().click(screen.getByRole("button", { name: "下一页" }));
    await settled();

    expect(new URLSearchParams(window.location.search).get("page")).toBe("2");
    expect(window.history.length).toBe(before + 1);
    expect(pagerText()).toBe("第2页 共4页");
  });

  it("默认参数可省略，不写入 URL", async () => {
    render(<App />);
    await settled();

    // 全部为默认值：URL 保持干净。
    expect(window.location.search).toBe("");
    expect(readQuery(window.location.search)).toEqual({
      q: "",
      status: "ALL",
      page: 1,
    });
  });
});

describe("T2 URL 保留无关参数与 hash", () => {
  it("写入时保留无关参数和 hash", async () => {
    window.history.replaceState(null, "", "/?utm=abc&q=%E6%8E%A5%E5%8F%A3#top");
    render(<App />);
    await settled();

    await userEvent.setup().selectOptions(statusSelect(), "DOING");
    await settled();

    const params = new URLSearchParams(window.location.search);
    expect(params.get("utm")).toBe("abc");
    expect(params.get("q")).toBe("接口");
    expect(params.get("status")).toBe("DOING");
    expect(window.location.hash).toBe("#top");
  });

  it("中文、空格与 & 编码不被破坏（往返一致）", async () => {
    render(<App />);
    await settled();

    const filters: Filters = { q: "登录 & 接口 测试", status: "TODO", page: 3 };
    await act(async () => {
      writeQuery(filters, "push");
    });

    // 重新解析应完全还原，说明编码没有被 URLSearchParams 之外的逻辑破坏。
    expect(readQuery(window.location.search)).toEqual(filters);
    expect(window.location.search).toContain("status=TODO");
    // 用独立于 URLSearchParams 的解码方式确认中文/空格/& 没有被破坏。
    // 注意空格在查询串里合法地编码为 "+"，decodeURIComponent 不还原 "+"，
    // 因此先把它还原成 %20 再解码，避免断言依赖某一种编码形式。
    const qRaw = window.location.search.match(/(?:^|[?&])q=([^&]*)/)![1];
    expect(decodeURIComponent(qRaw.replace(/\+/g, "%20"))).toBe(
      "登录 & 接口 测试",
    );
    // & 必须是编码后的，不能作为参数分隔符泄漏出去。
    expect(new URLSearchParams(window.location.search).get("q")).toBe(
      "登录 & 接口 测试",
    );
  });
});

describe("T2 popstate 前进/后退恢复", () => {
  it("popstate 恢复输入、筛选、页码并发起对应查询", async () => {
    render(<App />);
    await settled();

    // 先制造两个历史条目：page=2，再 status=DOING。
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await settled();
    await user.selectOptions(statusSelect(), "DOING");
    await settled();
    expect(statusSelect().value).toBe("DOING");

    // 模拟浏览器后退：history 状态由 jsdom 维护，这里显式驱动 popstate。
    await act(async () => {
      window.history.back();
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settled();

    // 后退应恢复到上一个已提交状态（page=2、status=ALL、空搜索）。
    await waitFor(() => {
      expect(statusSelect().value).toBe("ALL");
    });
    expect(query().value).toBe("");
  });

  it("popstate 到带 q 的 URL 会同步输入框并重新查询", async () => {
    render(<App />);
    await settled();

    // 模拟前进/后退落到 ?q=接口。
    await act(async () => {
      window.history.replaceState(null, "", "/?q=%E6%8E%A5%E5%8F%A3");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(query().value).toBe("接口");
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();
  });
});

describe("T2 结果钳制与空结果", () => {
  it("越界页码在查询成功后才按结果页数钳制，并用 replace 规范 URL", async () => {
    // 第 8 页远超「登录」(4项, 1页) 的实际页数。
    window.history.replaceState(null, "", "/?q=%E7%99%BB%E5%BD%95&page=8");
    const before = window.history.length;

    render(<App />);
    await settled();

    await waitFor(() => {
      expect(pagerText()).toBe("第1页 共1页");
    });
    // 规范的越界页码应写回 URL，且不新增历史项。
    expect(new URLSearchParams(window.location.search).get("page")).toBeNull();
    expect(window.history.length).toBe(before);
  });

  it("恢复的页码在加载期间不得被提前改成 1", async () => {
    // 全量 24 项、每页 6 项 → 共 4 页；第 3 页是合法页码。
    window.history.replaceState(null, "", "/?page=3");
    render(<App />);

    // 加载中（此时 tasks 还是空列表）不得把页码钳制成 1。
    expect(screen.getByText("正在查询…")).toBeInTheDocument();
    expect(pagerText()).toContain("第1页");

    await settled();
    await waitFor(() => {
      expect(pagerText()).toBe("第3页 共4页");
    });
    expect(new URLSearchParams(window.location.search).get("page")).toBe("3");
  });

  it("空结果保持第1页、共1页", async () => {
    window.history.replaceState(null, "", "/?q=%E4%B8%8D%E5%AD%98%E5%9C%A8&page=5");
    render(<App />);
    await settled();

    expect(await screen.findByText("没有匹配的任务")).toBeInTheDocument();
    expect(pagerText()).toBe("第1页 共1页");
  });

  it("每页 6 项且顺序不变", async () => {
    render(<App />);
    await settled();

    expect(await screen.findByText("登录功能开发")).toBeInTheDocument();
    // 第一页应为种子第 1..6 项。
    expect(screen.getByText("单元测试编写")).toBeInTheDocument();
    expect(screen.queryByText("登录输入校验")).not.toBeInTheDocument();
    expect(pagerText()).toBe("第1页 共4页");
  });
});
