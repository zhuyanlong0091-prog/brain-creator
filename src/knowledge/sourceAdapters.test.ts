// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRequirementSource } from "./sourceAdapters.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveRequirementSource", () => {
  it("reads markdown and text files into a normalized content package", async () => {
    const root = await tempDir();
    const source = join(root, "requirement.md");
    await writeFile(source, "# Order Approval\n\nOrders above 1000 require approval.", "utf8");

    const result = await resolveRequirementSource({ source });

    expect(result).toEqual(
      expect.objectContaining({
        status: "ready",
        contentPackage: expect.objectContaining({
          title: "Order Approval",
          sourceType: "local-file",
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      })
    );
  });

  it("resolves relative and Obsidian references from the configured workspace", async () => {
    const root = await tempDir();
    await writeFile(join(root, "requirement.md"), "# Relative\n\nUsers create records.", "utf8");

    const relative = await resolveRequirementSource(
      { source: "requirement.md" },
      { baseDir: root }
    );
    const obsidian = await resolveRequirementSource(
      { source: "[[requirement.md]]" },
      { baseDir: root }
    );

    expect(relative.status).toBe("ready");
    expect(obsidian.status).toBe("ready");
    if (obsidian.status === "ready") {
      expect(obsidian.contentPackage.sourceType).toBe("obsidian");
    }
  });

  it("reads DOCX text through the OOXML adapter", async () => {
    const root = await tempDir();
    const source = join(root, "requirement.docx");
    const zip = new AdmZip();
    zip.addFile(
      "word/document.xml",
      Buffer.from(
        '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Contract Approval</w:t></w:r></w:p><w:p><w:r><w:t>Managers approve contracts.</w:t></w:r></w:p></w:body></w:document>'
      )
    );
    zip.writeZip(source);

    const result = await resolveRequirementSource({ source });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.contentPackage.content).toContain("Managers approve contracts");
    }
  });

  it("uses the PDF adapter and preserves parser warnings", async () => {
    const root = await tempDir();
    const source = join(root, "requirement.pdf");
    await writeFile(source, Buffer.from("fake-pdf"));

    const result = await resolveRequirementSource(
      { source },
      { pdfTextExtractor: async () => ({ text: "Invoice Requirement\nInvoices can be approved.", warnings: ["image skipped"] }) }
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "ready",
        contentPackage: expect.objectContaining({ warnings: ["image skipped"] })
      })
    );
  });

  it("reads an HTTP page and strips scripts and markup", async () => {
    const fetcher = vi.fn(async () =>
      new Response("<html><head><title>CRM Requirement</title><script>secret()</script></head><body><h1>Lead conversion</h1><p>Convert a lead to an opportunity.</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    );

    const result = await resolveRequirementSource(
      { source: "https://requirements.example.test/crm" },
      { fetcher }
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.contentPackage.title).toBe("CRM Requirement");
      expect(result.contentPackage.content).toContain("Convert a lead");
      expect(result.contentPackage.content).not.toContain("secret()");
    }
  });

  it("routes Feishu links to the host connector without claiming success", async () => {
    const result = await resolveRequirementSource({ source: "https://example.feishu.cn/wiki/abc123" });

    expect(result).toEqual(
      expect.objectContaining({
        status: "needs-host-connector",
        connector: "feishu",
        request: expect.objectContaining({ sourceType: "feishu" })
      })
    );
  });

  it("uses a configured Feishu reader before falling back to the host connector", async () => {
    const source = "https://example.feishu.cn/docx/abc123";
    const feishuReader = {
      readRequirement: vi.fn(async () => ({
        title: "Direct Feishu Requirement",
        content: "Users submit requests.",
        blocks: [{ type: "paragraph", text: "Users submit requests." }],
        attachments: [],
        source,
        sourceType: "feishu" as const,
        contentHash: "direct-hash",
        warnings: []
      }))
    };

    const result = await resolveRequirementSource({ source }, { feishuReader });

    expect(result.status).toBe("ready");
    expect(feishuReader.readRequirement).toHaveBeenCalledWith(source);
  });

  it("accepts a host-provided Feishu content package", async () => {
    const result = await resolveRequirementSource({
      source: "https://example.feishu.cn/docx/abc123",
      contentPackage: {
        title: "Feishu Requirement",
        content: "Users submit requests.",
        blocks: [{ type: "paragraph", text: "Users submit requests." }],
        attachments: [],
        source: "https://example.feishu.cn/docx/abc123",
        sourceType: "feishu",
        contentHash: "provided-hash",
        warnings: []
      }
    });

    expect(result).toEqual(expect.objectContaining({ status: "ready" }));
  });

  it("rejects unsafe protocols and private HTTP targets by default", async () => {
    await expect(resolveRequirementSource({ source: "file:///etc/passwd" })).rejects.toThrow(
      "Unsupported requirement source"
    );
    await expect(resolveRequirementSource({ source: "http://127.0.0.1/private" })).rejects.toThrow(
      "Private network requirement URLs"
    );
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-source-"));
  tempDirs.push(dir);
  return dir;
}
