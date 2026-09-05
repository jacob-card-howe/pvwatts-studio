---
target: static/index.html
total_score: 34
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/Users/jacob/Work/pvwatts-studio/static/index.html"
target_fingerprint: "sha256:2b052ab0d468077df463651d00c48584bcf7a202ba283f3ff1e937314c836914"
target_path: /Users/jacob/Work/pvwatts-studio/static/index.html
timestamp: 2026-09-05T03-20-27Z
slug: static-index-html
---
⚠️ DEGRADED: single-context (two required dual-agent attempts failed: the first used a VM-only cwd alias, then both eligible LM Studio subagent models were unavailable with connection errors)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 4 | Simulation, location search, recalculation, copy, quota, sweep progress, cancellation, and completion all expose timely state. |
| 2 | Match System / Real World | 3 | The flow now speaks in task language, but NLR, NSRDB, DC/AC, and GCR still assume some solar-modeling context. |
| 3 | User Control and Freedom | 3 | The 77-run sweep is cancellable and tabs are reversible; Reset still has no undo. |
| 4 | Consistency and Standards | 4 | Inputs, readouts, semantic colors, tabs, disabled states, charts, tables, and exports now agree. |
| 5 | Error Prevention | 4 | Native constraints, stale-result clearing, disabled outputs, explicit sweep assumptions, quota acknowledgement, and seven-request batches prevent the prior trust failures. |
| 6 | Recognition Rather Than Recall | 4 | Quick-estimate grouping, the mobile result bridge, visible units, contextual definitions, and the sweep baseline keep needed context on screen. |
| 7 | Flexibility and Efficiency | 3 | Slider-plus-number inputs, keyboard tabs, automatic recalculation, advanced disclosure, exports, and batch comparison are efficient; there are no expert keyboard accelerators. |
| 8 | Aesthetic and Minimalist Design | 3 | The instrument-panel hierarchy is disciplined, but the complete mobile results path and expanded monthly-loss editor remain long. |
| 9 | Error Recovery | 3 | Errors preserve inputs, clear invalid stale outputs, explain recovery, and allow sweep cancellation; recovery still relies on changing an input rather than a dedicated retry action. |
| 10 | Help and Documentation | 3 | Metric and advanced-setting definitions are contextual and concise, but there is no single interpretation guide and sweep results stop at data rather than insight. |
| **Total** |  | **34/40** | **Good — release-ready foundation with a few focused usability opportunities** |

## Design Specificity Verdict

**LLM assessment:** PVWatts Studio now feels strongly authored for solar modeling rather than like a generic dark dashboard. The solar-yellow measurement language, cyan radiation signal, physical azimuth/tilt instruments, model provenance strip, current-assumption sweep baseline, and KPI→trend→monthly-detail progression all reinforce the product’s “Solar Instrument Panel” north star. The mobile adaptation preserves that identity instead of merely stacking desktop cards. The remaining category-generic behavior is at the end of analysis: the comparison produces a chart and matrix but does not translate them into a solar-specific learning takeaway.

**Deterministic scan:** `impeccable detect --json static/index.html` exited 2 with **11 findings**, down from **23** at baseline: `gradient-text` 2, `dark-glow` 6, `side-tab` 2, and `design-system-radius` 1. There are now **zero low-contrast findings, zero tiny-text findings, and zero design-system-color findings**. The remaining findings are contextual false positives against the committed system: DESIGN.md explicitly sanctions the legacy logo gradient (`static/styles.css:159`), selective active/solar signal glows (`static/styles.css:149, 209, 540, 555, 706, 917, 925`), KPI and parametric calibration rails (`static/styles.css:756`, `1009`), and the reported 2px radius belongs to the roof instrument line (`static/styles.css:705`), not a container.

**Visual overlays:** Mutable injection succeeded. Overlays are visible in the **[Human]** browser session and the live detector emitted 22 informational markers, primarily the same sanctioned glow/gradient/rail patterns plus palette, line-length, and progress-width-transition advisories. No runtime accessibility or console errors appeared. The overlay itself introduced temporary horizontal overflow through its own controls; a clean mobile session measured `scrollWidth === innerWidth` at 393px.

## Overall Impression

This pass converts a visually credible prototype into a trustworthy working instrument. The biggest remaining opportunity is to help students interpret results—not merely receive them—especially after the expensive tilt/azimuth comparison.

## What’s Working

1. **The first-use path now leads directly to value.** Location and system size appear first, automatic recalculation is stated plainly, and the mobile bridge shows annual energy before users enter orientation details.
2. **High-trust behavior matches the interface promise.** CSV columns mirror the visible table, stale results clear on failure, exports/copy remain disabled without valid results, and the sweep visibly inherits current system size and losses.
3. **Accessibility is structural, not cosmetic.** Tabs implement selected state and arrow-key navigation, live regions announce feedback, focus rings are consistent, all tested mobile controls meet 44px height, and every chart has a table/text alternative.

## Priority Issues

### [P2] The comparison ends with data instead of a decision

- **Why it matters:** After spending up to 77 API requests, a student must inspect seven lines or a 77-cell matrix to determine the best orientation and whether it materially improves on the current setup.
- **Fix:** Add a compact post-run interpretation stating the highest modeled tilt/azimuth, annual AC energy, and percentage difference from the current orientation. Keep the chart and full table as evidence.
- **Suggested command:** `/impeccable onboard`

### [P2] Reset remains irreversible

- **Why it matters:** Reset immediately replaces every tuned assumption. The action is easy to trigger and there is no way to restore the previous configuration, weakening the otherwise strong user-control story.
- **Fix:** Capture the prior non-secret parameter state and provide a short-lived Undo action in the announced toast; never persist or include the API key.
- **Suggested command:** `/impeccable harden`

### [P2] Monthly irradiance losses still expand into a 12-field wall

- **Why it matters:** Advanced users can handle the domain, but editing a uniform or seasonal loss requires repetitive entry and makes the only expanded decision point exceed the four-item working-memory guideline.
- **Fix:** Add “Apply to all months,” “Clear,” and optional seasonal presets while retaining all 12 exact fields for expert correction.
- **Suggested command:** `/impeccable distill`

## Cognitive Load

**Moderate only when Advanced Settings is expanded: 2 of 8 checks fail; low in the default quick-estimate path.** Chunking and minimal choices fail in the monthly irradiance editor because 12 peer fields appear simultaneously. Single focus, grouping, hierarchy, one-thing-at-a-time flow, working-memory support, and progressive disclosure pass. The quick-estimate group has four decisions; orientation/losses has three; the comparison baseline has four readouts.

## Persona Red Flags

**Jordan (first-time student):** Jordan can now start with location and size without encountering credentials, and KPI definitions explain the result. The remaining valley arrives after a completed sweep: there is no explicit “best orientation” takeaway, so Jordan must interpret the chart unaided.

**Sam (keyboard/screen-reader user):** The primary flow now exposes named controls, semantic tabs, visible focus, live status, 44px mobile targets, and tabular chart alternatives. The residual burden is the long linear sequence of 12 monthly-loss inputs when Advanced Settings is opened; an apply-all control would reduce both motor and navigation cost.

**Casey (distracted mobile user):** The compact two-row header and live annual bridge preserve context without horizontal page overflow. Full results still require a long scroll, and JSON/CSV actions occupy prominent header space once results exist even though interpretation is usually the next mobile task.

## Minor Observations

- At 393px, the clean page has no horizontal document overflow; the monthly table scrolls within its wrapper as intended.
- Mobile export buttons now have stable accessible names even when their visible labels shorten to JSON/CSV.
- Rate-limit recovery explains that a personal key is needed, but it could open the collapsed API Access disclosure contextually.
- The independent-project disclaimer remains visible without overpowering the modeling task.
- Automated validation passes: 35 Python tests, JavaScript syntax check, and `git diff --check`.

## Questions to Consider

- Should the comparison’s peak moment teach **the best orientation**, **the sensitivity around the optimum**, or both?
- Is Reset primarily a classroom convenience that should support Undo, or should it become a less prominent action?
- Do advanced users usually enter one monthly loss for the whole year, a seasonal pattern, or 12 independent values?
