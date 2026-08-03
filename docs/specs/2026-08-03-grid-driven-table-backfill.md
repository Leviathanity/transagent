# 网格驱动表格：重构表格与图片回填的统一（2026-08-03）

## 问题

当前渲染有两个坐标系：

- **PDF 网格**（代码路径，精确）：表格外框 + 行列边界 + 单元格；图标按网格回填（row/col + 相对偏移），绝对位置与 PDF 一致；
- **OCR 语义表格**（内容驱动）：`headerRows/rows` + auto 布局，行高=文本高度、行数=OCR 行数（≠ 网格行数），整体被 `contentOffset` 挪到 OCR bbox 位置。

两套盒不重合（test2 页 2：网格盒 (185,48)-(883,1353)、10 行；重构表格渲染盒 (63,252)-高 860px、22 行），
图标绝对位置正确，但相对"当前表格"错位，甚至落在表格外。

## 设计

### 原则

1. **网格是唯一布局权威**：表格盒 = PDF 网格盒（原点/宽高/行列边界全部来自代码路径）；
2. **OCR 语义内容铸进网格单元格**：通过 PDF 文本 spans 给每个 OCR 单元格文本定位 → 映射到网格 row/col；
3. **图标是单元格内容**：不再用独立覆盖层，图标 `<img>` 渲染进对应 `td`（`td{position:relative}`，
   `img{position:absolute}` 相对单元格偏移），随表格布局走，review/beautify 改表格样式不再破坏图标位置；
4. 无网格的普通表格（如 test2 页 0）保持现有语义渲染，不受影响。

### IR 扩展

`TableSourceBlock` 增加 `gridLayout`：

```ts
interface GridLayout {
  rows: number[];                       // 网格行边界（display px，n+1）
  cols: number[];                       // 网格列边界（display px，m+1）
  cells: ({ texts: string[]; colspan: number } | null)[][];  // n×m，null=空单元格
}
```

`cellImages` 继续携带 `row/col/left/top/width/height`（相对网格原点），渲染器换算为单元格内偏移。

### 提取层（pdf_to_ir.py）

1. 解析 OCR 表格 html 的每行每单元格文本（正则提取 th/td）；
2. 与 `page_fonts`（PDF 文本 spans）做归一化匹配（精确 → 包含），多 span 取并集 bbox；
3. 单元格文本 bbox 中心 → 网格 row；bbox x 范围 → 网格 col 与 colspan（跨列）；
4. 匹配不到 span 的文本（OCR 幻觉/混入表格外的文本）丢弃——其真实内容已存在于页面文本块；
5. 同一网格单元格内多段文本按序堆叠（`texts[]`，网格行高远大于文本行高，可容纳）。

### 渲染层（pixel-perfect.ts）

```html
<div class="det-table" style="position:absolute;left:网格x;top:网格y;width:W;height:H;">
  <table style="table-layout:fixed;width:W;border-collapse:collapse;">
    <colgroup><col style="width:colW"/></colgroup>
    <tbody>
      <tr style="height:rowH;">
        <td style="position:relative;">文本 div… <img style="position:absolute;left:dx;top:dy;"/></td>
      </tr>
    </tbody>
  </table>
</div>
```

- 列宽/行高 = 网格边界差；空单元格也输出 `<td>`（边框完整）；
- colspan 单元格占多列，后续列跳过；
- 单元格同时含文本与图标时，文本 `margin-left` 避让图标右缘；
- lint 结构检查把 `colspan` 计入列数。

### 兼容

- 翻译仍按 OCR `headerRows/rows` 语义行（块数与翻译量不变）；
- `contentOffset` 保留但仅在无 `gridLayout` 时使用；
- 无网格表格（页 0）渲染路径不变。

## 验证

1. 单测：converter 透传、网格驱动渲染（colgroup/tr height/文本/图标进 td/colspan）、lint colspan；
2. 真实 GPU 转换：统计 OCR 单元格 → 网格映射率；
3. DevTools 实测：每个图标中心 vs 所在 td 盒、表格盒=网格盒、全链路最终文件复验；
4. 归档 `workdir/ir-e2e-test2-2026-08-03-v7/`，HTTP 展示，提交推送。
