# Translation Layout Beautification — Visual fidelity against original PDF

Compare the translated HTML against the original PDF reference and fix visual discrepancies.

## 1. Font consistency
The translated HTML should use font families, sizes, weights, and colors that match the original PDF's text styling.
Check each text element: translated text may have stretched/shrunk compared to the original. Adjust where needed.
- severity: error
- output format: `[error] 1. Font consistency - {element_text} should be {expected_style}`

## 2. Text fitting & wrapping
Translated text is often longer or shorter than the source. Check that translated text properly fits within its bounding box without overflow or excessive whitespace. Use max-height, overflow:hidden, line-height adjustments as needed.
- severity: error
- output format: `[error] 2. Text fitting - "{text}" overflows bbox by {n}px`

## 3. Spacing & alignment
Check paragraph spacing, line spacing, and text alignment. Ensure visual rhythm matches the original PDF — paragraphs should not be too tight or too loose.
- severity: warning
- output format: `[warning] 3. Spacing - {element1} to {element2} gap is {n}px (original ~{m}px)`

## 4. Table styling
Table borders, cell padding, column widths, and header styling should match the original PDF. Cells with long translated text should handle overflow gracefully.
- severity: error
- output format: `[error] 4. Table styling - {description}`

## 5. Color & contrast
Ensure that text colors (green for confidential, black for body, etc.) are preserved from the original PDF. No color should be lost or altered during translation.
- severity: error
- output format: `[error] 5. Color - {element_text} color is {actual} (expected {expected})`

## 6. Image quality
Embedded images (logos, diagrams) should maintain their aspect ratio, not appear squashed or stretched, and use appropriate natural dimensions.
- severity: error
- output format: `[error] 6. Image quality - {description}`

## 7. Overall polish
Any remaining visual issues that make the translated HTML look substantially different from the original PDF: alignment, padding, borders, shadows, etc.
- severity: warning
- output format: `[warning] 7. Polish - {description}`
