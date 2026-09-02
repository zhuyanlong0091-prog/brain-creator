import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import AdmZip from "adm-zip";
import { PDFParse } from "pdf-parse";
import type {
  RequirementContentBlock,
  RequirementContentPackage,
  RequirementAttachment,
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
  downloadAttachment?(attachment: RequirementAttachment): Promise<{ data: Buffer; mimeType?: string }>;
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
    const contentPackage = normalizeContentPackage(input.source, input.contentPackage);
    validateContentPackage(input.source, contentPackage);
    return { status: "ready", contentPackage };
  }

  const source = normalizeReference(input.source);
  if (isFeishuUrl(source)) {
    if (options.feishuReader) {
      const contentPackage = normalizeContentPackage(source, await options.feishuReader.readRequirement(source));
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
  let blocks: RequirementContentBlock[] | undefined;
  let warnings: string[] = [];
  let attachments: RequirementAttachment[] = [];
  if ([".md", ".markdown", ".txt"].includes(extension)) {
    content = data.toString("utf8");
    blocks = blocksFromText(content, original);
    if (extension !== ".txt") {
      attachments = markdownAttachments(content, dirname(path));
      await hashLocalAttachments(attachments, options.maxBytes);
    }
  } else if (extension === ".docx") {
    const result = readDocx(data, path);
    content = result.content;
    blocks = result.blocks;
    attachments = result.attachments;
  } else if (extension === ".pdf") {
    const result = await (options.pdfTextExtractor ?? extractPdfText)(data);
    content = result.text;
    warnings = result.warnings;
    attachments = [{
      name: basename(path),
      mimeType: "application/pdf",
      containerPath: path,
      status: "discovered",
      attempts: 0
    }];
  } else {
    throw new Error(`Unsupported requirement source extension: ${extension || "none"}`);
  }
  return packageContent({
    title: titleFromText(content, basename(path, extension)),
    content,
    source: original,
    sourceType: original.startsWith("obsidian:") || original.startsWith("[[") ? "obsidian" : "local-file",
    warnings,
    blocks,
    attachments,
    hashMaterial: Buffer.concat([
      data,
      Buffer.from(attachments.map((attachment) => attachment.contentHash ?? attachment.url ?? "").join("\n"))
    ])
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
  const attachments = htmlAttachments(raw, url);
  const content = contentType.includes("html") || /<html/i.test(raw) ? htmlToText(raw) : raw;
  const blocks = contentType.includes("html") || /<html/i.test(raw)
    ? blocksFromHtml(raw, source)
    : blocksFromText(content, source);
  return packageContent({
    title: decodeEntities(title?.trim() || titleFromText(content, url.hostname)),
    content,
    source,
    sourceType: "http",
    warnings: [],
    blocks,
    attachments,
    hashMaterial: raw
  });
}

function packageContent(input: {
  title: string;
  content: string;
  source: string;
  sourceType: RequirementSourceType;
  warnings: string[];
  blocks?: RequirementContentBlock[];
  attachments?: RequirementAttachment[];
  hashMaterial?: Buffer | string;
}): RequirementContentPackage {
  const content = input.content.replace(/\r\n/g, "\n").trim();
  if (!content) throw new Error("Requirement source contains no readable text");
  return {
    title: input.title,
    content,
    blocks: input.blocks ?? blocksFromText(content, input.source),
    attachments: input.attachments ?? [],
    source: input.source,
    sourceType: input.sourceType,
    contentHash: createHash("sha256").update(input.hashMaterial ?? content).digest("hex"),
    warnings: input.warnings
  };
}

function readDocx(data: Buffer, path: string) {
  const zip = new AdmZip(data);
  const xml = zip.getEntry("word/document.xml")?.getData().toString("utf8");
  if (!xml) throw new Error("DOCX word/document.xml is missing");
  const attachments = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.startsWith("word/media/"))
    .map((entry) => ({
      name: basename(entry.entryName),
      mimeType: mimeTypeFromName(entry.entryName),
      containerPath: path,
      containerEntry: entry.entryName,
      status: "discovered" as const,
      attempts: 0
    }));
  const blocks: RequirementContentBlock[] = [];
  const body = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i.exec(xml)?.[1] ?? xml;
  const items = body.match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/gi) ?? [];
  for (const item of items) {
    if (/^<w:tbl\b/i.test(item)) {
      const table = docxTable(item);
      if (table.headers.length === 0 && table.rows.length === 0) continue;
      blocks.push(makeBlock("table", [table.headers.join(" | "), ...table.rows.map((row) => row.join(" | "))].join("\n"), path, blocks.length + 1, {
        table
      }));
      continue;
    }
    const text = docxParagraphText(item);
    if (!text) continue;
    const heading = /<w:pStyle\b[^>]*w:val=["'](?:Heading|heading)([1-9])["']/i.exec(item);
    blocks.push(makeBlock(
      heading ? "heading" : "paragraph",
      text,
      path,
      blocks.length + 1,
      heading ? { level: Number(heading[1]) } : undefined
    ));
  }
  for (const attachment of attachments) {
    const reference = attachment.containerEntry ?? attachment.name;
    blocks.push(makeBlock("image", attachment.name, path, blocks.length + 1, {
      image: { reference },
      sourceRefOverride: `${path}#media:${reference}`
    }));
  }
  const content = blocks
    .filter((block) => block.type !== "image")
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n");
  return { content, blocks: orderBlocks(blocks), attachments };
}

function docxParagraphText(value: string) {
  return [...value.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/gi)]
    .map((match) => match[0].startsWith("<w:tab") ? "\t" : match[0].startsWith("<w:br") ? "\n" : decodeEntities(match[1]))
    .join("")
    .trim();
}

function docxTable(value: string) {
  const rows = [...value.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi)].map((row) =>
    [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi)].map((cell) => docxParagraphText(cell[1]))
  );
  return { headers: rows[0] ?? [], rows: rows.slice(1) };
}

function markdownAttachments(content: string, baseDir: string): RequirementAttachment[] {
  return [...content.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)].map(
    (match, index) => {
      const reference = match[2].trim();
      const url = /^https?:\/\//i.test(reference)
        ? reference
        : isAbsolute(reference)
          ? reference
          : resolve(baseDir, reference);
      return {
        name: match[1].trim() || basename(reference) || `image-${index + 1}`,
        url,
        mimeType: mimeTypeFromName(reference),
        status: "discovered",
        attempts: 0
      };
    }
  );
}

async function hashLocalAttachments(attachments: RequirementAttachment[], maxBytes?: number) {
  await Promise.all(attachments.map(async (attachment) => {
    if (!attachment.url || /^https?:\/\//i.test(attachment.url)) return;
    const fileStat = await stat(attachment.url).catch(() => undefined);
    if (!fileStat?.isFile()) return;
    assertSize(fileStat.size, maxBytes);
    const data = await readFile(attachment.url);
    attachment.contentHash = createHash("sha256").update(data).digest("hex");
  }));
}

function htmlAttachments(raw: string, source: URL): RequirementAttachment[] {
  return [...raw.matchAll(/<img\b([^>]*)>/gi)].flatMap((match, index) => {
    const attributes = match[1];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
    if (!src) return [];
    const resolved = new URL(src, source);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return [];
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1]?.trim();
    return [{
      name: alt || basename(resolved.pathname) || `image-${index + 1}`,
      url: resolved.toString(),
      mimeType: mimeTypeFromName(resolved.pathname),
      status: "discovered" as const,
      attempts: 0
    }];
  });
}

function mimeTypeFromName(value: string) {
  const extension = extname(value.split(/[?#]/, 1)[0]).toLowerCase();
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml"
  } as Record<string, string>)[extension];
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

function blocksFromText(content: string, source = "requirement") {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: RequirementContentBlock[] = [];
  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trim();
    if (!line) {
      lineIndex += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(makeBlock("heading", heading[2].trim(), source, lineIndex + 1, { level: heading[1].length }));
      lineIndex += 1;
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)$/.exec(line);
    if (image) {
      blocks.push(makeBlock("image", image[1].trim() || image[2].trim(), source, lineIndex + 1, {
        image: { alt: image[1].trim(), reference: image[2].trim() }
      }));
      lineIndex += 1;
      continue;
    }
    if (isMarkdownTableRow(line) && isMarkdownTableSeparator(lines[lineIndex + 1]?.trim() ?? "")) {
      const headers = splitMarkdownTableRow(line);
      const rows: string[][] = [];
      const tableLine = lineIndex + 1;
      lineIndex += 2;
      while (lineIndex < lines.length && isMarkdownTableRow(lines[lineIndex].trim())) {
        rows.push(splitMarkdownTableRow(lines[lineIndex].trim()));
        lineIndex += 1;
      }
      blocks.push(makeBlock("table", [headers.join(" | "), ...rows.map((row) => row.join(" | "))].join("\n"), source, tableLine, {
        table: { headers, rows }
      }));
      continue;
    }
    if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) {
      blocks.push(makeBlock("list-item", line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, ""), source, lineIndex + 1));
      lineIndex += 1;
      continue;
    }
    const start = lineIndex;
    const paragraph: string[] = [];
    while (lineIndex < lines.length && lines[lineIndex].trim()) {
      const current = lines[lineIndex].trim();
      if (paragraph.length > 0 && (/^#{1,6}\s+/.test(current) || /^!\[/.test(current) || isMarkdownTableRow(current))) break;
      paragraph.push(current);
      lineIndex += 1;
    }
    blocks.push(makeBlock("paragraph", paragraph.join(" "), source, start + 1));
  }
  return orderBlocks(blocks);
}

function blocksFromHtml(value: string, source: string) {
  const blocks: RequirementContentBlock[] = [];
  const clean = value.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");
  const tokens = clean.match(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>|<p\b[^>]*>[\s\S]*?<\/p>|<li\b[^>]*>[\s\S]*?<\/li>|<table\b[^>]*>[\s\S]*?<\/table>|<img\b[^>]*\/?\s*>/gi) ?? [];
  for (const token of tokens) {
    const line = clean.slice(0, clean.indexOf(token) + token.length).split("\n").length;
    const heading = /^<h([1-6])\b[^>]*>([\s\S]*?)<\/h[1-6]>$/i.exec(token);
    if (heading) {
      blocks.push(makeBlock("heading", htmlInlineText(heading[2]), source, line, { level: Number(heading[1]) }));
      continue;
    }
    const paragraph = /^<p\b[^>]*>([\s\S]*?)<\/p>$/i.exec(token);
    if (paragraph) {
      const text = htmlInlineText(paragraph[1]);
      if (text) blocks.push(makeBlock("paragraph", text, source, line));
      continue;
    }
    const listItem = /^<li\b[^>]*>([\s\S]*?)<\/li>$/i.exec(token);
    if (listItem) {
      const text = htmlInlineText(listItem[1]);
      if (text) blocks.push(makeBlock("list-item", text, source, line));
      continue;
    }
    const table = /^<table\b[^>]*>([\s\S]*?)<\/table>$/i.exec(token);
    if (table) {
      const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
        [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => htmlInlineText(cell[1]))
      );
      if (rows.length > 0) {
        blocks.push(makeBlock("table", rows.map((row) => row.join(" | ")).join("\n"), source, line, {
          table: { headers: rows[0], rows: rows.slice(1) }
        }));
      }
      continue;
    }
    const image = /^<img\b([^>]*)>/i.exec(token);
    if (image) {
      const reference = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(image[1])?.[1];
      if (reference) {
        const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(image[1])?.[1]?.trim() ?? "";
        blocks.push(makeBlock("image", alt || reference, source, line, {
          image: { alt, reference }
        }));
      }
    }
  }
  return blocks.length > 0 ? orderBlocks(blocks) : blocksFromText(htmlToText(clean), source);
}

function orderBlocks(blocks: RequirementContentBlock[]) {
  return blocks.map((block, order) => ({ ...block, order }));
}

function makeBlock(
  type: string,
  text: string,
  source: string,
  line: number,
  extra: {
    level?: number;
    table?: { headers: string[]; rows: string[][] };
    image?: { alt?: string; reference?: string; attachmentId?: string };
    sourceRefOverride?: string;
  } = {}
): RequirementContentBlock {
  const sourceRef = extra.sourceRefOverride ?? `${source}#line:${Math.max(1, line)}`;
  return {
    id: `block-${line}-${type}`,
    type,
    text,
    ...(extra.level === undefined ? {} : { level: extra.level }),
    order: line - 1,
    sourceRef,
    sourceRefs: [sourceRef],
    ...(extra.table ? { table: extra.table } : {}),
    ...(extra.image ? { image: extra.image } : {})
  };
}

function htmlInlineText(value: string) {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim());
}

function isMarkdownTableRow(value: string) {
  return /^\|.*\|$/.test(value);
}

function isMarkdownTableSeparator(value: string) {
  return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(value);
}

function splitMarkdownTableRow(value: string) {
  return value.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
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

function normalizeContentPackage(source: string, contentPackage: RequirementContentPackage): RequirementContentPackage {
  return {
    ...contentPackage,
    blocks: contentPackage.blocks.map((block, index) => {
      const sourceRef = block.sourceRef ?? block.sourceRefs?.[0] ?? `${source}#block:${index + 1}`;
      return {
        ...block,
        order: block.order ?? index,
        sourceRef,
        sourceRefs: block.sourceRefs?.length ? block.sourceRefs : [sourceRef]
      };
    })
  };
}

function isFeishuUrl(source: string) {
  if (!/^https?:\/\//i.test(source)) return false;
  const hostname = new URL(source).hostname.toLowerCase();
  return hostname.endsWith(".feishu.cn") || hostname.endsWith(".larksuite.com") || hostname.endsWith(".larkenterprise.com");
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
