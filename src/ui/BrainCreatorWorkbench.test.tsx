import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrainCreatorWorkbench } from "./BrainCreatorWorkbench";

describe("BrainCreatorWorkbench", () => {
  it("renders the MVP workbench workflow and core operating panels", () => {
    render(<BrainCreatorWorkbench />);

    expect(screen.getByRole("heading", { name: "Brain Creator" })).toBeInTheDocument();
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("配置鉴权")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "页面建模" })).toHaveLength(2);
    expect(screen.getAllByRole("heading", { name: "训练室" })).toHaveLength(2);
    expect(screen.getByText("自然语言用例生成")).toBeInTheDocument();
    expect(screen.getAllByText("缺口处理").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "运行本地闭环" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看资产" })).toBeInTheDocument();
  });
});
