import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";

/**
 * T3：真实 api + 真实定时器下的异步集成场景。
 *
 * 这里不 mock api，直接使用 450ms(登录) / 200ms(接口) 的真实延迟，
 * 验证「先查登录、结束前立刻查接口」时最终列表确实是较新的查询结果，
 * 即 T1 的竞态在真实时序下也确实被修复。
 */

const query = () => screen.getByPlaceholderText("搜索任务标题");

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("T1 真实时序下的竞态", () => {
  it("先查登录再立刻查接口，最终显示接口结果而非登录结果", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 首次查询「登录」(450ms)。
    await user.type(query(), "登录");
    await user.click(screen.getByRole("button", { name: "查询" }));
    expect(screen.getByText("正在查询…")).toBeInTheDocument();

    // 在「登录」结束前立刻改查「接口」(200ms)，后者会先返回。
    await user.clear(query());
    await user.type(query(), "接口");
    await user.click(screen.getByRole("button", { name: "查询" }));

    // 等真实定时器跑完两个请求（接口 200ms + 登录 450ms）。
    await waitFor(
      () => {
        expect(screen.queryByText("正在查询…")).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // 最终必须是较新的「接口」结果，且不能残留较早的「登录」结果。
    expect(screen.getByText("任务列表接口对接")).toBeInTheDocument();
    expect(screen.queryByText("登录功能开发")).not.toBeInTheDocument();
    expect(screen.getByText("4项任务")).toBeInTheDocument();
  });

  it("较早查询失败(失败)晚于较新查询成功返回，不显示错误", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 「失败」精确查询会在 200ms 后 reject。
    await user.type(query(), "失败");
    await user.click(screen.getByRole("button", { name: "查询" }));

    // 立刻改查「登录」(450ms)，它会晚于「失败」返回。
    await user.clear(query());
    await user.type(query(), "登录");
    await user.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(
      () => {
        expect(screen.queryByText("正在查询…")).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // 较早的失败不得污染新查询：既无错误，也应显示登录结果。
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("登录功能开发")).toBeInTheDocument();
  });

  it("失败后可重试成功（真实错误分支未被禁用）", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(query(), "失败");
    await user.click(screen.getByRole("button", { name: "查询" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("模拟查询失败");

    // 改成合法查询并重试。
    await user.clear(query());
    await user.type(query(), "接口");
    await user.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
