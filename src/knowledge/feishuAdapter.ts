import { createHash } from "node:crypto";
import type {
  RequirementAttachment,
  RequirementContentBlock,
  RequirementContentPackage
} from "../domain/types.js";

type FeishuAdapterOptions = {
  appId: string;
  appSecret: string;
  fetcher?: typeof fetch;
  baseUrl?: string;
};

type FeishuJson = Record<string, unknown> & { code?: number; msg?: string; data?: Record<string, unknown> };

const BLOCK_TYPES: Record<number, string> = {
  1: "page",
  2: "paragraph",
  3: "heading1",
  4: "heading2",
  5: "heading3",
  6: "heading4",
  7: "heading5",
  8: "heading6",
  9: "heading7",
  10: "heading8",
  11: "heading9",
  12: "bullet",
  13: "ordered",
  14: "code",
  15: "quote",
  17: "todo",
  18: "bitable",
  19: "callout",
  21: "diagram",
  23: "file",
  27: "image",
  29: "mindnote",
  30: "sheet",
  31: "table",
  40: "add-on"
};

export class FeishuOpenApiAdapter {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private cachedToken?: { value: string; expiresAt: number };

  constructor(private readonly options: FeishuAdapterOptions) {
    if (!options.appId || !options.appSecret) {
      throw new Error("Feishu App ID and App Secret are required");
    }
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://open.feishu.cn/open-apis").replace(/\/$/, "");
  }

  async readRequirement(source: string): Promise<RequirementContentPackage> {
    const target = parseFeishuSource(source);
    const accessToken = await this.tenantAccessToken();
    let documentId = target.token;
    let wikiTitle: string | undefined;
    if (target.type === "wiki") {
      const result = await this.requestJson(
        `${this.baseUrl}/wiki/v2/spaces/get_node?token=${encodeURIComponent(target.token)}`,
        { headers: authorizationHeaders(accessToken) }
      );
      const node = asRecord(asRecord(result.data).node);
      const objectType = stringValue(node.obj_type);
      if (objectType !== "docx") {
        throw new Error(`Feishu Wiki points to unsupported resource type: ${objectType || "unknown"}`);
      }
      documentId = stringValue(node.obj_token);
      wikiTitle = stringValue(node.title);
      if (!documentId) throw new Error("Feishu Wiki response is missing obj_token");
    }

    const documentResult = await this.requestJson(`${this.baseUrl}/docx/v1/documents/${documentId}`, {
      headers: authorizationHeaders(accessToken)
    });
    const document = asRecord(asRecord(documentResult.data).document);
    const title = stringValue(document.title) || wikiTitle || "Feishu Requirement";
    const revision = numberValue(document.revision_id);
    const items = await this.listBlocks(documentId, accessToken);
    const normalized = normalizeBlocks(items);
    const content = normalized.blocks.map((block) => block.text).filter(Boolean).join("\n").trim();
    if (!content) throw new Error("Feishu document contains no readable text blocks");
    return {
      title,
      content,
      blocks: normalized.blocks,
      attachments: normalized.attachments,
      source,
      sourceType: "feishu",
      contentHash: createHash("sha256").update(`${revision}:${content}`).digest("hex"),
      updatedAt: revision ? `revision:${revision}` : undefined,
      warnings: normalized.warnings
    };
  }

  async downloadAttachment(attachment: RequirementAttachment) {
    if (!attachment.fileToken) throw new Error("Feishu attachment is missing fileToken");
    const accessToken = await this.tenantAccessToken();
    const response = await this.fetcher(
      `${this.baseUrl}/drive/v1/medias/${encodeURIComponent(attachment.fileToken)}/download`,
      {
        headers: authorizationHeaders(accessToken),
        signal: AbortSignal.timeout(15_000)
      }
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) this.cachedToken = undefined;
      throw new Error(`Feishu media download failed: HTTP ${response.status}`);
    }
    return {
      data: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") ?? attachment.mimeType
    };
  }

  private async tenantAccessToken() {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.value;
    }
    const result = await this.requestJson(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: this.options.appId, app_secret: this.options.appSecret })
    });
    const token = stringValue(result.tenant_access_token);
    if (!token) throw new Error("Feishu token response is missing tenant_access_token");
    this.cachedToken = {
      value: token,
      expiresAt: Date.now() + Math.max(60, numberValue(result.expire) || 7200) * 1000
    };
    return token;
  }

  private async listBlocks(documentId: string, accessToken: string) {
    const items: Record<string, unknown>[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ page_size: "500" });
      if (pageToken) query.set("page_token", pageToken);
      const result = await this.requestJson(
        `${this.baseUrl}/docx/v1/documents/${documentId}/blocks?${query.toString()}`,
        { headers: authorizationHeaders(accessToken) }
      );
      const data = asRecord(result.data);
      const pageItems = Array.isArray(data.items) ? data.items.map(asRecord) : [];
      items.push(...pageItems);
      pageToken = data.has_more === true ? stringValue(data.page_token) : undefined;
    } while (pageToken);
    return items;
  }

  private async requestJson(url: string, init: RequestInit) {
    const response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const result = (await response.json().catch(() => ({}))) as FeishuJson;
    if (!response.ok || (typeof result.code === "number" && result.code !== 0)) {
      throw new Error(`Feishu OpenAPI failed: ${result.msg || `HTTP ${response.status}`}`);
    }
    return result;
  }
}

function normalizeBlocks(items: Record<string, unknown>[]) {
  const blocks: RequirementContentBlock[] = [];
  const attachments: RequirementAttachment[] = [];
  const warnings: string[] = [];
  for (const item of items) {
    const blockType = numberValue(item.block_type);
    const type = BLOCK_TYPES[blockType] ?? `unsupported-${blockType}`;
    const text = textRuns(item).join("").trim();
    if (text) {
      const headingLevel = type.startsWith("heading") ? Number(type.replace("heading", "")) : undefined;
      blocks.push({ type: headingLevel ? "heading" : type, text, level: headingLevel });
    }
    if (type === "file" || type === "image") {
      const detail = asRecord(item[type]);
      attachments.push({
        name: stringValue(item.block_id) || `${type}-${attachments.length + 1}`,
        blockId: stringValue(item.block_id) || undefined,
        fileToken: stringValue(detail.token) || stringValue(detail.file_token) || undefined,
        type,
        status: "discovered",
        attempts: 0
      });
    }
    if (["bitable", "diagram", "mindnote", "sheet", "table", "add-on"].includes(type)) {
      warnings.push(`Feishu ${type} block ${stringValue(item.block_id) || "unknown"} requires separate extraction`);
    }
    if (type.startsWith("unsupported-")) {
      warnings.push(`Feishu block type ${blockType} is unsupported`);
    }
  }
  return { blocks, attachments, warnings: [...new Set(warnings)] };
}

function textRuns(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(textRuns);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const own = asRecord(record.text_run).content;
  if (typeof own === "string") return [own];
  return Object.values(record).flatMap(textRuns);
}

function parseFeishuSource(source: string) {
  const url = new URL(source);
  if (!url.hostname.endsWith(".feishu.cn") && !url.hostname.endsWith(".larksuite.com")) {
    throw new Error("Not a Feishu or Lark document URL");
  }
  const match = /^\/(wiki|docx)\/([^/?#]+)/.exec(url.pathname);
  if (!match) throw new Error("Feishu source URL must contain /wiki/<token> or /docx/<token>");
  return { type: match[1] as "wiki" | "docx", token: match[2] };
}

function authorizationHeaders(accessToken: string) {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json; charset=utf-8"
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value) || 0;
}
