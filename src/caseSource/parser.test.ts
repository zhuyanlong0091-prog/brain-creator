import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { parseCaseSource } from "./parser.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("parseCaseSource", () => {
  it("parses executable xlsx test cases with Chinese headers", async () => {
    const dir = await tempDir();
    const source = join(dir, "招聘需求及offer流程适配_V2.0_测试用例.xlsx");
    await writeFile(
      source,
      createXlsx([
        [
          "用例编号",
          "用例标题",
          "所属模块",
          "前置条件",
          "操作步骤",
          "预期结果",
          "实际结果",
          "优先级",
          "用例状态",
          "BugID",
          "备注"
        ],
        [
          "TC-001",
          "创建招聘需求",
          "招聘需求",
          "用户已登录 HRMS",
          "1. 打开招聘需求页面\n2. 点击新增\n3. 填写岗位信息",
          "招聘需求创建成功",
          "",
          "P0",
          "未执行",
          "",
          "核心链路"
        ],
        [
          "TC-002",
          "发起 offer",
          "Offer",
          "候选人已通过面试",
          "1、进入候选人详情\n2、点击发起 offer",
          "Offer 审批流启动",
          "",
          "P1",
          "未执行",
          "",
          ""
        ]
      ])
    );

    const parsed = await parseCaseSource(source);

    expect(parsed.sourceType).toBe("xlsx");
    expect(parsed.cases).toHaveLength(2);
    expect(parsed.moduleStats).toEqual({ "招聘需求": 1, Offer: 1 });
    expect(parsed.priorityStats).toEqual({ P0: 1, P1: 1 });
    expect(parsed.cases[0]).toEqual(
      expect.objectContaining({
        caseNo: "TC-001",
        title: "创建招聘需求",
        steps: ["打开招聘需求页面", "点击新增", "填写岗位信息"],
        expectedResult: "招聘需求创建成功",
        priority: "P0",
        sourceRow: 2
      })
    );
  });

  it("splits Excel entity-encoded line breaks into ordered steps", async () => {
    const dir = await tempDir();
    const source = join(dir, "entity-steps.xlsx");
    await writeFile(
      source,
      createXlsx([
        ["用例编号", "用例标题", "所属模块", "前置条件", "操作步骤", "预期结果", "优先级"],
        [
          "TC-ENTITY-001",
          "查询状态",
          "招聘需求-查询条件",
          "用户已登录",
          "1. 打开列表&#10;2. 选择状态&#10;3. 点击查询&#10;4. 清空条件",
          "1. 结果符合筛选条件&#10;2. 清空后恢复默认列表",
          "P1"
        ]
      ])
    );

    const parsed = await parseCaseSource(source);

    expect(parsed.cases[0].steps).toEqual([
      "打开列表",
      "选择状态",
      "点击查询",
      "清空条件"
    ]);
    expect(parsed.cases[0].expectedResult).toBe(
      "1. 结果符合筛选条件\n2. 清空后恢复默认列表"
    );
  });

  it("keeps markdown overview files as non-executable previews", async () => {
    const dir = await tempDir();
    const source = join(dir, "招聘需求及offer流程适配_V2.0_测试用例概览.md");
    await writeFile(source, "# 用例概览\n\n总数：174\n", "utf8");

    const parsed = await parseCaseSource(source);

    expect(parsed.sourceType).toBe("markdown");
    expect(parsed.cases).toEqual([]);
    expect(parsed.warnings).toContain("Markdown source does not include an executable case table.");
  });

  it("parses executable markdown case tables", async () => {
    const dir = await tempDir();
    const source = join(dir, "cases.md");
    await writeFile(
      source,
      [
        "| 用例编号 | 用例标题 | 所属模块 | 前置条件 | 操作步骤 | 预期结果 | 优先级 | 备注 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| TC-MD-001 | 审批招聘需求 | 招聘需求 | 用户已登录 | 1. 打开招聘需求<br>2. 点击审批 | 状态变为已审批 | P0 | Markdown 表格 |"
      ].join("\n"),
      "utf8"
    );

    const parsed = await parseCaseSource(source);

    expect(parsed.sourceType).toBe("markdown");
    expect(parsed.cases).toEqual([
      expect.objectContaining({
        caseNo: "TC-MD-001",
        title: "审批招聘需求",
        module: "招聘需求",
        steps: ["打开招聘需求", "点击审批"],
        expectedResult: "状态变为已审批",
        priority: "P0",
        remark: "Markdown 表格"
      })
    ]);
    expect(parsed.moduleStats).toEqual({ "招聘需求": 1 });
  });

  it("parses Obsidian and Claudian references without changing the stored source", async () => {
    const dir = await tempDir();
    const source = join(dir, "referenced-cases.md");
    await writeFile(
      source,
      [
        "| 用例编号 | 用例标题 | 所属模块 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| TC-REF-001 | 发起 offer | Offer | 候选人已通过面试 | 1. 点击发起 offer | Offer 审批流启动 | P1 |"
      ].join("\n"),
      "utf8"
    );

    const obsidian = await parseCaseSource(`obsidian:${source}`);
    const claudian = await parseCaseSource(`claudian:${source}`);

    expect(obsidian.source).toBe(`obsidian:${source}`);
    expect(obsidian.sourceType).toBe("obsidian");
    expect(obsidian.cases[0].caseNo).toBe("TC-REF-001");
    expect(claudian.source).toBe(`claudian:${source}`);
    expect(claudian.sourceType).toBe("claudian");
    expect(claudian.cases[0].title).toBe("发起 offer");
  });
});

function createXlsx(rows: string[][]) {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypesXml(), "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(rootRelsXml(), "utf8"));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml(), "utf8"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRelsXml(), "utf8"));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml(rows), "utf8"));
  return zip.toBuffer();
}

function sheetXml(rows: string[][]) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    "<sheetData>",
    ...rows.map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map(
          (value, columnIndex) =>
            `<c r="${columnName(columnIndex)}${rowNumber}" t="inlineStr"><is><t>${escapeXml(
              value
            )}</t></is></c>`
        )
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    }),
    "</sheetData>",
    "</worksheet>"
  ].join("");
}

function workbookXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheets><sheet name="测试用例" sheetId="1" r:id="rId1"/></sheets>',
    "</workbook>"
  ].join("");
}

function workbookRelsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"',
    ' Target="worksheets/sheet1.xml"/>',
    "</Relationships>"
  ].join("");
}

function rootRelsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"',
    ' Target="xl/workbook.xml"/>',
    "</Relationships>"
  ].join("");
}

function contentTypesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml"',
    ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/worksheets/sheet1.xml"',
    ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    "</Types>"
  ].join("");
}

function columnName(index: number) {
  let value = "";
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
    value = String.fromCharCode(((current - 1) % 26) + 65) + value;
  }
  return value;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-case-source-"));
  tempDirs.push(dir);
  return dir;
}
