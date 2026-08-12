import type { BrowserSurfaceEvidence } from "../domain/types.js";

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

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const url = frame.url() || mainUrl;
    const accessible = isAllowedUrl(url, allowedUrls);
    surfaces.push({
      kind: "iframe",
      url,
      parentUrl: mainUrl,
      accessible,
      interactiveCount: accessible ? await interactiveCount(frame).catch(() => 0) : 0,
      evidence: accessible ? undefined : "Frame URL is outside the system allowlist"
    });
  }

  const roots = await page.evaluate(() => {
    const root = (globalThis as unknown as {
      document: {
        querySelectorAll(selector: string): ArrayLike<{ shadowRoot?: unknown }>;
      };
    }).document;
    const elements = Array.from(root.querySelectorAll("*"));
    return {
      shadowRoots: elements.filter((element) => Boolean(element.shadowRoot)).length,
      wujie: root.querySelectorAll("[data-wujie], wujie-app, [class*='wujie']").length
    };
  }).catch(() => ({ shadowRoots: 0, wujie: 0 }));
  if (roots.shadowRoots > 0) {
    surfaces.push({
      kind: "shadow-root",
      url: mainUrl,
      parentUrl: mainUrl,
      accessible: true,
      interactiveCount: await interactiveCount(page).catch(() => 0),
      evidence: `${roots.shadowRoots} open shadow root(s) detected`
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
