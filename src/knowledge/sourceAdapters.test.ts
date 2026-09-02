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

  it("discovers local Markdown images as requirement content", async () => {
    const root = await tempDir();
    const source = join(root, "requirement.md");
    await writeFile(source, "# Order Flow\n\n![Approval state](./approval.png)", "utf8");
    await writeFile(join(root, "approval.png"), Buffer.from("image"));

    const result = await resolveRequirementSource({ source });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.contentPackage.blocks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          text: "Approval state",
          sourceRefs: [expect.stringContaining("#line:")],
          image: expect.objectContaining({
            alt: "Approval state",
            reference: "./approval.png"
          })
        })
      ]));
      expect(result.contentPackage.attachments).toEqual([
        expect.objectContaining({
          name: "Approval state",
          url: join(root, "approval.png"),
          status: "discovered"
        })
      ]);
    }
  });

  it("preserves Markdown headings, tables, lists, and source references in the block AST", async () => {
    const root = await tempDir();
    const source = join(root, "requirement.md");
    await writeFile(source, [
      "# Order Approval",
      "",
      "Managers approve orders.",
      "",
      "| Condition | Action |",
      "| --- | --- |",
      "| Amount > 1000 | Require approval |",
      "",
      "- Record the decision",
      ""
    ].join("\n"), "utf8");

    const result = await resolveRequirementSource({ source });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.contentPackage.blocks).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "heading", level: 1, text: "Order Approval" }),
        expect.objectContaining({ type: "paragraph", text: "Managers approve orders." }),
        expect.objectContaining({
          type: "table",
          table: {
            headers: ["Condition", "Action"],
            rows: [["Amount > 1000", "Require approval"]]
          }
        }),
        expect.objectContaining({ type: "list-item", text: "Record the decision" })
      ]));
      expect(result.contentPackage.blocks.every((block) => (block.sourceRefs?.length ?? 0) > 0)).toBe(true);
      expect(result.contentPackage.blocks.map((block) => block.order)).toEqual([0, 1, 2, 3]);
    }
  });

  it("changes the requirement hash when an embedded local image changes", async () => {
    const root = await tempDir();
    const source = join(root, "requirement.md");
    const image = join(root, "approval.png");
    await writeFile(source, "# Order Flow\n\n![Approval state](./approval.png)", "utf8");
    await writeFile(image, Buffer.from("first-image"));
    const first = await resolveRequirementSource({ source });
    await writeFile(image, Buffer.from("second-image"));
    const second = await resolveRequirementSource({ source });

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    if (first.status === "ready" && second.status === "ready") {
      expect(first.contentPackage.contentHash).not.toBe(second.contentPackage.contentHash);
      expect(first.contentPackage.attachments[0].contentHash).not.toBe(
        second.contentPackage.attachments[0].contentHash
      );
    }
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
        '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Contract Approval</w:t></w:r></w:p><w:p><w:r><w:t>Managers approve contracts.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Field</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rule</w:t></w:r></w:p></w:tc></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Amount</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Required</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
      )
    );
    zip.addFile("word/media/image1.png", Buffer.from("image"));
    zip.writeZip(source);

    const result = await resolveRequirementSource({ source });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.contentPackage.content).toContain("Managers approve contracts");
      expect(result.contentPackage.blocks).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "heading", level: 1, text: "Contract Approval" }),
        expect.objectContaining({ type: "table", table: {
          headers: ["Field", "Rule"],
          rows: [["Amount", "Required"]]
        } }),
        expect.objectContaining({
          type: "image",
          image: expect.objectContaining({ reference: "word/media/image1.png" }),
          sourceRefs: [expect.stringContaining("word/media/image1.png")]
        })
      ]));
      expect(result.contentPackage.attachments).toEqual([
        expect.objectContaining({
          name: "image1.png",
          containerPath: source,
          containerEntry: "word/media/image1.png",
          status: "discovered"
        })
      ]);
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
        contentPackage: expect.objectContaining({
          warnings: ["image skipped"],
          attachments: [
            expect.objectContaining({
              name: "requirement.pdf",
              containerPath: source,
              mimeType: "application/pdf",
              status: "discovered"
            })
          ]
        })
      })
    );
  });

  it("reads an HTTP page and strips scripts and markup", async () => {
    const fetcher = vi.fn(async () =>
      new Response("<html><head><title>CRM Requirement</title><script>secret()</script></head><body><h1>Lead conversion</h1><p>Convert a lead to an opportunity.</p><img alt=\"Conversion flow\" src=\"/flow.png\"></body></html>", {
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
      expect(result.contentPackage.blocks).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "heading", level: 1, text: "Lead conversion" }),
        expect.objectContaining({ type: "paragraph", text: "Convert a lead to an opportunity." }),
        expect.objectContaining({ type: "image", image: expect.objectContaining({ alt: "Conversion flow" }) })
      ]));
      expect(result.contentPackage.attachments).toEqual([
        expect.objectContaining({
          name: "Conversion flow",
          url: "https://requirements.example.test/flow.png",
          status: "discovered"
        })
      ]);
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

  it("recognizes enterprise Feishu links as host connector sources", async () => {
    const result = await resolveRequirementSource({
      source: "https://tenant.larkenterprise.com/wiki/abc123"
    });

    expect(result).toEqual(expect.objectContaining({
      status: "needs-host-connector",
      connector: "feishu"
    }));
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
    if (result.status === "ready") {
      expect(result.contentPackage.blocks[0]).toEqual(expect.objectContaining({
        order: 0,
        sourceRef: "https://example.feishu.cn/docx/abc123#block:1",
        sourceRefs: ["https://example.feishu.cn/docx/abc123#block:1"]
      }));
    }
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
