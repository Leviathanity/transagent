import { describe, it, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inlineImageSrc,
  inlineDocumentImages,
  inlineHtmlImages,
} from "./inline-images.js";
import type { DocumentIR } from "../types/document-ir.js";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function makeImageDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "inline-img-"));
  await writeFile(join(dir, "a.png"), PNG_1PX);
  return dir;
}

describe("inlineImageSrc", () => {
  it("embeds an existing PNG as a data URI", async () => {
    const dir = await makeImageDir();
    const out = await inlineImageSrc("a.png", dir);
    expect(out.startsWith("data:image/png;base64,")).toBe(true);
    expect(out.slice("data:image/png;base64,".length)).toBe(PNG_1PX.toString("base64"));
  });

  it("keeps the original reference when the file is missing", async () => {
    expect(await inlineImageSrc("missing.png", "/tmp")).toBe("missing.png");
  });

  it("passes through data URIs and remote URLs", async () => {
    expect(await inlineImageSrc("data:image/png;base64,AAAA", "/tmp")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(await inlineImageSrc("https://example.com/a.png", "/tmp")).toBe(
      "https://example.com/a.png",
    );
  });

  it("returns src unchanged without an image dir", async () => {
    expect(await inlineImageSrc("a.png")).toBe("a.png");
  });
});

describe("inlineDocumentImages", () => {
  it("inlines image blocks and table cell images without mutating the input", async () => {
    const dir = await makeImageDir();
    const ir: DocumentIR = {
      pages: [
        {
          width: 100,
          height: 100,
          blocks: [
            { id: "b1", type: "image", level: 0, text: "", src: "a.png", alt: "logo" },
            {
              id: "b2",
              type: "table",
              level: 0,
              text: "",
              headerRows: [],
              rows: [["x"]],
              cellImages: [{ src: "a.png", left: 0, top: 0, width: 10, height: 10 }],
            },
            {
              id: "b3",
              type: "image",
              level: 0,
              text: "",
              src: "missing.png",
              alt: "",
            },
          ],
        },
      ],
    };
    const out = await inlineDocumentImages(ir, dir);
    expect(out.pages[0].blocks[0].type === "image" && out.pages[0].blocks[0].src.startsWith("data:image/png;base64,")).toBe(true);
    const table = out.pages[0].blocks[1];
    if (table.type === "table") {
      expect(table.cellImages?.[0].src.startsWith("data:image/png;base64,")).toBe(true);
    }
    expect(out.pages[0].blocks[2].type === "image" && out.pages[0].blocks[2].src).toBe("missing.png");
    // input IR untouched
    expect(ir.pages[0].blocks[0].type === "image" && ir.pages[0].blocks[0].src).toBe("a.png");
  });
});

describe("inlineHtmlImages", () => {
  it("inlines existing refs and leaves data/http refs alone", async () => {
    const dir = await makeImageDir();
    const html =
      '<img src="a.png"><img src="missing.png"><img src="data:image/png;base64,AAAA"><img src="https://x.com/b.png">';
    const out = await inlineHtmlImages(html, dir);
    expect(out).toContain('src="data:image/png;base64,');
    expect(out).toContain('src="missing.png"');
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out).toContain('src="https://x.com/b.png"');
  });

  it("returns html unchanged without an image dir", async () => {
    const html = '<img src="a.png">';
    expect(await inlineHtmlImages(html)).toBe(html);
  });
});
