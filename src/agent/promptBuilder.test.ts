import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentPrompt } from "./promptBuilder.js";
import type { AuthProfile, BusinessRule, GlossaryTerm, SystemProfile } from "../domain/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("buildAgentPrompt", () => {
  it("writes a planner prompt with system context, glossary, rules, and redacted auth summary", async () => {
    const outputDir = await tempDir();
    const system = systemProfile();
    const glossaryTerms: GlossaryTerm[] = [
      {
        id: "term_1",
        projectId: system.id,
        key: "product.robot",
        zhCN: "机器人",
        enUS: "Robot",
        aliases: ["Robot"],
        pageScope: "/products",
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z"
      }
    ];
    const businessRules: BusinessRule[] = [
      {
        id: "rule_1",
        systemId: system.id,
        name: "Payment amount rule",
        condition: "购买流程必须校验订单金额",
        severity: "block",
        createdAt: "2026-05-29T00:00:00.000Z"
      }
    ];
    const authProfiles: AuthProfile[] = [
      {
        id: "auth_1",
        projectId: system.id,
        env: "staging",
        role: "qa-admin",
        loginMethod: "token",
        encryptedSecrets: { token: "[REDACTED]" },
        status: "succeeded",
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z"
      }
    ];

    const result = await buildAgentPrompt({
      outputDir,
      system,
      requirement: "测试购买机器人的完整流程",
      glossaryTerms,
      businessRules,
      authProfiles
    });

    const content = await readFile(result.promptPath, "utf8");
    expect(result.promptPath).toContain("system_1-prompt.md");
    expect(result.content).toBe(content);
    expect(content).toContain("Orders Console");
    expect(content).toContain("https://shop.example.test");
    expect(content).toContain("测试购买机器人的完整流程");
    expect(content).toContain("product.robot");
    expect(content).toContain("购买流程必须校验订单金额");
    expect(content).toContain("qa-admin");
    expect(content).toContain("[REDACTED]");
    expect(content).not.toContain("secret-token");
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-agent-prompt-"));
  tempDirs.push(dir);
  return dir;
}

function systemProfile(): SystemProfile {
  return {
    id: "system_1",
    name: "Orders Console",
    environment: "staging",
    baseUrl: "https://shop.example.test",
    defaultLocale: "zh-CN",
    urlAllowlist: ["https://shop.example.test"],
    status: "succeeded",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}
