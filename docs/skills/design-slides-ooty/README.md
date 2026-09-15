# `design-slides-ooty`

A reusable agent skill for transforming source content into modern, visually compelling, presentation-ready slides. It is designed for agents that create, restructure, or polish HTML presentations, slide decks, and PowerPoint-style deliverables.

## What this skill provides

The skill gives an agent a practical design system and workflow for:

- Turning dense content into a clear narrative spine and slide-by-slide takeaways.
- Selecting layouts based on the content type instead of repeating a single template.
- Establishing visual hierarchy through typography, color, whitespace, imagery, icons, diagrams, and charts.
- Designing readable metrics, comparisons, processes, timelines, frameworks, case studies, recommendations, and closing slides.
- Reviewing rendered output for density, accessibility, clipping, overlap, broken assets, and inconsistent spacing.

The full operating instructions are in [`SKILL.md`](./SKILL.md).

## When agents should use it

Use this skill whenever the task involves creating or editing slides, an HTML presentation, a presentation-style web page, a pitch deck, a report deck, or a PowerPoint-like visual narrative. Trigger it especially when the request asks for a deck to feel **modern**, **professional**, **polished**, **visual**, **presentation-ready**, or **less text-heavy**.

Use it for both:

1. **New decks:** convert a brief, notes, research, product requirements, or data into a coherent slide story.
2. **Existing decks:** improve hierarchy, layouts, visual consistency, charts, diagrams, imagery, density, and final rendering quality.

Do not treat it as a generic writing guide. It is specifically for deciding what belongs on the visual surface and how the audience should read it.

## Agent operating sequence

Follow this sequence unless the task explicitly requires a different order:

1. Read [`SKILL.md`](./SKILL.md) before designing.
2. Identify the audience, objective, desired action, brand constraints, output format, aspect ratio, and delivery environment.
3. Convert the source into a narrative spine and one takeaway per slide.
4. Classify each slide by content need, then choose a matching layout.
5. Define the visual system before styling the entire deck: type scale, palette, grid, spacing, icon treatment, image treatment, and chart conventions.
6. Build the slides using the available presentation-generation or editing workflow. Keep editable elements editable when the tool supports it.
7. Render the deck and inspect representative slides, including the densest slide, the most visual slide, and the chart or diagram slide.
8. Correct clipping, overlap, illegibility, weak contrast, overcrowding, broken assets, and repetitive layouts before delivery.
9. Confirm that each slide advances the narrative and that the close leaves a specific implication or action.

## Quality bar

A successful result should make the audience understand the main point of each slide quickly, without requiring the presenter to decode the layout. Every element must earn its space. When a slide is overcrowded, split or redesign it; do not simply shrink the text.

The skill favors a restrained, coherent visual system over decoration. It expects semantic use of color, concise insight-led titles, purposeful whitespace, readable charts, and diagrams that explain relationships rather than reproduce paragraphs.

## Repository layout

```text
docs/skills/design-slides-ooty/
├── README.md   # Agent-facing discovery and usage guide
└── SKILL.md    # Full skill metadata and operating instructions
```

## Maintenance and validation

Keep `SKILL.md` under 500 lines and preserve valid YAML front matter with both `name` and `description` fields. When updating the skill, validate it with:

```bash
python /home/ubuntu/skills/skill-creator/scripts/quick_validate.py /home/ubuntu/skills/design-slides-ooty
```

The repository copy should remain functionally aligned with the canonical local skill at `/home/ubuntu/skills/design-slides-ooty/SKILL.md` when that environment is available. If the skill is changed in this repository, update the canonical copy or document the intentional divergence.

## Contribution guidance

Keep additions concise and operational. Add a rule only when it changes an agent’s design decision or prevents a recurring quality failure. Prefer examples, decision rules, and checklists over abstract design theory. Avoid adding framework-specific implementation details unless they are required by the repository’s presentation workflow.
