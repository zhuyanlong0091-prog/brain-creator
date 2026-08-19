// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { FeishuOpenApiAdapter } from "./feishuAdapter.js";

describe("FeishuOpenApiAdapter", () => {
  it("resolves a Wiki node and reads paged Docx blocks into a content package", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ code: 0, tenant_access_token: "tenant-token", expire: 7200 }))
      .mockResolvedValueOnce(
        json({ code: 0, data: { node: { obj_token: "docx-token", obj_type: "docx", title: "Order PRD" } } })
      )
      .mockResolvedValueOnce(
        json({ code: 0, data: { document: { document_id: "docx-token", revision_id: 7, title: "Order PRD" } } })
      )
      .mockResolvedValueOnce(
        json({
          code: 0,
          data: {
            items: [
              block(3, "Order Approval"),
              block(2, "Orders above 1000 require manager approval."),
              { block_type: 27, block_id: "image-1", image: { token: "image-token" } },
              { block_type: 31, block_id: "table-1", table: {} }
            ],
            has_more: true,
            page_token: "next-page"
          }
        })
      )
      .mockResolvedValueOnce(
        json({
          code: 0,
          data: { items: [block(2, "Approved orders are read-only.")], has_more: false }
        })
      );
    const adapter = new FeishuOpenApiAdapter({ appId: "app-id", appSecret: "app-secret", fetcher });

    const result = await adapter.readRequirement("https://tenant.feishu.cn/wiki/wiki-token");

    expect(result.title).toBe("Order PRD");
    expect(result.content).toContain("Approved orders are read-only");
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("table")]));
    expect(result.attachments).toEqual([
      expect.objectContaining({
        blockId: "image-1",
        fileToken: "image-token",
        status: "discovered"
      })
    ]);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls[0][1]?.body).toContain("app-secret");
    expect(JSON.stringify(result)).not.toContain("app-secret");
  });

  it("downloads Feishu media by stable file token instead of persisting an expiring URL", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ code: 0, tenant_access_token: "tenant-token", expire: 7200 }))
      .mockResolvedValueOnce(
        new Response(Buffer.from("image"), {
          status: 200,
          headers: { "content-type": "image/png" }
        })
      );
    const adapter = new FeishuOpenApiAdapter({ appId: "app-id", appSecret: "app-secret", fetcher });

    const result = await adapter.downloadAttachment({
      name: "diagram",
      fileToken: "image-token",
      status: "discovered",
      attempts: 0
    });

    expect(result.data.toString()).toBe("image");
    expect(result.mimeType).toBe("image/png");
    expect(String(fetcher.mock.calls[1][0])).toContain("/drive/v1/medias/image-token/download");
  });

  it("refreshes Feishu credentials after a rejected media request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ code: 0, tenant_access_token: "expired-token", expire: 7200 }))
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(json({ code: 0, tenant_access_token: "fresh-token", expire: 7200 }))
      .mockResolvedValueOnce(new Response(Buffer.from("image"), { status: 200 }));
    const adapter = new FeishuOpenApiAdapter({ appId: "app-id", appSecret: "app-secret", fetcher });
    const attachment = { name: "diagram", fileToken: "image-token", status: "discovered" as const, attempts: 0 };

    await expect(adapter.downloadAttachment(attachment)).rejects.toThrow("HTTP 401");
    await expect(adapter.downloadAttachment(attachment)).resolves.toEqual(
      expect.objectContaining({ data: Buffer.from("image") })
    );
    expect(fetcher.mock.calls[3][1]?.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer fresh-token" })
    );
  });

  it("reads direct Docx links without a Wiki lookup", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ code: 0, tenant_access_token: "tenant-token", expire: 7200 }))
      .mockResolvedValueOnce(
        json({ code: 0, data: { document: { document_id: "doc-token", revision_id: 1, title: "Direct" } } })
      )
      .mockResolvedValueOnce(
        json({ code: 0, data: { items: [block(2, "Direct content")], has_more: false } })
      );
    const adapter = new FeishuOpenApiAdapter({ appId: "app-id", appSecret: "app-secret", fetcher });

    const result = await adapter.readRequirement("https://tenant.feishu.cn/docx/doc-token");

    expect(result.content).toBe("Direct content");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("wiki/v2"))).toBe(false);
  });

  it("returns actionable errors for permissions and unsupported Wiki resources", async () => {
    const denied = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ code: 0, tenant_access_token: "tenant-token", expire: 7200 }))
      .mockResolvedValueOnce(json({ code: 131006, msg: "permission denied" }, 400));
    await expect(
      new FeishuOpenApiAdapter({ appId: "app-id", appSecret: "app-secret", fetcher: denied }).readRequirement(
        "https://tenant.feishu.cn/wiki/wiki-token"
      )
    ).rejects.toThrow("permission denied");

    const unsupported = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ code: 0, tenant_access_token: "tenant-token", expire: 7200 }))
      .mockResolvedValueOnce(
        json({ code: 0, data: { node: { obj_token: "sheet-token", obj_type: "sheet", title: "Sheet" } } })
      );
    await expect(
      new FeishuOpenApiAdapter({ appId: "app-id", appSecret: "app-secret", fetcher: unsupported }).readRequirement(
        "https://tenant.feishu.cn/wiki/wiki-token"
      )
    ).rejects.toThrow("unsupported resource type: sheet");
  });
});

function block(type: number, content: string) {
  const key = type === 3 ? "heading1" : "text";
  return {
    block_type: type,
    block_id: `block-${content}`,
    [key]: { elements: [{ text_run: { content } }] }
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}
