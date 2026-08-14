// @vitest-environment node

import { describe, expect, it } from "vitest";
import { stableChildFrameEntries } from "./browserSurface.js";

describe("browser surface frame contract", () => {
  it("assigns ordinals before any allowlist filtering", () => {
    const main = { url: () => "https://system.example/" };
    const outside = { url: () => "https://other.example/frame" };
    const inside = { url: () => "https://system.example/frame" };
    const page = {
      mainFrame: () => main,
      frames: () => [main, outside, inside]
    } as unknown as import("@playwright/test").Page;

    expect(stableChildFrameEntries(page)).toEqual([
      { frame: outside, frameIndex: 0 },
      { frame: inside, frameIndex: 1 }
    ]);
  });

  it("does not assign an ordinal to an unloaded child frame", () => {
    const main = { url: () => "https://system.example/" };
    const unloaded = { url: () => "" };
    const loaded = { url: () => "https://system.example/frame" };
    const page = {
      mainFrame: () => main,
      frames: () => [main, unloaded, loaded]
    } as unknown as import("@playwright/test").Page;

    expect(stableChildFrameEntries(page)).toEqual([
      { frame: loaded, frameIndex: 0 }
    ]);
  });
});
