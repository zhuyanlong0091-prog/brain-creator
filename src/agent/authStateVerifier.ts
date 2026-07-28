import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

export type AuthStateVerification = {
  status: "valid" | "expired" | "unavailable";
  finalUrl?: string;
  reason?: string;
};

export type AuthStateVerifier = (input: {
  storageStatePath: string;
  targetUrl: string;
  allowedUrls: string[];
  timeoutMs?: number;
}) => Promise<AuthStateVerification>;

export const verifyStoredBrowserAuth: AuthStateVerifier = async (input) => {
  try {
    await access(input.storageStatePath);
  } catch {
    return {
      status: "expired",
      reason: "Stored browser authentication file is missing."
    };
  }

  const executablePath = browserExecutablePath();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {})
    });
    const context = await browser.newContext({ storageState: input.storageStatePath });
    const page = await context.newPage();
    await page.goto(input.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: input.timeoutMs ?? 15_000
    });
    await page.waitForTimeout(1_000);

    const finalUrl = page.url();
    const final = new URL(finalUrl);
    const allowedOrigins = new Set(
      [input.targetUrl, ...input.allowedUrls].map((url) => new URL(url).origin)
    );
    const loginFormVisible = await page
      .locator('input[type="password"]')
      .first()
      .isVisible()
      .catch(() => false);
    const loginRoute = /(?:^|\/)(?:login|sign-in|signin|sso|cas)(?:\/|$)/i.test(final.pathname);

    await context.close();
    if (!allowedOrigins.has(final.origin) || loginFormVisible || loginRoute) {
      return {
        status: "expired",
        finalUrl,
        reason: "Stored browser authentication redirected to a login page."
      };
    }
    return { status: "valid", finalUrl };
  } catch (error) {
    return {
      status: "unavailable",
      reason: `Stored browser authentication could not be verified: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
};

export function browserExecutablePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    process.platform === "win32"
      ? `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    process.platform === "win32"
      ? `${
          process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"
        }\\Microsoft\\Edge\\Application\\msedge.exe`
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
    process.platform === "linux" ? "/usr/bin/chromium" : undefined
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}
