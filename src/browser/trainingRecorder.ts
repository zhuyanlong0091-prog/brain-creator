import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import type { PageCaptureAuth } from "./pageCapture";
import type { ApiRequest } from "@/src/domain/types";

export type TrainingRecordInput = {
  targetUrl: string;
  artifactDir?: string;
  auth?: PageCaptureAuth;
  action: {
    type: string;
    selector: string;
    targetLocatorId: string;
    inputValue?: string;
    assertion: string;
  };
};

export type TrainingRecordResult = {
  traceUrl: string;
  harUrl: string;
  screenshotUrl: string;
  actionSteps: Array<{
    type: string;
    targetLocatorId: string;
    inputValue: string;
    assertion: string;
  }>;
  apiRequests: ApiRequest[];
};

const defaultChromiumExecutable =
  "C:\\Users\\28917\\AppData\\Local\\ms-playwright\\chromium-1194\\chrome-win\\chrome.exe";

export async function recordTrainingEvidence(
  input: TrainingRecordInput
): Promise<TrainingRecordResult> {
  const artifactDir = input.artifactDir ?? join(process.cwd(), ".brain-creator", "training");
  await mkdir(artifactDir, { recursive: true });
  const traceUrl = join(artifactDir, "trace.zip");
  const harUrl = join(artifactDir, "network.har");
  const screenshotUrl = join(artifactDir, "screenshot.png");
  const apiRequests: ApiRequest[] = [];
  const targetOrigin = new URL(input.targetUrl).origin;

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? defaultChromiumExecutable
  });

  try {
    const context = await browser.newContext({
      recordHar: {
        path: harUrl,
        content: "omit"
      },
      extraHTTPHeaders:
        input.auth?.loginMethod === "token" && input.auth.secrets.token
          ? { authorization: `Bearer ${input.auth.secrets.token}` }
          : undefined
    });
    if (input.auth?.loginMethod === "cookie" && input.auth.secrets.cookie) {
      await context.addCookies(parseCookieHeader(input.auth.secrets.cookie, input.targetUrl));
    }
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    page.on("response", (response) => {
      const request = response.request();
      if (request.resourceType() === "fetch" || request.resourceType() === "xhr") {
        apiRequests.push({
          method: request.method(),
          url: displayUrl(response.url(), targetOrigin),
          status: response.status()
        });
      }
    });

    await page.goto(input.targetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.click(input.action.selector, { timeout: 5_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: screenshotUrl, fullPage: true });
    await context.tracing.stop({ path: traceUrl });
    await context.close();
  } finally {
    await browser.close();
  }

  return {
    traceUrl,
    harUrl,
    screenshotUrl,
    actionSteps: [
      {
        type: input.action.type,
        targetLocatorId: input.action.targetLocatorId,
        inputValue: input.action.inputValue ?? "",
        assertion: input.action.assertion
      }
    ],
    apiRequests
  };
}

function displayUrl(url: string, targetOrigin: string) {
  const parsed = new URL(url);
  return parsed.origin === targetOrigin ? `${parsed.pathname}${parsed.search}` : url;
}

function parseCookieHeader(cookieHeader: string, targetUrl: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...valueParts] = part.split("=");
      return {
        name,
        value: valueParts.join("="),
        url: targetUrl
      };
    })
    .filter((cookie) => cookie.name && cookie.value);
}
