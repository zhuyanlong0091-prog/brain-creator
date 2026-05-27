"use client";

import {
  useMemo,
  useState
} from "react";

const workflow = [
  {
    step: "01",
    title: "配置鉴权",
    body: "准备可访问测试环境的账号、Cookie 或 Token，并验证登录状态。"
  },
  {
    step: "02",
    title: "页面建模",
    body: "沉淀页面模型、DOM 摘要、L 点和探针结果。"
  },
  {
    step: "03",
    title: "训练室",
    body: "记录真实操作、动作步骤和 API Flow 证据。"
  },
  {
    step: "04",
    title: "自然语言用例生成",
    body: "把需求绑定到已有页面资产，缺证据时生成缺口。"
  }
];

const panels = [
  {
    title: "页面建模",
    icon: "PM",
    body: "通过 URL 和鉴权资料生成 PageModel、LocatorPoint 与 ProbeResult。",
    status: "主入口"
  },
  {
    title: "训练室",
    icon: "TR",
    body: "录制业务操作，保存 ActionStep、Trace 和 API Flow。",
    status: "证据采集"
  },
  {
    title: "资产管理",
    icon: "AS",
    body: "统一查看页面模型、L 点、训练记录、用例和缺口。",
    status: "MVP"
  },
  {
    title: "缺口处理",
    icon: "GP",
    body: "定位、鉴权、接口证据或断言不足时，回到上下文修复。",
    status: "强约束"
  }
];

export function BrainCreatorWorkbench() {
  const [ranFlow, setRanFlow] = useState(false);
  const stats = useMemo(
    () => [
      { label: "AuthProfile", value: ranFlow ? "1" : "0" },
      { label: "PageModel", value: ranFlow ? "1" : "0" },
      { label: "LocatorPoint", value: ranFlow ? "3" : "0" },
      { label: "Gap", value: ranFlow ? "1" : "0" }
    ],
    [ranFlow]
  );

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand-mark">BC</div>
        <div>
          <h1>Brain Creator</h1>
          <p>工程控制台</p>
        </div>
        <nav aria-label="Brain Creator navigation">
          <a href="#workbench">工作台</a>
          <a href="#assets">资产管理</a>
          <a href="#training">训练室</a>
          <a href="#gaps">缺口处理</a>
        </nav>
      </header>

      <section className="hero" id="workbench">
        <div>
          <span className="pill">Brain Creator MVP</span>
          <h2>用真实页面证据生成可追踪测试资产</h2>
          <p>
            先配置鉴权，再建立页面模型和训练证据。自然语言用例只允许绑定到真实资产，
            证据不足时进入缺口处理。
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={() => setRanFlow(true)}>
            <IconBadge label="Run" />
            运行本地闭环
          </button>
          <button className="secondary">
            <IconBadge label="Find" />
            查看资产
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>推荐工作流</h2>
          <p>按顺序跑完即可得到一组可验证的 MVP 资产。</p>
        </div>
        <div className="workflow-grid">
          {workflow.map((item) => (
            <article className="workflow-card" key={item.step}>
              <span>{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel-grid" id="assets">
        {panels.map((panel) => {
          return (
            <article className="action-panel" key={panel.title}>
              <div className="panel-heading">
                <IconBadge label={panel.icon} />
                <h3>{panel.title}</h3>
                <span>{panel.status}</span>
              </div>
              <p>{panel.body}</p>
            </article>
          );
        })}
      </section>

      <section className="section split" id="training">
        <div>
          <h2>本地闭环状态</h2>
          <p>
            这个 MVP 使用本地服务模拟鉴权、页面发现、训练完成、用例生成和缺口处理，
            后续可替换为 Playwright Worker 与持久化资产库。
          </p>
        </div>
        <div className="stats">
          {stats.map((stat) => (
            <div className="stat" key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section concepts" id="gaps">
        <article>
          <IconBadge label="Key" />
          <h3>鉴权安全</h3>
          <p>响应中只返回脱敏后的密钥，日志和 UI 不展示原始 Token、Cookie 或密码。</p>
        </article>
        <article>
          <IconBadge label="AI" />
          <h3>生成约束</h3>
          <p>用例步骤必须绑定 PageModel、LocatorPoint 或 API Flow，缺证据则创建 Gap。</p>
        </article>
        <article>
          <IconBadge label="OK" />
          <h3>验收闭环</h3>
          <p>每个阶段都要经过测试、构建和真实浏览器验证后才能进入发布。</p>
        </article>
      </section>
    </main>
  );
}

function IconBadge({ label }: { label: string }) {
  return (
    <span className="icon-badge" aria-hidden="true">
      {label}
    </span>
  );
}
