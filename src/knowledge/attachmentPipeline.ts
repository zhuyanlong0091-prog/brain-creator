import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import AdmZip from "adm-zip";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  AttachmentAnalysis,
  AttachmentAnalysisKind,
  Gap,
  RequirementAttachment,
  RequirementSource
} from "../domain/types.js";
import { id } from "../shared/id.js";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_ATTEMPTS = 3;

export type AttachmentAnalysisDraft = {
  kind: AttachmentAnalysisKind;
  markdown: string;
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: Array<{ from: string; to: string; condition?: string; actor?: string }>;
  confidence: number;
};

export type RequirementVisualAnalyzer = (input: {
  attachmentId: string;
  name: string;
  mimeType?: string;
  localPath: string;
  sourceRefs: string[];
}) => Promise<AttachmentAnalysisDraft>;

export type RequirementAttachmentDownloader = (
  attachment: RequirementAttachment
) => Promise<{ data: Buffer; mimeType?: string }>;

export class RequirementAttachmentPipeline {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly rootDir: string,
    private readonly sourceBaseDir = process.cwd()
  ) {}

  async prepare(input: {
    sourceId: string;
    attachmentIds?: string[];
    fetcher?: typeof fetch;
    downloader?: RequirementAttachmentDownloader;
    analyzer?: RequirementVisualAnalyzer;
  }) {
    const source = this.source(input.sourceId);
    const selected = source.attachments.filter(
      (attachment) =>
        !input.attachmentIds?.length ||
        (attachment.id !== undefined && input.attachmentIds.includes(attachment.id))
    );
    const analyses: AttachmentAnalysis[] = [];
    const recognitionRequests: Array<{
      attachmentId: string;
      name: string;
      mimeType?: string;
      localPath: string;
      requiredOutput: "AttachmentAnalysis";
      instructions: string;
      schema: {
        kinds: AttachmentAnalysisKind[];
        required: string[];
      };
      sourceRefs: string[];
    }> = [];
    const gaps: Gap[] = [];

    for (const attachment of selected) {
      if (!attachment.id) continue;
      if (attachment.status === "confirmed" || attachment.status === "structured") continue;
      if (!attachment.localPath || attachment.status === "failed" || attachment.status === "needs-auth") {
        const download = await this.downloadWithRetry(source, attachment, input.fetcher, input.downloader);
        if (!download.ok) {
          gaps.push(this.finalFailureGap(source, attachment, "download", download.reason));
          continue;
        }
      }
      if (!attachment.localPath) continue;
      const request = {
        attachmentId: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        localPath: attachment.localPath,
        requiredOutput: "AttachmentAnalysis" as const,
        instructions:
          "Treat the image or PDF as requirement content. Extract tables as Markdown and flows as typed nodes and edges without inventing missing labels.",
        schema: {
          kinds: ["table", "flowchart", "state-machine", "wireframe", "text-image", "other"] as AttachmentAnalysisKind[],
          required: ["kind", "markdown", "nodes", "edges", "confidence"]
        },
        sourceRefs: [`requirement-source:${source.id}`, `attachment:${attachment.id}`]
      };
      if (!input.analyzer) {
        recognitionRequests.push(request);
        continue;
      }
      let recognized = false;
      for (let attempt = 0; attempt < 2 && !recognized; attempt += 1) {
        attachment.status = "recognizing";
        attachment.recognitionAttempts = (attachment.recognitionAttempts ?? 0) + 1;
        this.repository.persist();
        try {
          const result = validateAnalysisDraft(await input.analyzer(request));
          analyses.push(this.submit({
            sourceId: source.id,
            attachmentId: attachment.id,
            provider: "adapter",
            result
          }));
          recognized = true;
        } catch (error) {
          attachment.failureReason = errorMessage(error);
        }
      }
      if (!recognized) {
        attachment.status = "failed";
        gaps.push(this.finalFailureGap(source, attachment, "recognition", attachment.failureReason ?? "unknown error"));
      }
    }
    this.repository.persist();
    return { attachments: selected, analyses, recognitionRequests, gaps };
  }

  submit(input: {
    sourceId: string;
    attachmentId: string;
    provider: "host-agent" | "adapter";
    result: AttachmentAnalysisDraft;
  }) {
    const source = this.source(input.sourceId);
    const attachment = source.attachments.find((item) => item.id === input.attachmentId);
    if (!attachment) throw new Error("Requirement attachment not found");
    const attachmentId = attachment.id;
    if (!attachmentId) throw new Error("Requirement attachment is missing its id");
    if (!attachment.localPath || !["downloaded", "recognizing", "failed"].includes(attachment.status ?? "")) {
      throw new Error("Requirement attachment must be downloaded before analysis submission");
    }
    const result = validateAnalysisDraft(input.result);
    const now = new Date().toISOString();
    const existing = this.repository.attachmentAnalyses.find(
      (item) => item.sourceId === source.id && item.attachmentId === attachment.id && item.status !== "failed"
    );
    const analysis: AttachmentAnalysis = existing ?? {
      id: id("attachmentAnalysis"),
      knowledgeProjectId: source.knowledgeProjectId,
      requirementSetId: requiredRequirementSetId(source),
      sourceId: source.id,
      attachmentId,
      ...result,
      sourceRefs: [`requirement-source:${source.id}`, `attachment:${attachment.id}`],
      provider: input.provider,
      status: "draft",
      createdAt: now,
      updatedAt: now
    };
    Object.assign(analysis, result, { provider: input.provider, status: "draft", updatedAt: now });
    if (!existing) this.repository.attachmentAnalyses.push(analysis);
    attachment.analysisId = analysis.id;
    attachment.status = "structured";
    attachment.failureReason = undefined;
    this.repository.persist();
    return analysis;
  }

  confirm(input: { analysisId: string; confirmedBy?: string }) {
    const analysis = this.repository.attachmentAnalyses.find((item) => item.id === input.analysisId);
    if (!analysis) throw new Error("Attachment analysis not found");
    if (analysis.status !== "draft") throw new Error("Only draft attachment analysis can be confirmed");
    const source = this.source(analysis.sourceId);
    const attachment = source.attachments.find((item) => item.id === analysis.attachmentId);
    if (!attachment) throw new Error("Requirement attachment not found");
    const now = new Date().toISOString();
    analysis.status = "confirmed";
    analysis.confirmedAt = now;
    analysis.confirmedBy = input.confirmedBy;
    analysis.updatedAt = now;
    attachment.status = "confirmed";
    this.repository.persist();
    return analysis;
  }

  private async downloadWithRetry(
    source: RequirementSource,
    attachment: RequirementAttachment,
    fetcher = fetch,
    downloader?: RequirementAttachmentDownloader
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    let lastError = "attachment download failed";
    for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
      attachment.status = "downloading";
      attachment.attempts = (attachment.attempts ?? 0) + 1;
      try {
        const result = await readAttachment(
          source,
          attachment,
          fetcher,
          downloader,
          this.sourceBaseDir
        );
        if (result.data.byteLength > MAX_ATTACHMENT_BYTES) {
          throw new Error(`attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
        }
        if (!isSupportedVisualContent(result.mimeType ?? attachment.mimeType, attachment)) {
          throw new Error("attachment is not a supported image or PDF");
        }
        const directory = join(this.rootDir, "sources", source.id, "attachments");
        await mkdir(directory, { recursive: true });
        const path = join(directory, `${attachment.id}-${safeName(attachment.name)}`);
        await writeFile(path, result.data);
        attachment.localPath = path;
        attachment.mimeType = result.mimeType ?? attachment.mimeType ?? mimeTypeFromName(attachment.name);
        attachment.contentHash = createHash("sha256").update(result.data).digest("hex");
        attachment.status = "downloaded";
        attachment.failureReason = undefined;
        this.repository.persist();
        return { ok: true };
      } catch (error) {
        lastError = errorMessage(error);
        attachment.failureReason = lastError;
      }
    }
    attachment.status = missingConnector(source, attachment, downloader) ? "needs-auth" : "failed";
    this.repository.persist();
    return { ok: false, reason: lastError };
  }

  private finalFailureGap(
    source: RequirementSource,
    attachment: RequirementAttachment,
    stage: "download" | "recognition",
    reason: string
  ) {
    const existing = this.repository.gaps.find(
      (gap) =>
        gap.sourceType === "requirement-attachment" &&
        gap.sourceId === attachment.id &&
        gap.status === "open"
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const gap: Gap = {
      id: id("gap"),
      projectId: source.knowledgeProjectId,
      sourceType: "requirement-attachment",
      sourceId: attachment.id ?? source.id,
      reason:
        `Attachment ${attachment.name} failed after ${
          stage === "download" ? attachment.attempts ?? 0 : attachment.recognitionAttempts ?? 0
        } ${stage} attempts using ${stage === "recognition" ? "the visual adapter" : "the source connector"}. ` +
        `Last error: ${reason}. Next action: restore connector access, provide a supported file, or retry recognition.`,
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now,
      updatedAt: now
    };
    this.repository.gaps.push(gap);
    return gap;
  }

  private source(sourceId: string) {
    const source = this.repository.requirementSources.find((item) => item.id === sourceId);
    if (!source) throw new Error("Requirement source not found");
    return source;
  }
}

async function readAttachment(
  source: RequirementSource,
  attachment: RequirementAttachment,
  fetcher: typeof fetch,
  downloader?: RequirementAttachmentDownloader,
  sourceBaseDir = process.cwd()
) {
  if (source.sourceType === "feishu" && attachment.fileToken) {
    if (!downloader) throw new Error("Feishu connector authentication is required to download media");
    return downloader(attachment);
  }
  if (attachment.containerPath && attachment.containerEntry) {
    assertLocalAttachmentPath(source, attachment.containerPath, sourceBaseDir);
    const entry = new AdmZip(attachment.containerPath).getEntry(attachment.containerEntry);
    if (!entry) throw new Error(`container entry ${attachment.containerEntry} not found`);
    return { data: entry.getData(), mimeType: attachment.mimeType };
  }
  if (attachment.containerPath) {
    assertLocalAttachmentPath(source, attachment.containerPath, sourceBaseDir);
    return { data: await readFile(attachment.containerPath), mimeType: attachment.mimeType };
  }
  if (!attachment.url) throw new Error("attachment has no downloadable reference");
  if (isAbsolute(attachment.url) || /^[a-z]:[\\/]/i.test(attachment.url)) {
    assertLocalAttachmentPath(source, attachment.url, sourceBaseDir);
    return { data: await readFile(attachment.url), mimeType: attachment.mimeType };
  }
  if (
    (source.sourceType === "local-file" || source.sourceType === "obsidian") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(attachment.url)
  ) {
    const candidate = resolve(dirname(localSourcePath(source, sourceBaseDir)), attachment.url);
    assertLocalAttachmentPath(source, candidate, sourceBaseDir);
    return { data: await readFile(candidate), mimeType: attachment.mimeType };
  }
  const url = new URL(attachment.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported attachment protocol: ${url.protocol}`);
  }
  if (source.sourceType === "http" && new URL(source.source).origin !== url.origin) {
    throw new Error("cross-origin requirement attachment requires an authorized connector");
  }
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`attachment returned HTTP ${response.status}`);
  return {
    data: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? attachment.mimeType
  };
}

function validateAnalysisDraft(value: AttachmentAnalysisDraft) {
  const kinds: AttachmentAnalysisKind[] = [
    "table", "flowchart", "state-machine", "wireframe", "text-image", "other"
  ];
  if (!value || !kinds.includes(value.kind) || !value.markdown?.trim()) {
    throw new Error("Attachment analysis requires a supported kind and markdown content");
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("Attachment analysis nodes and edges must be arrays");
  }
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error("Attachment analysis confidence must be between 0 and 1");
  }
  const nodeIds = new Set(value.nodes.map((node) => node.id));
  if (nodeIds.size !== value.nodes.length || value.nodes.some((node) => !node.id || !node.type || !node.label)) {
    throw new Error("Attachment analysis nodes require unique id, type, and label values");
  }
  if (value.edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) {
    throw new Error("Attachment analysis edges must reference declared nodes");
  }
  return value;
}

function assertLocalAttachmentPath(
  source: RequirementSource,
  candidate: string,
  sourceBaseDir: string
) {
  if (source.sourceType !== "local-file" && source.sourceType !== "obsidian") return;
  const sourcePath = localSourcePath(source, sourceBaseDir);
  const candidatePath = resolve(sourceBaseDir, candidate);
  const pathFromSource = relative(dirname(sourcePath), candidatePath);
  if (
    pathFromSource === ".." ||
    pathFromSource.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromSource)
  ) {
    throw new Error("local attachment must stay inside the requirement source directory");
  }
}

function localSourcePath(source: RequirementSource, sourceBaseDir: string) {
  const normalizedSource = source.source.startsWith("obsidian:")
    ? source.source.slice("obsidian:".length).trim()
    : source.source.startsWith("[[") && source.source.endsWith("]]")
      ? source.source.slice(2, -2).trim()
      : source.source;
  return resolve(sourceBaseDir, normalizedSource);
}

function isSupportedVisualContent(
  mimeType: string | undefined,
  attachment: RequirementAttachment
) {
  if (mimeType?.toLowerCase().startsWith("image/")) return true;
  if (mimeType?.toLowerCase().split(";", 1)[0] === "application/pdf") return true;
  if (attachment.type === "image") return true;
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"].includes(
    extname(attachment.name).toLowerCase()
  );
}

function requiredRequirementSetId(source: RequirementSource) {
  if (!source.latestRequirementSetId) throw new Error("Requirement source has no active requirement set");
  return source.latestRequirementSetId;
}

function missingConnector(
  source: RequirementSource,
  attachment: RequirementAttachment,
  downloader?: RequirementAttachmentDownloader
) {
  return source.sourceType === "feishu" && Boolean(attachment.fileToken) && !downloader;
}

function safeName(value: string) {
  const sanitized = basename(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "attachment.bin";
}

function mimeTypeFromName(value: string) {
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf"
  } as Record<string, string>)[extname(value).toLowerCase()];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
