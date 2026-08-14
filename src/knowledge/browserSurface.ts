import type { BrowserSurfaceEvidence } from "../domain/types.js";

type PlaywrightPage = import("@playwright/test").Page;

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

  const childFrames = page.frames().filter((frame) => frame !== page.mainFrame());
  for (const [frameIndex, frame] of childFrames.entries()) {
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
