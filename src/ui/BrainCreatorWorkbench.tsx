"use client";

import { useMemo, useState } from "react";
import { apiRequest, postJson } from "./apiClient";

type StepStatus = "idle" | "running" | "succeeded" | "failed";

type AuthProfileResult = {
  id: string;
  status: string;
  encryptedSecrets: Record<string, string>;
};

type PageDiscoveryResult = {
  pageModel: {
    id: string;
    name: string;
    status: string;
    screenshotId?: string;
  };
  locatorPoints: Array<{
    id: string;
    name: string;
  }>;
  probeResult: {
    id: string;
    type: string;
    result: string;
    issues: string[];
  };
};

type TrainingSessionResult = {
  id: string;
  status: string;
};

type TrainingCompletionResult = {
  session: {
    id: string;
    status: string;
  };
  actionSteps: Array<{ id: string }>;
  apiFlow: {
    id: string;
    requests: Array<{ url: string }>;
  };
};

type GeneratedCaseResult = {
  id: string;
  status: string;
  steps: Array<{ order: number; instruction: string }>;
  gaps: Array<{
    id: string;
    reason: string;
    status?: string;
  }>;
};

type AssetResult = {
  id: string;
  type: string;
  label: string;
  status?: string;
};

type RunLog = {
  id: string;
  title: string;
  status: "succeeded" | "failed";
  detail: string;
};

const statusLabels: Record<StepStatus, string> = {
  idle: "待执行",
  running: "处理中",
  succeeded: "完成",
  failed: "失败"
};

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
  const [projectId, setProjectId] = useState("project-1");
  const [env, setEnv] = useState("test");
  const [role, setRole] = useState("qa");
  const [loginMethod, setLoginMethod] = useState("token");
  const [secret, setSecret] = useState("secret-token");
  const [route, setRoute] = useState("/orders");
  const [pageName, setPageName] = useState("订单页面");
  const [targetUrl, setTargetUrl] = useState("http://127.0.0.1:3000/fixtures/model-target");
  const [captureMode, setCaptureMode] = useState<"manual" | "browser">("manual");
  const [domText, setDomText] = useState("Create Order Submit Search");
  const [requirement, setRequirement] = useState("Unknown approval path");
  const [assetQuery, setAssetQuery] = useState("订单");
  const [statuses, setStatuses] = useState<Record<string, StepStatus>>({});
  const [logs, setLogs] = useState<RunLog[]>([]);

  const [authProfile, setAuthProfile] = useState<AuthProfileResult | null>(null);
  const [discovery, setDiscovery] = useState<PageDiscoveryResult | null>(null);
  const [trainingSession, setTrainingSession] = useState<TrainingSessionResult | null>(null);
  const [trainingCompletion, setTrainingCompletion] =
    useState<TrainingCompletionResult | null>(null);
  const [generatedCase, setGeneratedCase] = useState<GeneratedCaseResult | null>(null);
  const [assets, setAssets] = useState<AssetResult[]>([]);

  const activeGap = generatedCase?.gaps.find((gap) => gap.status !== "resolved");

  const stats = useMemo(
    () => [
      { label: "AuthProfile", value: authProfile ? "1" : "0" },
      { label: "PageModel", value: discovery ? "1" : "0" },
      { label: "LocatorPoint", value: String(discovery?.locatorPoints.length ?? 0) },
      { label: "Gap", value: String(generatedCase?.gaps.length ?? 0) }
    ],
    [authProfile, discovery, generatedCase]
  );

  async function runStep<T>(key: string, title: string, action: () => Promise<T>) {
    setStatuses((current) => ({ ...current, [key]: "running" }));
    try {
      const result = await action();
      setStatuses((current) => ({ ...current, [key]: "succeeded" }));
      addLog(title, "succeeded", "执行成功");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatuses((current) => ({ ...current, [key]: "failed" }));
      addLog(title, "failed", message);
      throw error;
    }
  }

  async function createAuthProfile() {
    const profile = await runStep("auth", "创建鉴权", () =>
      postJson<AuthProfileResult>("/api/auth-profiles", {
        projectId,
        env,
        role,
        loginMethod,
        secrets: {
          [loginMethod]: secret
        }
      })
    );
    setAuthProfile(profile);
    return profile;
  }

  async function verifyAuthProfile(profile = authProfile) {
    if (!profile) return;
    const verified = await runStep("verify", "验证鉴权", () =>
      postJson<AuthProfileResult>(`/api/auth-profiles/${profile.id}/verify`)
    );
    setAuthProfile(verified);
    return verified;
  }

  async function discoverPageModel(profile = authProfile) {
    const result = await runStep("discover", "页面建模", () =>
      postJson<PageDiscoveryResult>("/api/page-models/discover", {
        projectId,
        route,
        name: pageName,
        authProfileId: profile?.id,
        captureMode,
        targetUrl,
        domText
      })
    );
    setDiscovery(result);
    return result;
  }

  async function createTrainingSession(page = discovery) {
    if (!page) return;
    const session = await runStep("training", "创建训练", () =>
      postJson<TrainingSessionResult>("/api/training-sessions", {
        projectId,
        pageModelId: page.pageModel.id
      })
    );
    setTrainingSession(session);
    return session;
  }

  async function completeTrainingSession(session = trainingSession, page = discovery) {
    if (!session || !page) return;
    const result = await runStep("complete", "完成训练", () =>
      postJson<TrainingCompletionResult>(
        `/api/training-sessions/${session.id}/complete`,
        {
          actions: [
            {
              type: "click",
              targetLocatorId: page.locatorPoints[0]?.id ?? "",
              inputValue: "",
              assertion: "form opens"
            }
          ],
          apiRequests: [{ method: "POST", url: "/api/orders", status: 201 }]
        }
      )
    );
    setTrainingCompletion(result);
    return result;
  }

  async function generateCase(page = discovery) {
    if (!page) return;
    const result = await runStep("case", "生成用例", () =>
      postJson<GeneratedCaseResult>("/api/generated-cases", {
        projectId,
        sourceRequirement: requirement,
        pageModelId: page.pageModel.id
      })
    );
    setGeneratedCase(result);
    return result;
  }

  async function searchAssets() {
    const query = new URLSearchParams({ projectId, query: assetQuery });
    const result = await runStep("assets", "搜索资产", () =>
      apiRequest<AssetResult[]>(`/api/assets/search?${query.toString()}`)
    );
    setAssets(result);
    return result;
  }

  async function resolveGap() {
    if (!activeGap) return;
    const resolved = await runStep("gap", "处理缺口", () =>
      postJson<{ id: string; status: string }>(`/api/gaps/${activeGap.id}/resolve`)
    );
    setGeneratedCase((current) =>
      current
        ? {
            ...current,
            gaps: current.gaps.map((gap) =>
              gap.id === resolved.id ? { ...gap, status: resolved.status } : gap
            )
          }
        : current
    );
  }

  async function runLocalLoop() {
    const profile = authProfile ?? (await createAuthProfile());
    const verifiedProfile = profile ? await verifyAuthProfile(profile) : null;
    const page = discovery ?? (await discoverPageModel(verifiedProfile ?? profile));
    const session = trainingSession ?? (page ? await createTrainingSession(page) : null);
    if (session && page) {
      await completeTrainingSession(session, page);
      await generateCase(page);
      await searchAssets();
    }
  }

  function addLog(title: string, status: RunLog["status"], detail: string) {
    setLogs((current) => [
      {
        id: `${Date.now()}-${current.length}`,
        title,
        status,
        detail
      },
      ...current
    ]);
  }

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
          <a href="#operate">操作台</a>
          <a href="#assets">资产管理</a>
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
          <button className="primary" onClick={() => void runLocalLoop()}>
            <IconBadge label="Run" />
            运行本地闭环
          </button>
          <button className="secondary" onClick={() => void searchAssets()}>
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

      <section className="section operate" id="operate">
        <div className="section-title">
          <h2>真实可用闭环</h2>
          <p>这些按钮会调用本地 API，并把返回资产展示在页面上。</p>
        </div>
        <div className="operation-grid">
          <label>
            项目 ID
            <input value={projectId} onChange={(event) => setProjectId(event.target.value)} />
          </label>
          <label>
            环境
            <input value={env} onChange={(event) => setEnv(event.target.value)} />
          </label>
          <label>
            角色
            <input value={role} onChange={(event) => setRole(event.target.value)} />
          </label>
          <label>
            登录方式
            <select value={loginMethod} onChange={(event) => setLoginMethod(event.target.value)}>
              <option value="token">token</option>
              <option value="cookie">cookie</option>
              <option value="password">password</option>
              <option value="script">script</option>
            </select>
          </label>
          <label>
            密钥
            <input value={secret} onChange={(event) => setSecret(event.target.value)} />
          </label>
          <label>
            页面 Route
            <input value={route} onChange={(event) => setRoute(event.target.value)} />
          </label>
          <label>
            页面名称
            <input value={pageName} onChange={(event) => setPageName(event.target.value)} />
          </label>
          <label>
            资产搜索词
            <input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} />
          </label>
          <label>
            采集模式
            <select
              value={captureMode}
              onChange={(event) => setCaptureMode(event.target.value as "manual" | "browser")}
            >
              <option value="manual">手工输入</option>
              <option value="browser">真实浏览器</option>
            </select>
          </label>
          <label>
            目标 URL
            <input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} />
          </label>
          <label className="wide">
            DOM 文本
            <textarea value={domText} onChange={(event) => setDomText(event.target.value)} />
          </label>
          <label className="wide">
            自然语言需求
            <textarea
              value={requirement}
              onChange={(event) => setRequirement(event.target.value)}
            />
          </label>
        </div>

        <div className="step-actions">
          <StepButton label="创建鉴权" status={statuses.auth} onClick={createAuthProfile} />
          <StepButton
            label="验证鉴权"
            status={statuses.verify}
            disabled={!authProfile}
            onClick={verifyAuthProfile}
          />
          <StepButton
            label="页面建模"
            status={statuses.discover}
            disabled={!authProfile}
            onClick={discoverPageModel}
          />
          <StepButton
            label="创建训练"
            status={statuses.training}
            disabled={!discovery}
            onClick={createTrainingSession}
          />
          <StepButton
            label="完成训练"
            status={statuses.complete}
            disabled={!trainingSession}
            onClick={completeTrainingSession}
          />
          <StepButton
            label="生成用例"
            status={statuses.case}
            disabled={!discovery}
            onClick={generateCase}
          />
          <StepButton label="搜索资产" status={statuses.assets} onClick={searchAssets} />
          <StepButton
            label="处理缺口"
            status={statuses.gap}
            disabled={!activeGap}
            onClick={resolveGap}
          />
        </div>
      </section>

      <section className="panel-grid" id="assets">
        {panels.map((panel) => (
          <article className="action-panel" key={panel.title}>
            <div className="panel-heading">
              <IconBadge label={panel.icon} />
              <h3>{panel.title}</h3>
              <span>{panel.status}</span>
            </div>
            <p>{panel.body}</p>
          </article>
        ))}
      </section>

      <section className="section split" id="training">
        <div>
          <h2>本地闭环状态</h2>
          <p>
            这里展示的是 API 返回后的真实本地资产状态。服务重启后内存数据会清空。
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

      <section className="section result-grid" aria-label="资产结果">
        <ResultCard title="AuthProfile" value={authProfile} />
        <ResultCard title="PageModel" value={discovery?.pageModel ?? null} />
        <ResultCard title="LocatorPoint" value={discovery?.locatorPoints ?? []} />
        <ResultCard title="ProbeResult" value={discovery?.probeResult ?? null} />
        <ResultCard title="TrainingSession" value={trainingSession} />
        <ResultCard title="ApiFlow" value={trainingCompletion?.apiFlow ?? null} />
        <ResultCard title="GeneratedCase" value={generatedCase} />
        <ResultCard title="Assets" value={assets} />
        <ResultCard title="Gaps" value={generatedCase?.gaps ?? []} />
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
          <h3>运行日志</h3>
          {logs.length === 0 ? (
            <p>还没有执行记录。先点击“创建鉴权”。</p>
          ) : (
            <ol className="run-log">
              {logs.map((log) => (
                <li key={log.id} data-status={log.status}>
                  <strong>{log.title}</strong>
                  <span>{log.detail}</span>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>
    </main>
  );
}

function StepButton({
  label,
  status = "idle",
  disabled,
  onClick
}: {
  label: string;
  status?: StepStatus;
  disabled?: boolean;
  onClick: () => unknown | Promise<unknown>;
}) {
  return (
    <button
      className="secondary step-button"
      disabled={disabled || status === "running"}
      onClick={() => void onClick()}
    >
      <span>{label}</span>
      <small aria-hidden="true">{statusLabels[status]}</small>
    </button>
  );
}

function ResultCard({ title, value }: { title: string; value: unknown }) {
  const empty =
    value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  return (
    <article className="result-card" aria-label={`${title} 结果`}>
      <h3>{title}</h3>
      {empty ? <p>等待上一步生成。</p> : <pre>{JSON.stringify(value, null, 2)}</pre>}
    </article>
  );
}

function IconBadge({ label }: { label: string }) {
  return (
    <span className="icon-badge" aria-hidden="true">
      {label}
    </span>
  );
}
