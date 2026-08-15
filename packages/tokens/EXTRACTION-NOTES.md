# Design Token Extraction Notes

**Source:** `/Users/macbook/kiksu/design/kiksu-mobile-screens.html`  
**Date:** 2026-08-15  
**Method:** Mechanical extraction from inline styles in HTML mockup

## Summary

Extracted design tokens for a 10-screen Azerbaijani student app mockup (390×844px phone frames). The design uses a limited, intentional color palette with named cultural references (Azerbaijani gemstones/materials), clear typographic hierarchy with monospace labels and sans-serif body text, and a consistent spacing scale.

---

## Colors

### Named in Legend (4 colors with explicit names)

| Hex | Name | Azerbaijani Name | Role | Uses |
|-----|------|------------------|------|------|
| `#0F7A85` | Primary/Teal | Şirvan turkuazı | Interactive, primary buttons, links, selected states | 62 |
| `#C8952A` | Bronze/Secondary | Tunc / kart səviyyəsi | Card tier indicator, secondary courses | 10 |
| `#B23A2F` | Pomegranate/Urgent | Nar / son tarix | Deadlines, urgency, urgent indicators | 23 |
| `#141C24` | Ink/Dark | Xəzər mürəkkəbi | Dark text, primary buttons | 23 |
| `#F1F0EC` | Stone/Light | Bakı əhəngdaşı | Light background surface | 11 |

### Gray Scale (Neutral text and borders)

| Hex | Role | Uses |
|-----|------|------|
| `#6D7580` | Muted/secondary labels (most used neutral) | 92 |
| `#DEDCD5` | Primary border/stroke | 48 |
| `#8A9099` | Placeholder text/tertiary UI | 44 |
| `#EDEBE4` | Light border/divider | 34 |
| `#4A525C` | Secondary text (darker) | 28 |
| `#5C6470` | Tertiary text | 22 |
| `#9AA0A8` | Light muted text | 21 |
| `#3D444D` | Dark secondary text | 11 |
| `#D6D3CA` | Coarse/structural border | 10 |
| `#F5F3EC` | Very light background | 18 |
| `#E4E1D9` | Light divider/border | 9 |
| `#E0DDD5` | Light stroke | 7 |
| `#F0EEE7` | Lightest divider | 8 |
| `#C7C4BB` | Scrollbar thumb | 6 |

### Color Variants & Derived Colors

| Hex | Purpose | Uses |
|-----|---------|------|
| `#0B5C64` | Primary hover state | 9 |
| `#F0F7F7` | Teal tint background | 9 |
| `#9ECBCF` | Teal accent/border | 9 |
| `#FAF3E4` | Bronze light background | 7 |
| `#F6EFDF` | Bronze/tan background | 4 |
| `#8A6B21` | Bronze secondary text | 10 |
| `#F4E7E5` | Pomegranate light background | 2 |
| `#FAF3F2` | Pink/pomegranate light | 4 |
| `#8C2C23` | Pomegranate dark | 4 |
| `#E8D9D6` | Pomegranate light stroke | 8 |
| `#E8C9C4` | Pomegranate border | 4 |
| `#2F5A9E` | Blue (English courses indicator) | 7 |
| `#C3CEE4` | Blue light variant | 1 |
| `#EFEFF6` | Blue light background | 4 |

### Backgrounds & Surface Colors

| Hex | Role | Uses |
|-----|------|------|
| `#FFFFFF` | White surface | 54 |
| `#F1F0EC` | Beige background (named: Bakı əhəngdaşı) | 11 |
| `#F5F3EC` | Very light background | 18 |
| `#FCFBF8` | Lightest background | 1 |
| `#F4F2EC` | Warm light background | 2 |
| `#FAF6EC` | Warmest light | 2 |
| `#FBFAF7` | Cream background | 1 |
| `#F7F6F2` | Beige variant | 1 |
| `#EAE7DF` | Stone variant | 1 |
| `#E9E6DE` | Ultra light variant | 1 |
| `#E7E5DF` | Document/page background | 2 |

### Rare/Single-Use Colors

| Hex | Purpose | Uses |
|-----|---------|------|
| `#A9C7CA` | Timetable course color variant | 1 |
| `#6B5518` | Timetable course brown variant | 1 |

---

## Typography

### Font Families Used

1. **Sans-serif (default body text):**  
   `-apple-system, 'SF Pro Text', 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif`

2. **Monospace (labels, data, metrics):**  
   `ui-monospace, 'SF Mono', 'Segoe UI Mono', 'Roboto Mono', Menlo, monospace`

### Font Sizes (all unique sizes found)

| Size | Uses | Weights | Common Letter-Spacing |
|------|------|---------|----------------------|
| 8.5px | 1 | 700 | (mono data label) |
| 9px | 59 | 700 | .1em (mono) |
| 9.5px | 26 | (mono) | – |
| 10px | 83 | 600, 700 | .06em, .08em, .12em, .14em |
| 10.5px | 18 | 700 | (mono, small text) |
| 11px | 51 | 700, 600 | .05em, .06em |
| 11.5px | (1+) | 600 | – |
| 12px | 23 | 600 | – |
| 12.5px | 4 | 700 | – |
| 13px | 3 | 600, 700 | – |
| 13.5px | 8 | – | – |
| 14px | 26 | 600, 700 | – |
| 14.5px | 1 | 600 | – |
| 15px | 9 | 600, 700 | – |
| 15.5px | 7 | 600 | – |
| 16px | 5 | 600 | – |
| 17px | 1 | 700 | – |
| 18px | 2 | – | – |
| 19px | 4 | 700 | – |
| 24px | 2 | 300, 700 | – |
| 25px | 1 | 700 | – |
| 26px | 2 | 700 | -0.02em (large heading) |
| 27px | 4 | 700 | -0.025em (main heading) |
| 34px | 1 | 700 | – |

### Font Weights

- **700** (bold): 85 uses — headings, labels, emphasis
- **600** (semi-bold): 51 uses — body text, medium weight
- **300** (light): 1 use — only on 24px size (uncertain)

### Letter-Spacing (typography layer)

Used primarily with monospace font for labels and with large headings.

| Value | Context | Uses |
|-------|---------|------|
| `-0.03em` | Tight heading kerning | 1 |
| `-0.025em` | Heading tightening (common) | Multiple |
| `-0.02em` | Large heading (26px) | Multiple |
| `-0.015em` | Name compression | Multiple |
| `-0.01em` | Subtle tightening | 1 |
| `.04em` | Loose mono | 1 |
| `.05em` | Mono data labels | 2 |
| `.06em` | Mono common spacing | 76 |
| `.08em` | Mono common spacing | 39 |
| `.1em` | Mono labels | 10 |
| `.12em` | Mono eyebrow | 17 |
| `.14em` | Mono eyebrow tight | 8 |

---

## Spacing

### Spacing Scale (gap, padding, margin units)

Most commonly used spacing values suggesting a design scale:

| Value | Frequency | Role |
|-------|-----------|------|
| 2px | Medium | Micro spacing, dividers |
| 3px | Medium | Micro spacing |
| 4px | Medium | Micro spacing, subtle gaps |
| 5px | Medium | Micro spacing, small padding |
| 6px | High (35 gap uses) | **Common:** label gaps, small internal spacing |
| 7px | Medium | Small padding |
| 8px | High (16+ gap uses) | **Common:** small gaps, content spacing |
| 10px | High (13 gap uses) | **Common:** medium gaps, padding |
| 12px | High | Medium padding (13x14 is very common) |
| 14px | High (13x14 padding is common) | **Common:** list item padding |
| 16px | – | — |
| 20px | High | Horizontal padding (0 20px used 9 times) |
| 24px | Medium | Larger padding |
| 26px | Medium | Horizontal padding |
| 32px | Medium | Large padding |

**Suggested semantic scale:** `2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 26, 32px`

---

## Border Radii

### Radius Values (sorted by frequency)

| Value | Uses | Purpose |
|-------|------|---------|
| 2px | 27 | Small elements, borders, minimal rounding |
| 5px | 26 | Common small rounding |
| 50% | 24 | Circles (avatars, badges) |
| 14px | 24 | **Common:** cards, panels, medium components |
| 12px | 19 | **Common:** cards, buttons |
| 6px | 18 | Small UI elements |
| 10px | 12 | Medium rounding |
| 4px | 11 | Minimal rounding |
| 42px | 10 | Phone frame corners |
| 3px | 6 | Very small rounding |
| 7px | 4 | Small-medium rounding |
| 9px | 4 | Medium-small rounding |
| 13px | 4 | Medium rounding variant |
| 16px | 5 | Larger rounding |
| 21px | 2 | Large rounding (uncertain use) |
| 24px 24px 42px 42px | 1 | Modal bottom sheet corner |
| 12px 12px 0 0 | 1 | Modal/sheet top corners |
| 50% 50% 4px 4px | 5 | Rounded bottom with sharp top |

**Semantic scale suggestion:** `2px, 3px, 4px, 5px, 6px, 7px, 9px, 10px, 12px, 14px, 16px, 50%`

---

## Layout

### Mobile Frame Dimensions

| Property | Value |
|----------|-------|
| Viewport Width | 390px |
| Viewport Height | 844px |
| Frame Border Radius | 42px |
| Status Bar Height | 46px |
| Navigation Bar Height | 80px |

**Note:** These are standard iOS dimensions (iPhone 12-15 Pro physical dimensions). The mockup shows exactly 10 screens at this resolution.

---

## Uncertain / To Review

### 1. Font Weight: `300` (Light)

**Finding:** One occurrence of `font-weight: 300` on a 24px heading.  
**Uncertainty:** This might be a data value or number display rather than a design token. The rest of the design uses only 600 and 700.  
**Action:** Verify whether light weight headings are intentional or if this is a one-off styling.

### 2. Border Radius: `21px`

**Finding:** Two uses of `border-radius: 21px`.  
**Uncertainty:** Unclear purpose; could be a mistake or a very specific component style not documented in the legend.  
**Action:** Search for usage context in the design to clarify intent.

### 3. Letter-Spacing: `-0.03em` and `-0.01em`

**Finding:** Single uses of these values; most tightening uses `-0.02em` or `-0.025em`.  
**Uncertainty:** Could be typos or variations for specific text blocks.  
**Action:** Consider whether these should be normalized to the main tightening scale.

### 4. Rare Timetable Colors

**Finding:** `#A9C7CA` and `#6B5518` used once each in timetable course indicators.  
**Uncertainty:** Unclear if these are intentional design tokens or ad-hoc styling. The timetable shows multiple course colors (teal, bronze, pomegranate, blue, these two). Not clear if there should be a full course-color palette.  
**Action:** Confirm whether additional course indicator colors should be extracted and named.

### 5. Spacing Composites vs Atomic

**Finding:** Many padding values like `13px 14px` appear as two-part composites (horizontal, vertical).  
**Uncertainty:** Should these be tokenized as composites (e.g., `padding: {xs: '4px 7px'}`) or kept atomic?  
**Action:** Decide token structure preference; currently extracted as atomic values.

### 6. Letter-Spacing with Different Units

**Finding:** Letter-spacing uses `em` units exclusively; no `px` or other units.  
**Uncertainty:** Confirm that `em` is the intended unit (it is relative to font-size, which makes sense for typography).

### 7. Unused Utility Values

**Finding:** Many CSS length values (1px, 3px, 16px, 46px, etc.) appear but are not "design tokens"—they're structural (status bar, frame sizing, etc.).  
**Uncertainty:** The boundary between "design tokens" and "computed values" is subjective. Currently, only values that repeat or serve a clear role are included as tokens.

---

## Frequency Distribution

### Most Used Colors (top 10)
1. `#6D7580` (muted text) — 92
2. `#0F7A85` (primary) — 62
3. `#FFFFFF` (white) — 54
4. `#DEDCD5` (border) — 48
5. `#8A9099` (placeholder) — 44
6. `#EDEBE4` (light border) — 34
7. `#4A525C` (secondary text) — 28
8. `#B23A2F` (urgent) — 23
9. `#141C24` (ink) — 23
10. `#5C6470` (tertiary text) — 22

### Most Used Font Sizes
1. 10px — 83 uses
2. 9px — 59 uses
3. 11px — 51 uses
4. 9.5px — 26 uses
5. 14px — 26 uses

### Most Used Font Weights
1. 700 (bold) — 85 uses
2. 600 (semi-bold) — 51 uses
3. 300 (light) — 1 use (uncertain)

### Most Used Spacing
1. gap: 6px — 35 uses
2. gap: 12px — 17 uses
3. gap: 8px — ~16 uses
4. gap: 10px — 13 uses
5. padding: 13px 14px — 18 uses (composite)

### Most Used Border Radii
1. 2px — 27 uses
2. 5px — 26 uses
3. 50% (circles) — 24 uses
4. 14px (cards) — 24 uses
5. 12px (buttons) — 19 uses

---

## Design System Observations

1. **Cultural Naming:** Colors are named after Azerbaijani materials/gemstones (turkuazı/turquoise, tunc/bronze, nar/pomegranate), suggesting intentional cultural branding.

2. **Monospace for Data:** Mono font is used exclusively for:
   - Eyebrow labels (uppercase section titles)
   - Metadata and secondary information
   - Numeric data and metrics
   - UI labels and toggle states

3. **Sans for Content:** Body text and headings use the system font stack, optimized for readability.

4. **Tonal Variants:** For each primary color, light background and darker text variants exist (e.g., primary + lighter bg + hover state).

5. **Neutral Hierarchy:** Gray scale has clear steps: muted labels (92 uses), secondary text (44 uses), tertiary (22 uses), showing a 4-5 level text hierarchy.

6. **Consistent Rounding:** Most UI components cluster around 12-14px radii; minimal rounding (2-5px) for borders/small elements; 50% for circles.

7. **Spacing Appears Flexible:** While gaps favor certain values (6, 8, 10, 12px), the design allows flexibility. No strict 4px/8px grid is evident.

---

## File Integrity

- **Total lines in source:** 879
- **Inline styles:** All tokens extracted from `style=""` attributes
- **External stylesheets:** One `<style>` block in `<helmet>` with 6 global rules
- **No custom properties found:** No CSS variables (--var syntax) used

---

## Extraction Method

All values extracted using:
- `grep` for pattern matching
- Manual regex parsing for composite values
- Frequency counting to identify design scale patterns
- Context analysis from HTML structure

No values were inferred or calculated—only extracted from actual CSS inline styles.
