"use client";

import { useMemo, useRef, useState } from "react";
import { apiRequest, postJson } from "./apiClient";

type StepStatus = "idle" | "running" | "succeeded" | "failed";
type ViewKey =
  | "workbench"
  | "systems"
  | "page-modeling"
  | "training"
  | "case-generation"
  | "assets"
  | "auth"
  | "glossary";

type AuthProfileResult = {
  id: string;
  status: string;
  encryptedSecrets: Record<string, string>;
};

type SystemProfileResult = {
  id: string;
  name: string;
  environment: string;
  baseUrl: string;
  defaultLocale: string;
  urlAllowlist: string[];
  status: string;
};

type PageDiscoveryResult = {
  pageModel: {
    id: string;
    name: string;
    route?: string;
    status: string;
    screenshotId?: string;
  };
  locatorPoints: Array<{
    id: string;
    name: string;
    role?: string;
    selector?: string;
    confidence?: number;
  }>;
  probeResult: {
    id: string;
    type: string;
    result?: string;
    issues: string[];
  };
};

type TrainingSessionResult = {
  id: string;
  status: string;
  traceUrl?: string;
  harUrl?: string;
  screenshotUrl?: string;
};

type TrainingCompletionResult = {
  session: {
    id: string;
    status: string;
  };
  actionSteps: Array<{
    id: string;
    type: string;
    targetLocatorId: string;
    assertion: string;
    order: number;
  }>;
  apiFlow: {
    id: string;
    requests: Array<{ url: string }>;
  };
  gaps?: Array<{ id: string; reason: string; status?: string }>;
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

type SystemOverviewResult = {
  system: { id: string; name: string };
  completeness: {
    authConfigured: boolean;
    pageModeled: boolean;
    trainingEvidence: boolean;
    caseGenerated: boolean;
    openGaps: number;
  };
  assetCounts: Record<string, number>;
};

type AssetDetailResult = {
  type: string;
  asset: Record<string, unknown>;
  related: Record<string, unknown[]>;
};

type GlossaryTermResult = {
  id: string;
  projectId: string;
  key: string;
  zhCN: string;
  enUS: string;
  aliases: string[];
  pageScope: string;
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

const views: Array<{ key: ViewKey; label: string }> = [
  { key: "workbench", label: "工作台" },
  { key: "systems", label: "业务系统" },
  { key: "page-modeling", label: "页面建模" },
  { key: "training", label: "训练室" },
  { key: "case-generation", label: "自然语言用例生成" },
  { key: "assets", label: "资产管理" },
  { key: "auth", label: "鉴权管理" },
  { key: "glossary", label: "i18n 词根" }
];

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
    body: "记录本地训练草稿、动作步骤和 API Flow 证据。"
  },
  {
    step: "04",
    title: "自然语言用例生成",
    body: "把需求绑定到已有页面资产，缺证据时生成缺口。"
  },
  {
    step: "05",
    title: "资产与缺口",
    body: "统一查看资产、处理阻塞缺口，并沉淀 i18n 词根。"
  }
];

const concepts = [
  ["页面模型", "让系统认识一个页面：页面有哪些区域、哪些元素能操作、哪些信息能读取。"],
  ["L 点", "页面上每个可操作或可读取位置的编号和名称，方便人和系统说清楚点哪里。"],
  ["探针", "从真实页面 DOM 中采集可操作元素、表单、表格、定位和运行期问题的能力。"],
  ["定位规则说明", "当探针或 L 点定位失败、结果不符合预期时，用它排查系统为什么这样识别元素。"],
  ["Skill", "对业务能力的自然语言描述，说明某类业务应该如何被规划和复用。"],
  ["Tool", "执行层的可调用能力，负责把规划好的动作落到页面或接口操作上。"],
  ["API Flow", "从训练室网络请求中自动沉淀的接口链路模型，可用于脚本和压测。"],
  ["缺口处理", "如果系统不确定、不敢猜或需要人确认，就在对应页面的上下文里处理。"]
];

export function BrainCreatorWorkbench() {
  const [activeView, setActiveView] = useState<ViewKey>("workbench");
  const [systemName, setSystemName] = useState("Orders Console");
  const [systemBaseUrl, setSystemBaseUrl] = useState(
    "http://127.0.0.1:3000/fixtures/private-target"
  );
  const [systemLocale, setSystemLocale] = useState("zh-CN");
  const [systemAllowlist, setSystemAllowlist] = useState(
    "http://127.0.0.1:3000/fixtures/private-target"
  );
  const [projectId, setProjectId] = useState("project-1");
  const [env, setEnv] = useState("test");
  const [role, setRole] = useState("qa");
  const [loginMethod, setLoginMethod] = useState("token");
  const [secret, setSecret] = useState("secret-token");
  const [route, setRoute] = useState("/orders");
  const [pageName, setPageName] = useState("订单页面");
  const [targetUrl, setTargetUrl] = useState("http://127.0.0.1:3000/fixtures/model-target");
  const targetUrlRef = useRef(targetUrl);
  const targetUrlInputRef = useRef<HTMLInputElement>(null);
  const [captureMode, setCaptureMode] = useState<"manual" | "browser">("manual");
  const [domText, setDomText] = useState("Create Order Submit Search");
  const [requirement, setRequirement] = useState("Unknown approval path");
  const [assetQuery, setAssetQuery] = useState("订单");
  const [termKey, setTermKey] = useState("order.submit");
  const [termZhCN, setTermZhCN] = useState("提交订单");
  const [termEnUS, setTermEnUS] = useState("Submit order");
  const [termAliases, setTermAliases] = useState("Create Order, 下单");
  const [termScope, setTermScope] = useState("/orders");
  const [statuses, setStatuses] = useState<Record<string, StepStatus>>({});
  const [logs, setLogs] = useState<RunLog[]>([]);

  const [systems, setSystems] = useState<SystemProfileResult[]>([]);
  const [currentSystem, setCurrentSystem] = useState<SystemProfileResult | null>(null);
  const [authProfile, setAuthProfile] = useState<AuthProfileResult | null>(null);
  const [discovery, setDiscovery] = useState<PageDiscoveryResult | null>(null);
  const [trainingSession, setTrainingSession] = useState<TrainingSessionResult | null>(null);
  const [trainingCompletion, setTrainingCompletion] =
    useState<TrainingCompletionResult | null>(null);
  const [generatedCase, setGeneratedCase] = useState<GeneratedCaseResult | null>(null);
  const [assets, setAssets] = useState<AssetResult[]>([]);
  const [systemOverview, setSystemOverview] = useState<SystemOverviewResult | null>(null);
  const [assetDetail, setAssetDetail] = useState<AssetDetailResult | null>(null);
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTermResult[]>([]);

  const activeGap = generatedCase?.gaps.find((gap) => gap.status !== "resolved");
  const pageReady = Boolean(discovery);

  const stats = useMemo(
    () => [
      { label: "System", value: systems.length ? String(systems.length) : "0" },
      { label: "AuthProfile", value: authProfile ? "1" : "0" },
      { label: "PageModel", value: discovery ? "1" : "0" },
      { label: "LocatorPoint", value: String(discovery?.locatorPoints.length ?? 0) },
      { label: "Gap", value: String(generatedCase?.gaps.length ?? 0) }
    ],
    [authProfile, discovery, generatedCase, systems.length]
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

  async function createSystemProfile() {
    const system = await runStep("system", "创建业务系统", () =>
      postJson<SystemProfileResult>("/api/system-profiles", {
        name: systemName,
        environment: env,
        baseUrl: systemBaseUrl,
        defaultLocale: systemLocale,
        urlAllowlist: systemAllowlist
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      })
    );
    setSystems((current) => [system, ...current.filter((item) => item.id !== system.id)]);
    setCurrentSystem(system);
    setProjectId(system.id);
    setEnv(system.environment);
    setTargetUrl(system.baseUrl);
    targetUrlRef.current = system.baseUrl;
    if (targetUrlInputRef.current) {
      targetUrlInputRef.current.value = system.baseUrl;
    }
    setAssetQuery(system.name);
    addLog("业务系统接入", "succeeded", `当前系统：${system.name}`);
    return system;
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
        targetUrl: targetUrlInputRef.current?.value || targetUrlRef.current,
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
          apiRequests: [{ method: "POST", url: "/api/orders", status: 201 }],
          recordingMode: "browser",
          targetUrl: targetUrlInputRef.current?.value || targetUrlRef.current,
          authProfileId: authProfile?.id,
          action: {
            type: "click",
            selector: page.locatorPoints[0]?.selector ?? "",
            targetLocatorId: page.locatorPoints[0]?.id ?? "",
            inputValue: "",
            assertion: "request captured"
          }
        }
      )
    );
    setTrainingSession(result.session);
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

  async function refreshSystemOverview() {
    if (!currentSystem) return;
    const overview = await runStep("overview", "刷新系统概览", () =>
      apiRequest<SystemOverviewResult>(`/api/system-profiles/${currentSystem.id}/overview`)
    );
    setSystemOverview(overview);
    return overview;
  }

  async function loadAssetDetail(asset: AssetResult) {
    const query = new URLSearchParams({
      projectId,
      type: asset.type,
      id: asset.id
    });
    const detail = await runStep("assetDetail", "查看资产详情", () =>
      apiRequest<AssetDetailResult>(`/api/assets/detail?${query.toString()}`)
    );
    setAssetDetail(detail);
    return detail;
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

  async function createGlossaryTerm() {
    const term = await runStep("glossary", "保存词根", () =>
      postJson<GlossaryTermResult>("/api/glossary-terms", {
        projectId,
        key: termKey,
        zhCN: termZhCN,
        enUS: termEnUS,
        aliases: termAliases.split(",").map((alias) => alias.trim()).filter(Boolean),
        pageScope: termScope
      })
    );
    setGlossaryTerms((current) => [term, ...current]);
    setAssetQuery(term.key);
    return term;
  }

  async function listGlossaryTerms() {
    const query = new URLSearchParams({ projectId, query: termKey });
    const terms = await runStep("glossarySearch", "查询词根", () =>
      apiRequest<GlossaryTermResult[]>(`/api/glossary-terms?${query.toString()}`)
    );
    setGlossaryTerms(terms);
    return terms;
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
        <nav aria-label="Brain Creator navigation" role="tablist">
          {views.map((view) => (
            <button
              key={view.key}
              aria-selected={activeView === view.key}
              className={activeView === view.key ? "nav-tab active" : "nav-tab"}
              onClick={() => setActiveView(view.key)}
              role="tab"
              type="button"
            >
              {view.label}
            </button>
          ))}
        </nav>
      </header>

      {activeView === "workbench" ? renderWorkbench() : null}
      {activeView === "systems" ? renderSystems() : null}
      {activeView === "page-modeling" ? renderPageModeling() : null}
      {activeView === "training" ? renderTrainingRoom() : null}
      {activeView === "case-generation" ? renderCaseGeneration() : null}
      {activeView === "assets" ? renderAssetCenter() : null}
      {activeView === "auth" ? renderAuthManagement() : null}
      {activeView === "glossary" ? renderGlossary() : null}
    </main>
  );

  function renderWorkbench() {
    return (
      <>
        <section className="hero" id="workbench">
          <div>
            <span className="pill">Brain Creator 工作台</span>
            <h2>用真实页面证据生成可追踪测试资产</h2>
            <p>
              先配置鉴权，再建立页面模型和训练证据。自然语言用例只允许绑定到真实资产，
              证据不足时进入缺口处理。
            </p>
          </div>
          <div className="hero-actions">
            <button className="primary" onClick={() => setActiveView("systems")} type="button">
              <IconBadge label="Sys" />
              进入业务系统接入
            </button>
            <button className="primary" onClick={() => void runLocalLoop()} type="button">
              <IconBadge label="Run" />
              运行本地闭环
            </button>
            <button className="secondary" onClick={() => void searchAssets()} type="button">
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
            <h2>快捷闭环</h2>
            <p>这里保留完整本地流程，适合快速验收 UI 到 API 的连通性。</p>
          </div>
          <QuickFlowControls />
          <StepActions />
        </section>

        <section className="panel-grid">
          {[
            ["页面建模", "PM", "通过 URL 和鉴权资料生成 PageModel、LocatorPoint 与 ProbeResult。", "主入口"],
            ["训练室", "TR", "保存本地训练草稿、ActionStep、Trace 和 API Flow。", "证据采集"],
            ["自然语言用例生成", "NL", "用已有资产生成草稿；证据不足时创建 Gap。", "执行入口"],
            ["鉴权管理", "AU", "维护环境账号和登录资料，响应中只展示脱敏值。", "前置配置"],
            ["i18n 词根", "I18N", "维护多语言文本词根，让文案定位和名称更稳定。", "跨语言"]
          ].map(([title, icon, body, status]) => (
            <article className="action-panel" key={title}>
              <div className="panel-heading">
                <IconBadge label={icon} />
                <h3>{title}</h3>
                <span>{status}</span>
              </div>
              <p>{body}</p>
            </article>
          ))}
        </section>

        <section className="section split">
          <div>
            <h2>本地闭环状态</h2>
            <p>这里展示的是 API 返回后的真实本地资产状态。服务重启后可从本地 JSON 仓库恢复。</p>
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

        <LatestResults />
        <ConceptGrid />
        <RunLogPanel />
      </>
    );
  }

  function renderSystems() {
    return (
      <section className="module-shell">
        <ModuleHeader
          eyebrow="可复用主入口"
          title="业务系统接入"
          body="先把一个真实业务系统接入 Brain Creator，再在该系统下配置鉴权、页面建模、训练和用例生成。"
        />
        <div className="operation-grid">
          <label>
            系统名称
            <input value={systemName} onChange={(event) => setSystemName(event.target.value)} />
          </label>
          <label>
            环境
            <input value={env} onChange={(event) => setEnv(event.target.value)} />
          </label>
          <label>
            基础 URL
            <input value={systemBaseUrl} onChange={(event) => setSystemBaseUrl(event.target.value)} />
          </label>
          <label>
            默认语言
            <input value={systemLocale} onChange={(event) => setSystemLocale(event.target.value)} />
          </label>
          <label className="wide">
            URL 允许范围
            <input
              value={systemAllowlist}
              onChange={(event) => setSystemAllowlist(event.target.value)}
            />
          </label>
        </div>
        <div className="step-actions">
          <StepButton
            label="创建业务系统"
            status={statuses.system}
            onClick={createSystemProfile}
          />
          <button className="secondary step-button" onClick={() => setActiveView("auth")} type="button">
            <span>下一步：配置鉴权</span>
            <small aria-hidden="true">入口</small>
          </button>
        </div>
        <section className="section asset-groups" aria-label="业务系统结果">
          {currentSystem ? (
            <article className="asset-group">
              <h3>当前系统：{currentSystem.name}</h3>
              <p>可复用入口已建立</p>
              <p>{currentSystem.environment}</p>
              <p>{currentSystem.baseUrl}</p>
            </article>
          ) : (
            <p className="hint">还没有接入业务系统。先创建系统，再进入鉴权管理和页面建模。</p>
          )}
          {systems.map((system) => (
            <article className="asset-group" key={system.id}>
              <h3>{system.name}</h3>
              <p>{system.environment}</p>
              <p>{system.status}</p>
            </article>
          ))}
        </section>
      </section>
    );
  }

  function renderPageModeling() {
    return (
      <section className="module-shell">
        <ModuleHeader
          eyebrow="主入口"
          title="页面建模"
          body="输入页面地址或 DOM 文本，沉淀 PageModel、L 点和探针结果。"
        />
        <CurrentSystemNote />
        <QuickFlowControls includeAuth={false} />
        <div className="step-actions">
          <StepButton
            label="页面建模"
            status={statuses.discover}
            disabled={!authProfile}
            onClick={discoverPageModel}
          />
        </div>
        {!authProfile ? <p className="hint">请先在鉴权管理中创建或验证鉴权配置。</p> : null}
        <section className="section result-grid" aria-label="页面建模结果">
          <SummaryCard title="PageModel 结果" value={discovery?.pageModel ?? null} />
          <SummaryCard title="LocatorPoint 结果" value={discovery?.locatorPoints ?? []} />
          <SummaryCard title="ProbeResult 结果" value={discovery?.probeResult ?? null} />
        </section>
      </section>
    );
  }

  function renderTrainingRoom() {
    return (
      <section className="module-shell">
        <ModuleHeader
          eyebrow="证据采集"
          title="训练室"
          body="使用真实浏览器执行一次页面动作，保存 trace、HAR、截图和 API Flow 证据。"
        />
        <div className="step-actions">
          <StepButton
            label="创建训练"
            status={statuses.training}
            disabled={!pageReady}
            onClick={createTrainingSession}
          />
          <StepButton
            label="完成训练"
            status={statuses.complete}
            disabled={!trainingSession}
            onClick={completeTrainingSession}
          />
        </div>
        {!pageReady ? <p className="hint">请先完成页面建模，再进入训练室。</p> : null}
        <section className="section result-grid" aria-label="训练室结果">
          <SummaryCard title="TrainingSession 结果" value={trainingSession} />
          <SummaryCard title="ActionStep 结果" value={trainingCompletion?.actionSteps ?? []} />
          <SummaryCard title="ApiFlow 结果" value={trainingCompletion?.apiFlow ?? null} />
          <SummaryCard title="TrainingGap 结果" value={trainingCompletion?.gaps ?? []} />
        </section>
      </section>
    );
  }

  function renderCaseGeneration() {
    return (
      <section className="module-shell">
        <ModuleHeader
          eyebrow="执行入口"
          title="自然语言用例生成"
          body="输入需求，系统只基于已有页面资产生成步骤；证据不足时创建缺口。"
        />
        <CurrentSystemNote />
        <div className="operation-grid compact-form">
          <label className="wide">
            自然语言需求
            <textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} />
          </label>
        </div>
        <div className="step-actions">
          <StepButton
            label="生成用例"
            status={statuses.case}
            disabled={!pageReady}
            onClick={generateCase}
          />
          <StepButton
            label="处理缺口"
            status={statuses.gap}
            disabled={!activeGap}
            onClick={resolveGap}
          />
        </div>
        <section className="section result-grid" aria-label="用例结果">
          <SummaryCard title="GeneratedCase 结果" value={generatedCase} />
          <SummaryCard title="Gaps 结果" value={generatedCase?.gaps ?? []} />
        </section>
      </section>
    );
  }

  function renderAssetCenter() {
    const grouped = groupAssets(assets);
    return (
      <section className="module-shell">
        <ModuleHeader
          eyebrow="MVP"
          title="资产管理"
          body="按类型查看本地资产，包含页面模型、L 点、训练记录、API Flow、用例、缺口和词根。"
        />
        <CurrentSystemNote />
        <SystemOverviewPanel overview={systemOverview} />
        <AssetDetailPanel detail={assetDetail} />
        <div className="operation-grid compact-form">
          <label>
            资产搜索词
            <input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} />
          </label>
        </div>
        <div className="step-actions">
          <StepButton label="搜索资产" status={statuses.assets} onClick={searchAssets} />
        </div>
        <section className="section asset-groups" aria-label="资产结果">
          {Object.keys(grouped).length === 0 ? (
            <p className="hint">还没有资产结果。先完成页面建模或保存词根，再点击搜索资产。</p>
          ) : (
            Object.entries(grouped).map(([type, items]) => (
              <article className="asset-group" key={type}>
                <h3>{type}</h3>
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.label}</strong>
                      <span>{item.status ?? item.id}</span>
                      <button className="secondary" onClick={() => void loadAssetDetail(item)} type="button">
                        查看 {item.label} 详情
                      </button>
                    </li>
                  ))}
                </ul>
              </article>
            ))
          )}
        </section>
      </section>
    );
  }

  function renderAuthManagement() {
    return (
      <section className="module-shell">
        <ModuleHeader
          eyebrow="前置配置"
          title="鉴权管理"
          body="维护测试环境账号和登录资料。密钥、Token、Cookie 在响应和页面上只显示脱敏值。"
        />
        <CurrentSystemNote />
        <QuickFlowControls onlyAuth />
        <div className="step-actions">
          <StepButton label="创建鉴权" status={statuses.auth} onClick={createAuthProfile} />
          <StepButton
            label="验证鉴权"
            status={statuses.verify}
            disabled={!authProfile}
            onClick={verifyAuthProfile}
          />
        </div>
        <p className="hint">当前阶段尚未接入复杂登录脚本录制，真实页面建模优先支持公开页和后续简单注入扩展。</p>
        <section className="section result-grid" aria-label="鉴权结果">
          <SummaryCard title="AuthProfile 结果" value={authProfile} />
        </section>
      </section>
    );
  }

  function renderGlossary() {
    return (
      <section className="module-shell">
        <ModuleHeader
          eyebrow="跨语言"
          title="i18n 词根"
          body="维护多语言文本词根，让页面定位和自然语言名称在中英文环境里更稳定。"
        />
        <CurrentSystemNote />
        <div className="operation-grid">
          <label>
            词根 Key
            <input value={termKey} onChange={(event) => setTermKey(event.target.value)} />
          </label>
          <label>
            中文名称
            <input value={termZhCN} onChange={(event) => setTermZhCN(event.target.value)} />
          </label>
          <label>
            英文名称
            <input value={termEnUS} onChange={(event) => setTermEnUS(event.target.value)} />
          </label>
          <label>
            页面范围
            <input value={termScope} onChange={(event) => setTermScope(event.target.value)} />
          </label>
          <label className="wide">
            别名
            <input value={termAliases} onChange={(event) => setTermAliases(event.target.value)} />
          </label>
        </div>
        <div className="step-actions">
          <StepButton label="保存词根" status={statuses.glossary} onClick={createGlossaryTerm} />
          <StepButton
            label="查询词根"
            status={statuses.glossarySearch}
            onClick={listGlossaryTerms}
          />
          <StepButton label="搜索资产" status={statuses.assets} onClick={searchAssets} />
        </div>
        <section className="section glossary-list" aria-label="词根结果">
          {glossaryTerms.length === 0 ? (
            <p className="hint">还没有词根。保存后可在资产管理里按 key、中文、英文或别名搜索。</p>
          ) : (
            glossaryTerms.map((term) => (
              <article className="asset-group" key={term.id}>
                <h3>{term.key}</h3>
                <p>{term.zhCN}</p>
                <p>{term.enUS}</p>
              </article>
            ))
          )}
        </section>
      </section>
    );
  }

  function CurrentSystemNote() {
    return (
      <section className="section split" aria-label="当前业务系统">
        <div>
          <h2>{currentSystem ? `当前系统：${currentSystem.name}` : "请先接入业务系统"}</h2>
          <p>
            {currentSystem
              ? "后续鉴权、页面建模、训练和用例生成都会归属到这个系统。"
              : "不同业务系统的资产会隔离保存，避免页面模型、鉴权和训练证据串用。"}
          </p>
        </div>
        <div className="step-actions">
          <button
            className="secondary"
            disabled={!currentSystem}
            onClick={() => void refreshSystemOverview()}
            type="button"
          >
            刷新系统概览
          </button>
          <button className="secondary" onClick={() => setActiveView("systems")} type="button">
            进入业务系统接入
          </button>
        </div>
      </section>
    );
  }

  function SystemOverviewPanel({ overview }: { overview: SystemOverviewResult | null }) {
    if (!overview) {
      return null;
    }
    const completionRows = [
      ["鉴权", overview.completeness.authConfigured],
      ["页面建模", overview.completeness.pageModeled],
      ["训练证据", overview.completeness.trainingEvidence],
      ["用例生成", overview.completeness.caseGenerated]
    ] as const;
    return (
      <section className="section asset-groups" aria-label="系统概览">
        <article className="asset-group">
          <h3>接入完整度</h3>
          <ul>
            {completionRows.map(([label, done]) => (
              <li key={label}>
                <strong>{label}：{done ? "已完成" : "未完成"}</strong>
              </li>
            ))}
            <li>
              <strong>开放缺口：{overview.completeness.openGaps}</strong>
            </li>
          </ul>
        </article>
        <article className="asset-group">
          <h3>资产数量</h3>
          <ReadableValue value={overview.assetCounts} />
        </article>
      </section>
    );
  }

  function AssetDetailPanel({ detail }: { detail: AssetDetailResult | null }) {
    if (!detail) {
      return null;
    }
    const relatedEntries = Object.entries(detail.related).filter(
      ([, value]) => Array.isArray(value) && value.length > 0
    );
    return (
      <section className="section result-grid" aria-label="资产详情">
        <article className="result-card">
          <h3>资产详情</h3>
          <ReadableValue value={detail.asset} />
        </article>
        <article className="result-card">
          <h3>关联资产</h3>
          {relatedEntries.length === 0 ? (
            <p>暂无关联资产。</p>
          ) : (
            <ul className="readable-list">
              {relatedEntries.map(([type, items]) => (
                <li key={type}>
                  <strong>{type}</strong>
                  <ReadableValue value={items} />
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    );
  }

  function QuickFlowControls({
    includeAuth = true,
    onlyAuth = false
  }: {
    includeAuth?: boolean;
    onlyAuth?: boolean;
  }) {
    return (
      <div className="operation-grid">
        <label>
          项目
          <input
            aria-label="项目 ID"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          />
        </label>
        {includeAuth ? (
          <>
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
          </>
        ) : null}
        {onlyAuth ? null : (
          <>
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
                aria-label="采集模式"
                value={captureMode}
                onChange={(event) => setCaptureMode(event.target.value as "manual" | "browser")}
              >
                <option value="manual">DOM 文本</option>
                <option value="browser">真实浏览器</option>
              </select>
            </label>
            <label>
              目标 URL
              <input
                ref={targetUrlInputRef}
                defaultValue={targetUrl}
                onBlur={(event) => updateTargetUrl(event.currentTarget.value)}
              />
            </label>
            <label className="wide">
              页面证据
              <textarea
                aria-label="DOM 文本"
                value={domText}
                onChange={(event) => setDomText(event.target.value)}
              />
            </label>
            <label className="wide">
              自然语言需求
              <textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} />
            </label>
          </>
        )}
      </div>
    );
  }

  function StepActions() {
    return (
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
    );
  }

  function updateTargetUrl(value: string) {
    targetUrlRef.current = value;
    setTargetUrl(value);
  }

  function ConceptGrid() {
    return (
      <section className="section concepts">
        {concepts.map(([title, body]) => (
          <article key={title}>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </section>
    );
  }

  function RunLogPanel() {
    return (
      <section className="section concepts">
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
    );
  }

  function LatestResults() {
    const hasResults =
      authProfile ||
      discovery ||
      trainingSession ||
      trainingCompletion ||
      generatedCase ||
      assets.length > 0;

    if (!hasResults) {
      return null;
    }

    return (
      <section className="section result-grid" aria-label="最新结果">
        <SummaryCard title="AuthProfile 结果" value={authProfile} />
        <SummaryCard title="PageModel 结果" value={discovery?.pageModel ?? null} />
        <SummaryCard title="LocatorPoint 结果" value={discovery?.locatorPoints ?? []} />
        <SummaryCard title="TrainingSession 结果" value={trainingSession} />
        <SummaryCard title="ActionStep 结果" value={trainingCompletion?.actionSteps ?? []} />
        <SummaryCard title="ApiFlow 结果" value={trainingCompletion?.apiFlow ?? null} />
        <SummaryCard title="GeneratedCase 结果" value={generatedCase} />
        <SummaryCard title="Assets 结果" value={assets} />
        <SummaryCard title="Gaps 结果" value={generatedCase?.gaps ?? []} />
      </section>
    );
  }
}

function ModuleHeader({
  eyebrow,
  title,
  body
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <section className="hero module-hero">
      <div>
        <span className="pill">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </section>
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
      type="button"
    >
      <span>{label}</span>
      <small aria-hidden="true">{statusLabels[status]}</small>
    </button>
  );
}

function SummaryCard({ title, value }: { title: string; value: unknown }) {
  const empty =
    value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  return (
    <article className="result-card" aria-label={title}>
      <h3>{title.replace(" 结果", "")}</h3>
      {empty ? <p>等待上一步生成。</p> : <ReadableValue value={value} />}
    </article>
  );
}

function ReadableValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <ul className="readable-list">
        {value.map((item, index) => (
          <li key={String((item as { id?: string }).id ?? index)}>
            {formatValue(item)}
          </li>
        ))}
      </ul>
    );
  }
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function formatValue(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return String(value);
  }
  const item = value as Record<string, unknown>;
  const summary = [
    item.type,
    item.label ?? item.name ?? item.reason ?? item.assertion ?? item.url,
    item.status,
    item.id
  ]
    .filter(Boolean)
    .join(" · ");
  return summary || JSON.stringify(item);
}

function IconBadge({ label }: { label: string }) {
  return (
    <span className="icon-badge" aria-hidden="true">
      {label}
    </span>
  );
}

function groupAssets(assets: AssetResult[]) {
  return assets.reduce<Record<string, AssetResult[]>>((groups, asset) => {
    groups[asset.type] = groups[asset.type] ?? [];
    groups[asset.type].push(asset);
    return groups;
  }, {});
}
