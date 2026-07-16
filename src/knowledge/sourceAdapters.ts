import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import AdmZip from "adm-zip";
import { PDFParse } from "pdf-parse";
import type {
  RequirementContentBlock,
  RequirementContentPackage,
  RequirementSourceType
} from "../domain/types.js";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

type ReadySource = { status: "ready"; contentPackage: RequirementContentPackage };
type HostConnectorSource = {
  status: "needs-host-connector";
  connector: "feishu";
  request: {
    source: string;
    sourceType: "feishu";
    requiredOutput: "RequirementContentPackage";
    instructions: string;
  };
};

export type RequirementSourceReader = {
  readRequirement(source: string): Promise<RequirementContentPackage>;
};

type SourceAdapterOptions = {
  baseDir?: string;
  fetcher?: typeof fetch;
  allowPrivateNetwork?: boolean;
  maxBytes?: number;
  pdfTextExtractor?: (data: Buffer) => Promise<{ text: string; warnings: string[] }>;
  feishuReader?: RequirementSourceReader;
};

export async function resolveRequirementSource(
  input: { source: string; contentPackage?: RequirementContentPackage },
  options: SourceAdapterOptions = {}
): Promise<ReadySource | HostConnectorSource> {
  if (input.contentPackage) {
    validateContentPackage(input.source, input.contentPackage);
    return { status: "ready", contentPackage: input.contentPackage };
  }

  const source = normalizeReference(input.source);
  if (isFeishuUrl(source)) {
    if (options.feishuReader) {
      const contentPackage = await options.feishuReader.readRequirement(source);
      validateContentPackage(source, contentPackage);
      return { status: "ready", contentPackage };
    }
    return {
      status: "needs-host-connector",
      connector: "feishu",
      request: {
        source,
        sourceType: "feishu",
        requiredOutput: "RequirementContentPackage",
        instructions:
          "Read the Feishu Wiki/Doc with the host lark capability and submit title, content, blocks, attachments, source URL, updatedAt, contentHash, and warnings."
      }
    };
  }
  if (/^https?:\/\//i.test(source)) {
    return { status: "ready", contentPackage: await readHttpSource(source, options) };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) {
    throw new Error(`Unsupported requirement source protocol: ${source}`);
  }
  return { status: "ready", contentPackage: await readLocalSource(source, input.source, options) };
}

async function readLocalSource(source: string, original: string, options: SourceAdapterOptions) {
  const path = resolve(options.baseDir ?? process.cwd(), source);
  const fileStat = await stat(path).catch(() => undefined);
  if (!fileStat?.isFile()) throw new Error(`Unsupported requirement source: ${original}`);
  assertSize(fileStat.size, options.maxBytes);
  const data = await readFile(path);
  const extension = extname(path).toLowerCase();
  let content = "";
  let warnings: string[] = [];
  if ([".md", ".markdown", ".txt"].includes(extension)) {
    content = data.toString("utf8");
  } else if (extension === ".docx") {
    content = readDocx(data);
  } else if (extension === ".pdf") {
    const result = await (options.pdfTextExtractor ?? extractPdfText)(data);
    content = result.text;
    warnings = result.warnings;
  } else {
    throw new Error(`Unsupported requirement source extension: ${extension || "none"}`);
  }
  return packageContent({
    title: titleFromText(content, basename(path, extension)),
    content,
    source: original,
    sourceType: original.startsWith("obsidian:") || original.startsWith("[[") ? "obsidian" : "local-file",
    warnings
  });
}

async function readHttpSource(source: string, options: SourceAdapterOptions) {
  const url = new URL(source);
  if (!options.allowPrivateNetwork && isPrivateHost(url.hostname)) {
    throw new Error("Private network requirement URLs require explicit allowPrivateNetwork authorization");
  }
  const response = await (options.fetcher ?? fetch)(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "text/html,text/plain,application/json" }
  });
  if (!response.ok) throw new Error(`Requirement URL returned HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > 0) assertSize(declaredLength, options.maxBytes);
  const raw = await response.text();
  assertSize(Buffer.byteLength(raw), options.maxBytes);
  const contentType = response.headers.get("content-type") ?? "";
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1];
  const content = contentType.includes("html") || /<html/i.test(raw) ? htmlToText(raw) : raw;
  return packageContent({
    title: decodeEntities(title?.trim() || titleFromText(content, url.hostname)),
    content,
    source,
    sourceType: "http",
    warnings: []
  });
}

function packageContent(input: {
  title: string;
  content: string;
  source: string;
  sourceType: RequirementSourceType;
  warnings: string[];
}): RequirementContentPackage {
  const content = input.content.replace(/\r\n/g, "\n").trim();
  if (!content) throw new Error("Requirement source contains no readable text");
  return {
    title: input.title,
    content,
    blocks: blocksFromText(content),
    attachments: [],
    source: input.source,
    sourceType: input.sourceType,
    contentHash: createHash("sha256").update(content).digest("hex"),
    warnings: input.warnings
  };
}

function readDocx(data: Buffer) {
  const xml = new AdmZip(data).getEntry("word/document.xml")?.getData().toString("utf8");
  if (!xml) throw new Error("DOCX word/document.xml is missing");
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => decodeEntities(line).trim())
    .filter(Boolean)
    .join("\n");
}

async function extractPdfText(data: Buffer) {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return { text: result.text, warnings: [] };
  } finally {
    await parser.destroy();
  }
}

function blocksFromText(content: string): RequirementContentBlock[] {
  return content
    .split(/\n{2,}|\n(?=#{1,6}\s)/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const heading = /^(#{1,6})\s+(.+)$/.exec(text);
      return heading
        ? { type: "heading", level: heading[1].length, text: heading[2].trim() }
        : { type: "paragraph", text };
    });
}

function htmlToText(value: string) {
  return decodeEntities(
    value
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/?(h[1-6]|p|div|li|tr|br)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim()
  );
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function titleFromText(content: string, fallback: string) {
  return /^(?:#{1,6}\s+)?([^\n]{2,120})/m.exec(content)?.[1]?.trim() || fallback;
}

function normalizeReference(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("obsidian:")) return trimmed.slice("obsidian:".length).trim();
  if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) return trimmed.slice(2, -2).trim();
  return trimmed;
}

function validateContentPackage(source: string, contentPackage: RequirementContentPackage) {
  if (!contentPackage.title.trim() || !contentPackage.content.trim()) {
    throw new Error("Host content package requires title and content");
  }
  if (contentPackage.source !== source) {
    throw new Error("Host content package source does not match the requested source");
  }
}

function isFeishuUrl(source: string) {
  if (!/^https?:\/\//i.test(source)) return false;
  const hostname = new URL(source).hostname.toLowerCase();
  return hostname.endsWith(".feishu.cn") || hostname.endsWith(".larksuite.com");
}

function isPrivateHost(hostname: string) {
  const value = hostname.toLowerCase();
  return (
    value === "localhost" ||
    value === "::1" ||
    /^127\./.test(value) ||
    /^10\./.test(value) ||
    /^192\.168\./.test(value) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(value)
  );
}

function assertSize(size: number, configured?: number) {
  const max = configured ?? MAX_SOURCE_BYTES;
  if (size > max) throw new Error(`Requirement source exceeds ${max} bytes`);
}
