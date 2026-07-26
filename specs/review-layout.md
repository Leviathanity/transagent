# Pixel-Perfect HTML Layout Review — All issues are high-priority errors

## 1. Element overlap
Check if any absolutely-positioned elements overlap. Overlapping text makes the page unreadable. Classify each overlap by type:
- **title-header**: Title text wrapping too tall overlaps header/doc-id/version on the right. If title has `white-space:pre-line` (multi-line), only adjust `max-height` — do NOT change white-space to nowrap. If `white-space:nowrap`, add `overflow:hidden;max-height:{n}px`.
- **title-content**: Section title bottom overlaps the next paragraph. Needs increased spacing (adjust title margin-bottom or next element's top).
- **text-text**: Consecutive body paragraphs with tight OCR spacing. Move lower elements down to create minimum 5px gap.
- **table-content**: Table block overlaps adjacent text. Shrink table max-width or reposition nearby elements.
- **content-header**: Body text overlaps page header/footer/page_number. Adjust the smaller element's position.

Report each overlapping pair with its type. All overlaps are errors that MUST be fixed.
- severity: error
- output format: `[error] 1. Element overlap - {type} - {element1_text} overlaps {element2_text} at y={top}px`

## 2. Font style accuracy
Check that font sizes from PDF matching are reasonable. Report any that seem incorrect.
- severity: error
- output format: `[error] 2. Font style - {element_text} has font-size {size}px which is incorrect`

## 3. Table overflow
Check that tables don't exceed the page width. Overflowing tables MUST be fixed.
- severity: error
- output format: `[error] 3. Table overflow - table at ({left},{top}) exceeds page width`

## 4. Missing images
Check for text that should be images (no PDF font match, short logo-like text).
- severity: error
- output format: `[error] 4. Missing image - "{text}" should be an <img> not text`

## 5. Page overflow
Check that no element extends past the page boundary. Overflow MUST be fixed.
- severity: error
- output format: `[error] 5. Page overflow - {text} right edge {n}px exceeds page {m}px`
