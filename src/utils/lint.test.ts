import { describe, it, expect } from "bun:test";
import { lintHtml } from "./lint.js";

function pageWithHeader(width: string): string {
  return `<div class="page" style="position:relative;width:1024px;height:1448px;margin:0 auto;overflow:hidden;background:#fff;">
<div style="position:absolute;left:305px;top:76px;width:${width}px;max-height:123px;white-space:pre-line;overflow:hidden;z-index:2;font-family:'Times New Roman',Times,serif;font-size:27.5px;font-weight:normal;line-height:1.5;">CEER SUPPLIER QUALITY
HANDBOOK</div>
<div style="position:absolute;left:110px;top:173px;z-index:2;font-size:12.0px;line-height:1.5;">1. Purpose</div>
</div>`;
}

describe("lintHtml", () => {
  it("flags a narrow pre-line header that wraps into the body below", () => {
    const issues = lintHtml(pageWithHeader("327"));
    expect(issues.some((i) => i.category === "Element overlap")).toBe(true);
  });

  it("passes when the header width is conservative enough to stay on 2 lines", () => {
    const issues = lintHtml(pageWithHeader("376"));
    expect(issues.filter((i) => i.category === "Element overlap")).toEqual([]);
  });

  it("uses the last duplicate width and real line-height like the browser", () => {
    // Renderer used to emit width twice (216 then 324); CSS takes the last
    // value. With line-height:1.3 the 3-line metadata box ends at y≈143 and
    // must not be reported as overlapping the TOC entry at y=172.
    const html = `<div class="page" style="position:relative;width:1024px;height:1448px;">
<div style="position:absolute;left:695px;top:76px;width:216px;width:324px;max-height:92px;white-space:pre-line;overflow:hidden;z-index:2;font-size:17.1px;line-height:1.3;">文档编号：CEER-QUSO-SP5-L2-001
版本/状态：4.0/已发布
生效日期：2024年7月7日</div>
<div style="position:absolute;left:119px;top:172px;width:875px;white-space:pre-line;z-index:2;font-size:19.0px;">14. 特殊特性....19</div>
</div>`;
    expect(lintHtml(html).filter((i) => i.category === "Element overlap")).toEqual([]);
  });

  it("does not treat max-width as width on text blocks", () => {
    const html = `<div class="page" style="position:relative;width:1024px;height:1448px;">
<div style="position:absolute;left:145px;top:543px;z-index:2;font-size:19.0px;line-height:1.5;max-width:849px;">- Ceer 设计（BTP）：配件完全由 CEER 设计，并由供应商按 BTP（按图制造）方式进行生产。</div>
<div style="position:absolute;left:145px;top:586px;z-index:2;font-size:19.0px;line-height:1.5;max-width:849px;">- 供应商设计（FSS）：配件由供应商根据 CEER 的具体要求进行设计/修改。</div>
</div>`;
    expect(lintHtml(html).filter((i) => i.category === "Element overlap")).toEqual([]);
  });

  it("caps table boxes with max-width so review-fixed tables are not overflows", () => {
    const html = `<div class="page" style="position:relative;width:1024px;height:1448px;">
<div class="det-table" style="position:absolute;left:80px;top:100px;max-width:877px;"><table><tr><td>版本</td><td>状态</td><td>生效日期</td><td>经办人</td><td>批准人</td><td>备注</td></tr></table></div>
</div>`;
    const issues = lintHtml(html);
    expect(issues.some((i) => i.subType === "overflow")).toBe(false);
  });
});
