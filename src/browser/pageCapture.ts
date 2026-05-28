import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

export type CapturedInteractiveElement = {
  name: string;
  role: string;
  text: string;
  selector: string;
};

export type PageCaptureResult = {
  title: string;
  finalUrl: string;
  domText: string;
  screenshotPath: string;
  interactiveElements: CapturedInteractiveElement[];
  consoleErrors: string[];
  networkFailures: string[];
  issues: string[];
};

export type PageCaptureInput = {
  targetUrl: string;
  screenshotDir?: string;
  auth?: PageCaptureAuth;
};

export type PageCaptureAuth = {
  loginMethod: "password" | "cookie" | "token" | "script";
  secrets: Record<string, string>;
};

const defaultChromiumExecutable =
  "C:\\Users\\28917\\AppData\\Local\\ms-playwright\\chromium-1194\\chrome-win\\chrome.exe";

export async function capturePageEvidence(input: PageCaptureInput): Promise<PageCaptureResult> {
  const screenshotDir = input.screenshotDir ?? join(process.cwd(), ".brain-creator", "screenshots");
  await mkdir(screenshotDir, { recursive: true });
  const screenshotPath = join(screenshotDir, `capture-${Date.now()}.png`);
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? defaultChromiumExecutable
  });

  try {
    const context = await browser.newContext({
      extraHTTPHeaders:
        input.auth?.loginMethod === "token" && input.auth.secrets.token
          ? { authorization: `Bearer ${input.auth.secrets.token}` }
          : undefined
    });
    if (input.auth?.loginMethod === "cookie" && input.auth.secrets.cookie) {
      await context.addCookies(parseCookieHeader(input.auth.secrets.cookie, input.targetUrl));
    }
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("requestfailed", (request) => {
      networkFailures.push(`${request.method()} ${request.url()}`);
    });

    await page.goto(input.targetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const [title, domText, interactiveElements] = await Promise.all([
      page.title(),
      page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""),
      page.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            [
              "button",
              "a[href]",
              "input",
              "textarea",
              "select",
              "[role='button']",
              "[data-brain-label]"
            ].join(",")
          )
        );

        return candidates
          .map((element, index) => {
            const label =
              element.getAttribute("aria-label") ??
              element.innerText ??
              element.getAttribute("data-brain-label") ??
              element.getAttribute("placeholder") ??
              element.getAttribute("name") ??
              "";
            const name = label.trim();
            const tag = element.tagName.toLowerCase();
            const role =
              element.getAttribute("role") ??
              (tag === "a"
                ? "link"
                : tag === "input" || tag === "textarea"
                  ? "textbox"
                  : tag === "select"
                    ? "combobox"
                    : "button");
            const selector =
              element.getAttribute("data-brain-label")
                ? `[data-brain-label="${element.getAttribute("data-brain-label")}"]`
                : element.id
                  ? `#${element.id}`
                  : element.getAttribute("name")
                    ? `${tag}[name="${element.getAttribute("name")}"]`
                    : `${tag}:nth-of-type(${index + 1})`;

            return {
              name: name || `${role} ${index + 1}`,
              role,
              text: element.innerText?.trim() || name,
              selector
            };
          })
          .filter((element) => element.name.trim().length > 0);
      })
    ]);

    return {
      title,
      finalUrl: page.url(),
      domText,
      screenshotPath,
      interactiveElements,
      consoleErrors,
      networkFailures,
      issues: interactiveElements.length === 0 ? ["No interactive elements found"] : []
    };
  } finally {
    await browser.close();
  }
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
