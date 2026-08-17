import type { BrowserSurfaceEvidence, InteractionSurfaceRef } from "../domain/types.js";

type PlaywrightPage = import("@playwright/test").Page;

export type BrowserChildFrameEntry = {
  frame: import("@playwright/test").Frame;
  /** Ordinal among all non-main frames, before allowlist filtering. */
  frameIndex: number;
};

export function stableChildFrameEntries(page: PlaywrightPage): BrowserChildFrameEntry[] {
  return page
    .frames()
    .filter((frame) => frame !== page.mainFrame() && Boolean(frame.url()))
    .map((frame, frameIndex) => ({ frame, frameIndex }));
}

export async function capturePopupSurfaceEvidence(
  popup: PlaywrightPage,
  parentUrl: string,
  screenshotPath: string
): Promise<BrowserSurfaceEvidence> {
  const title = await popup.title().catch(() => "");
  const domText = (await popup.locator("body").innerText().catch(() => "")).slice(0, 20_000);
  const interactiveCount = await popup
    .locator(
      'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="textbox"], [role="combobox"]'
    )
    .count()
    .catch(() => 0);
  const screenshot = await popup
    .screenshot({ path: screenshotPath, fullPage: true })
    .then(() => screenshotPath)
    .catch(() => undefined);
  return {
    kind: "popup",
    url: popup.url(),
    parentUrl,
    accessible: true,
    interactiveCount,
    ...(title ? { title } : {}),
    ...(domText ? { domText } : {}),
    ...(screenshot ? { screenshotPath: screenshot } : {}),
    evidence: "Popup opened by a safe interaction"
  };
}

export async function collectBrowserSurfaceEvidence(
  page: import("@playwright/test").Page,
  allowedUrls: string[]
): Promise<BrowserSurfaceEvidence[]> {
  const mainUrl = page.url();
  const surfaces: BrowserSurfaceEvidence[] = [{
    kind: "document",
    url: mainUrl,
    accessible: true,
    interactiveCount: await interactiveCount(page).catch(() => 0)
  }];

  for (const { frame, frameIndex } of stableChildFrameEntries(page)) {
    const url = frame.url() || mainUrl;
    const accessible = isAllowedUrl(url, allowedUrls);
    surfaces.push({
      kind: "iframe",
      url,
      parentUrl: mainUrl,
      frameIndex,
      accessible,
      interactiveCount: accessible ? await interactiveCount(frame).catch(() => 0) : 0,
      evidence: accessible ? undefined : "Frame URL is outside the system allowlist"
    });
  }

  const roots = await page.evaluate(() => {
    const root = (globalThis as unknown as {
      document: {
        querySelectorAll(selector: string): ArrayLike<{ shadowRoot?: unknown; matches(selector: string): boolean }>;
      };
    }).document;
    const elements = Array.from(root.querySelectorAll("*"));
    return {
      shadowRoots: elements.filter((element) => Boolean(element.shadowRoot)).length,
      wujie: elements.filter((element) => element.matches("[data-wujie], wujie-app, [class*='wujie']")).length
    };
  }).catch(() => ({ shadowRoots: 0, wujie: 0 }));
  const shadowInteractiveCount = await page
    .locator(
      'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="textbox"], [role="combobox"]'
    )
    .evaluateAll((elements) =>
      elements.filter((element) => element.getRootNode().toString() === "[object ShadowRoot]").length
    )
    .catch(() => 0);
  if (roots.shadowRoots > 0 || shadowInteractiveCount > 0) {
    surfaces.push({
      kind: "shadow-root",
      url: mainUrl,
      parentUrl: mainUrl,
      accessible: true,
      interactiveCount: shadowInteractiveCount || await interactiveCount(page).catch(() => 0),
      evidence: `${Math.max(roots.shadowRoots, shadowInteractiveCount > 0 ? 1 : 0)} open shadow root(s) detected`
    });
  }
  if (roots.wujie > 0) {
    surfaces.push({
      kind: "wujie",
      url: mainUrl,
      parentUrl: mainUrl,
      accessible: true,
      interactiveCount: await interactiveCount(page).catch(() => 0),
      evidence: `${roots.wujie} Wujie-like container(s) detected`
    });
  }
  return surfaces;
}

async function interactiveCount(surface: import("@playwright/test").Page | import("@playwright/test").Frame) {
  return surface.locator(
    'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="textbox"], [role="combobox"]'
  ).count();
}

function isAllowedUrl(candidate: string, allowedUrls: string[]) {
  try {
    const url = new URL(candidate);
    return allowedUrls.some((allowed) => {
      const scope = new URL(allowed);
      return scope.origin === url.origin &&
        (scope.pathname === "/" || url.pathname === scope.pathname || url.pathname.startsWith(`${scope.pathname}/`));
    });
  } catch {
    return false;
  }
}

export type SurfaceRecoveryOperationResult = {
  status: "recovered" | "failed" | "blocked";
  url?: string;
  reason?: string;
  evidenceRefs?: string[];
};

export type BrowserSurfaceRecoveryOperations = {
  recoverDocument?: (surface: InteractionSurfaceRef) => Promise<SurfaceRecoveryOperationResult>;
  recoverIframe?: (surface: InteractionSurfaceRef) => Promise<SurfaceRecoveryOperationResult>;
  recoverPopup?: (surface: InteractionSurfaceRef) => Promise<SurfaceRecoveryOperationResult>;
  recoverEmbedded?: (surface: InteractionSurfaceRef) => Promise<SurfaceRecoveryOperationResult>;
};

export type BrowserSurfaceRecoveryInput = {
  surface: InteractionSurfaceRef;
  currentUrl: string;
  allowedUrls: string[];
  maxAttempts?: number;
  operations: BrowserSurfaceRecoveryOperations;
};

export type BrowserSurfaceRecoveryResult = {
  status: "recovered" | "failed" | "blocked";
  surface?: InteractionSurfaceRef;
  attempts: number;
  reason?: string;
  gapRequired: boolean;
  evidenceRefs: string[];
};

/**
 * Reacquires the requested browser surface without silently replacing a child
 * surface with the main document. Cross-origin or unsupported surfaces are
 * explicit blockers so callers can create a Gap with the original evidence.
 */
export async function recoverBrowserSurface(
  input: BrowserSurfaceRecoveryInput
): Promise<BrowserSurfaceRecoveryResult> {
  const surfaceUrl = input.surface.url || input.currentUrl;
  if (!isAllowedUrl(surfaceUrl, input.allowedUrls)) {
    return {
      status: "blocked",
      attempts: 0,
      reason: "Surface URL is outside the system allowlist; cross-origin recovery requires explicit approval.",
      gapRequired: true,
      evidenceRefs: []
    };
  }

  const operation = surfaceOperation(input.operations, input.surface.kind);
  if (!operation) {
    return {
      status: "blocked",
      attempts: 0,
      reason: `No recovery operation is registered for ${input.surface.kind} surface.`,
      gapRequired: true,
      evidenceRefs: []
    };
  }

  const maxAttempts = Math.max(1, Math.min(5, input.maxAttempts ?? 2));
  let lastReason = "Surface recovery failed.";
  let attempts = 0;
  const evidenceRefs: string[] = [];
  for (; attempts < maxAttempts; attempts += 1) {
    const result = await operation(input.surface);
    evidenceRefs.push(...(result.evidenceRefs ?? []));
    if (result.status === "recovered") {
      return {
        status: "recovered",
        surface: { ...input.surface, ...(result.url ? { url: result.url } : {}) },
        attempts: attempts + 1,
        gapRequired: false,
        evidenceRefs: [...new Set(evidenceRefs)]
      };
    }
    if (result.status === "blocked") {
      return {
        status: "blocked",
        attempts: attempts + 1,
        reason: result.reason ?? "Surface recovery was blocked by policy.",
        gapRequired: true,
        evidenceRefs: [...new Set(evidenceRefs)]
      };
    }
    lastReason = result.reason ?? lastReason;
  }
  return {
    status: "failed",
    attempts,
    reason: lastReason,
    gapRequired: true,
    evidenceRefs: [...new Set(evidenceRefs)]
  };
}

function surfaceOperation(
  operations: BrowserSurfaceRecoveryOperations,
  kind: InteractionSurfaceRef["kind"]
) {
  if (kind === "document") return operations.recoverDocument;
  if (kind === "iframe") return operations.recoverIframe;
  if (kind === "popup") return operations.recoverPopup;
  return operations.recoverEmbedded;
}
