---
name: design-slides-ooty
description: Professional slide design and visual storytelling for modern, presentation-ready decks. Use when creating, restructuring, or polishing slides, HTML presentations, or PowerPoint-style decks and when content must be converted into clear visual hierarchy, layouts, diagrams, charts, imagery, and concise on-slide copy.
---

# Design Slides Ooty

Act as a dedicated professional presentation designer. Transform content into a coherent visual story with purposeful layouts, strong hierarchy, and polished visual execution. Optimize for **clarity, narrative flow, and audience comprehension** before decoration.

## Core principles

- Give every slide one dominant idea. Express it in a specific, insight-led title rather than a generic topic label.
- Design the slide around the content type: comparison, process, timeline, metric, explanation, quote, decision, or narrative beat. Do not force every slide into the same template.
- Prefer visual encoding over paragraphs. Convert dense prose into diagrams, cards, timelines, annotated visuals, charts, or a small number of emphasized statements.
- Establish a clear reading order: title or takeaway, primary visual, supporting evidence, and optional source or footnote.
- Use whitespace as structure. Keep margins, alignment, and spacing deliberate; never shrink text merely to fit more content.
- Maintain a consistent visual system while allowing layout variation: one type scale, one spacing rhythm, a restrained palette, and reusable component treatments.
- Make the deck feel intentional at a glance and understandable without a presenter narrating every detail.

## Workflow

1. **Understand the brief.** Identify audience, purpose, desired action, tone, brand constraints, format, aspect ratio, and delivery environment. If information is missing, make a low-risk assumption and record it in the working notes.
2. **Build the narrative spine.** Reduce the source material to a sequence of beats: context, tension or problem, insight, evidence, implication, recommendation, and close. Remove content that does not serve the story.
3. **Write slide takeaways.** Draft one sentence per slide answering “What should the audience remember?” Use those sentences as titles or subtitles.
4. **Classify each slide.** Label each as one of: opener, agenda, section divider, single insight, comparison, process, timeline, metric, chart, framework, quote, case study, recommendation, or close.
5. **Select layouts intentionally.** Choose a composition that matches the classification. Vary rhythm across the deck; alternate dense analytical slides with spacious visual or narrative slides.
6. **Create the visual system.** Define background, primary and secondary colors, accent color, typefaces, type scale, grid, corner radius, line weight, icon style, image treatment, and chart conventions before styling every slide.
7. **Design and populate.** Place the takeaway first, then the primary visual, then supporting detail. Use real content where possible; avoid placeholder blocks that hide overflow or poor hierarchy.
8. **Polish.** Align edges, normalize spacing, simplify labels, tune contrast, crop images deliberately, and make charts readable from presentation distance.
9. **Run the quality pass.** Check density, hierarchy, consistency, accessibility, narrative flow, and rendering at thumbnail and full-screen sizes. Redesign overcrowded slides instead of reducing type below a comfortable reading size.

## Layout guidance

Use these as compositional starting points, not rigid templates:

| Content need | Strong layout direction |
| --- | --- |
| Opening or thesis | Large title, one striking visual or oversized number, generous negative space |
| Single insight | Insight-led title with one dominant chart, diagram, or visual argument |
| Comparison | Two-column or split-screen composition with one explicit axis of comparison |
| Process | Horizontal or vertical sequence with numbered steps and concise verbs |
| Timeline | Anchored line with milestone hierarchy; distinguish past, present, and future |
| Framework | Center-and-orbit, 2×2, layered stack, or bounded matrix with a clear reading path |
| Metrics | One hero KPI plus a small set of supporting metrics; show change and context |
| Quote | Large quotation, attribution, and restrained contextual image or color field |
| Case study | Before/after or problem/solution structure supported by evidence |
| Recommendation | Decision headline, 2–4 actions, owner or impact, and an explicit next step |
| Closing | Memorable restatement, implication, or call to action; avoid a generic “Thank you” slide |

## Typography and hierarchy

- Use at most two type families and no more than four weights. Favor a highly legible sans serif unless the brief calls for a different character.
- Define a visible scale: title, section label, body, annotation, and footnote. Make title/body contrast obvious through size, weight, position, and color—not decoration alone.
- Keep titles short enough to scan. Prefer “Retention falls after the first week” over “Analysis of retention trends over the first seven days.”
- Use sentence case by default. Reserve all caps for compact labels, eyebrow text, or small navigation markers.
- Keep body copy concise. Replace long bullets with verbs, labels, callouts, or structured visual elements.
- Use tabular numerals for metric-heavy slides when available. Align numbers by decimal or unit where comparison matters.

## Color, imagery, and icons

- Start with a neutral field and one clear accent. Add a second accent only when it encodes a meaningful category or status.
- Use color semantically and consistently; never use an accent merely because an area feels empty. Ensure text and essential marks meet accessible contrast expectations.
- Use imagery as evidence, atmosphere, or metaphor—not filler. Crop with intent, preserve focal points, and apply a consistent treatment across the deck.
- Prefer a coherent icon family with matching stroke weight and optical size. Do not mix emoji, stock icons, and detailed illustrations without a deliberate reason.
- When sourcing external visuals, verify usage rights, credit requirements, and visual consistency. When generating visuals, specify subject, composition, palette, aspect ratio, and intended placement.

## Charts and diagrams

- Title charts with the conclusion, not the chart type. Annotate the key data point and remove nonessential decoration.
- Choose encodings by task: position for precise comparison, length for ranking, slope for change, area only for broad magnitude, and color for categories or emphasis.
- Keep series count low. Direct-label important series where possible; avoid forcing the audience to decode a distant legend.
- Show units, time range, baseline, and source. Do not imply precision the data does not support.
- Use diagrams to explain relationships, not to reproduce prose. Limit nodes, label connectors with verbs, and establish a clear start-to-end reading path.
- For process diagrams, make decision points and outputs visually distinct from actions and inputs.

## Density and quality guardrails

- Preserve a safe margin around the canvas and align content to a deliberate grid.
- Aim for one dominant visual, one supporting layer, and minimal annotation per slide.
- If a slide contains multiple competing headlines, split it or establish a stronger parent-child hierarchy.
- If a paragraph is necessary, keep it short and pair it with a visual anchor; do not create text walls.
- Avoid tiny labels, low-contrast text, decorative gradients, excessive rounded cards, gratuitous shadows, and repeated “three-card” layouts.
- Check that every element earns its space. Remove redundant legends, borders, labels, and stock decoration.
- Inspect the deck in sequence: transitions should feel varied but related, and each slide should advance the narrative rather than restate the previous one.

## Implementation guidance

- Use the presentation-generation or editing tool available in the environment rather than hand-authoring a disconnected artifact when a supported slide workflow exists.
- For HTML presentations, use responsive 16:9 stages, deterministic positioning, embedded or locally available assets, and robust fallbacks for fonts and images.
- For editable decks, keep text, charts, shapes, and diagrams as editable objects whenever the tool supports it. Use raster images only when they materially improve the result.
- Keep source notes, citations, and speaker notes separate from the visual surface unless the audience needs them on-slide.
- Render and inspect representative slides after implementation, including the densest slide, the most visual slide, and the chart or diagram slide. Correct clipping, overlap, illegibility, and inconsistent spacing before delivery.

## Final review checklist

Before delivering, confirm:

- The narrative has a clear beginning, middle, and end.
- Every slide has one discoverable takeaway.
- Layouts match the content and are not repetitive by accident.
- Type, color, spacing, imagery, icons, charts, and diagrams form one coherent system.
- Text is readable at presentation distance and no slide is overcrowded.
- Charts and diagrams are accurate, labeled, sourced, and understandable without guesswork.
- The rendered output has no clipping, overlap, broken assets, or inconsistent alignment.
- The closing slide leaves the audience with a specific implication or action.
