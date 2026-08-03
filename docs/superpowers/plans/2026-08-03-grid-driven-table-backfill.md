# 网格驱动表格回填实施计划（2026-08-03）

| 阶段 | 任务 | 验证 |
|---|---|---|
| P0 | spec + 计划入库 | 文档存在 |
| P1 | `pdf_to_ir.py`：OCR 行/单元格 → 网格映射，输出 `grid_layout` | `grids_only` 模式扩展；test2 映射率报告 |
| P2 | TS schema/converter 透传 + 渲染器网格驱动表格 + lint colspan | `tsc` + 单测 |
| P3 | 单元测试（converter/renderer/lint） | `bun test` 全绿 |
| P4 | 真实 GPU 转换 test2（v7 IR/HTML）+ 诊断 | gridLayout 行/列/映射率；lint 对比 |
| P5 | DevTools 实测转换产物：图标中心 vs 所在 td 盒 | 194/194 落在正确单元格 |
| P6 | 全链路 translate → review → beautify → interact | 最终 lint、图标单元格归属复验 |
| P7 | 归档 v7 + 报告 + HTTP + 提交推送 | README/IR_TEST_REPORT、`http://192.168.2.118:8080/` |

## 风险与对策

- OCR 文本与 PDF span 匹配失败（幻觉/转写差异）：先归一化精确匹配，再包含匹配；统计 unmatched，
  丢弃（真实内容已在页面文本块，如页 1 左栏文本）；
- colspan 导致 lint 结构误报：lint 列数计算计入 colspan；
- 网格表格盒变大引入 lint 误报：lint 已按显式 width/CSS max-width 计算，回归验证；
- review/beautify 改表格 CSS 破坏图标：图标是 td 内 `img`（非绝对 div），不触发 structural repair。
