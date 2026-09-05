---
target: static/index.html
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/workspace/static/index.html"
target_fingerprint: "sha256:1d5db532b21502c512e3da6e740421a8cb5aa92d08bbd99e9f84721ae9165992"
target_path: /workspace/static/index.html
timestamp: 2026-09-05T02-45-30Z
slug: static-index-html
---
⚠️ DEGRADED: single-context (all isolated sub-agent launches failed: provider credits/connections were unavailable, and both external runners crashed with `MODULE_NOT_FOUND`)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Simulation, search, copy, and sweep states are visible, but transient toasts are not announced and the expensive sweep cannot be cancelled. |
| 2 | Match System / Real World | 3 | Domain terminology is accurate, but “NLR API Key,” “NSRDB,” “capacity factor,” and advanced modeling terms need more teaching context for students. |
| 3 | User Control and Freedom | 2 | Location results support Escape, but Reset has no undo and the 77-request sweep has no cancel path. |
| 4 | Consistency and Standards | 3 | The visual system is cohesive, but Parametric Studio silently substitutes a fixed 6 kW system and 11% losses, and the CSV annual row does not match its headers. |
| 5 | Error Prevention | 2 | HTML constraints and smart defaults help, but export/copy actions remain enabled without results, numeric entries can trigger server-side errors, and the sweep lacks a cost/control checkpoint. |
| 6 | Recognition Rather Than Recall | 3 | Controls, units, defaults, and advanced disclosure are visible; automatic recalculation and several analytical terms are left for users to infer. |
| 7 | Flexibility and Efficiency | 3 | Debounced recalculation, slider-plus-number inputs, exports, Reset, and batch comparison are efficient; keyboard accelerators and a cancellable expert path are absent. |
| 8 | Aesthetic and Minimalist Design | 3 | The hierarchy is polished and coherent on desktop, but the long parameter rail and tiny supporting copy create density rather than calm. |
| 9 | Error Recovery | 3 | Errors preserve form state and rate-limit messaging is actionable, but recovery is mostly toast/status copy rather than contextual correction beside the source. |
| 10 | Help and Documentation | 2 | API-key and advanced-field hints exist, but there is no in-product glossary or task-focused help for interpreting outputs and assumptions. |
| **Total** |  | **27/40** | **Acceptable — a strong visual foundation with significant usability and trust gaps** |

## Design Specificity Verdict

**LLM assessment:** This is recognizably authored for PVWatts Studio, not a generic dashboard with a solar logo pasted on. The yellow energy encoding, cyan radiation signal, azimuth/roof dials, calibrated status strip, monospace measurements, and KPI→chart→table progression embody the “Solar Instrument Panel” direction. The limitation is structural: underneath those details, the composition remains a familiar dark admin dashboard—left filter rail, four KPI cards, paired charts, data table. Its product specificity is **moderately strong**, but the interaction model could teach solar modeling more distinctly.

**Deterministic scan:** `impeccable detect --json static/index.html` exited **2** with **23 findings**:

- `low-contrast`: **5**
- `tiny-text`: **6**
- `dark-glow`: **6**
- `gradient-text`: **2**
- `side-tab`: **2**
- `design-system-color`: **1 advisory**
- `design-system-radius`: **1 advisory**

The detector reported runtime-computed locations as `static/index.html:0`; the corresponding styles are mainly in `static/styles.css`:

- Gradient logo text: `static/styles.css:123-125`
- Muted 10.88–11.52px copy: `static/styles.css:354`, `415`, `526`, `540`
- Signal glows: `static/styles.css:114`, `173`, `468`, `633`, `843`, `851`
- KPI/parametric top rails: `static/styles.css:689-690`, `941-950`

The contrast and tiny-text findings are real. Several “slop” findings are contextual false positives: DESIGN.md explicitly permits the legacy gradient **only on the logo**, selective signal glows, KPI calibration rails, and the full accent family in parametric analysis. The `2px` radius advisory refers to an instrument line rather than a component container. The pure-white advisory is low-impact design-token drift, not a user-facing defect.

**Visual overlays:** No reliable user-visible overlay is available. Browser automation failed before navigation because `playwright-cli` was not installed in the VM; therefore mutable injection could not be proven and the detector live server was correctly skipped. I inspected the committed desktop visual at `docs/imgs/pvwatts_studio.png` against the current markup, CSS, and JavaScript. The temporary static server was stopped.

## Overall Impression

The desktop interface looks credible, technically literate, and unusually disciplined for a scientific calculator. Its biggest opportunity is to turn that visual authority into **operational confidence**: guide first-time students, guarantee keyboard/mobile access, and make every expensive or exported result transparently trustworthy.

## What’s Working

1. **The semantic palette carries real meaning.** Yellow consistently identifies energy and manipulated measurements, cyan represents information/radiation, and green marks valid completion. The page does not rely on arbitrary accent rotation.
2. **Inputs and consequences share one workspace.** On desktop, the fixed-width parameter rail sits beside KPIs, trends, and monthly detail, supporting direct cause-and-effect learning.
3. **The analytical hierarchy is excellent.** Users get status first, headline values second, trends third, and exact monthly values last. The table also provides a useful textual counterpart to the primary charts.

## Priority Issues

### [P1] The accessibility floor is below the visual quality

- **Why it matters:** Students using low vision, keyboard navigation, or assistive technology receive a materially worse product. The detector measured repeated `#878A8F` text around **3.7–3.8:1** and six text sizes below 12px. Generic `.btn`, `.nav-tab-btn`, and `.slider-input` controls lack explicit `:focus-visible` treatment (`static/styles.css:150-224`, `449-483`); the sweep is canvas-only; toast feedback has no live-region semantics.
- **Fix:** Raise consequential help/meta copy to at least 14px, move muted text to an AA-safe token, add consistent focus-visible rings to every interactive control, expose tab state with `aria-selected`, announce toasts, and provide a tabular/text summary for the parametric chart.
- **Suggested command:** `/impeccable audit`

### [P1] The desktop instrument panel collapses into a mobile obstacle course

- **Why it matters:** The only responsive rules stack the main grid at 1080px and charts at 900px (`static/styles.css:251-255`, `794-798`). The three-part header has no mobile strategy, while its logo, two navigation tabs, and two export buttons all resist compression. On a phone, users must traverse the entire parameter card before reaching any result, breaking the input→consequence learning loop.
- **Fix:** Create a compact mobile header with an overflow-safe navigation/action pattern; keep a live KPI/status summary above or adjacent to controls; group basic parameters into short sections; make export secondary after a successful calculation; enforce 44px touch targets.
- **Suggested command:** `/impeccable adapt`

### [P1] High-trust outputs contain hidden assumptions and insufficient control

- **Why it matters:** Parametric Studio says it evaluates the current location, but the sweep silently hard-codes `systemCapacityKw: 6` and `losses: 11` (`static/app.js:727-731`) while inheriting other current settings. It can spend up to 77 requests and cannot be cancelled. Separately, the CSV header is `Solar Radiation, AC Energy, DC Energy`, but the annual row writes `annualSolrad, annualAcKwh, kwhPerKw` (`static/app.js:827-831`), placing energy yield under “DC Energy.” These are credibility failures in an educational modeling tool.
- **Fix:** Show the full sweep baseline before execution, use current system values or clearly label a fixed comparison baseline, add cancellation/confirmation around quota-heavy work, correct the CSV annual schema, and add regression tests for exported column meaning.
- **Suggested command:** `/impeccable harden`

### [P2] The first-run hierarchy leads with credentials and jargon, not the learning task

- **Why it matters:** “NLR API Key” is the first form field, before location and system choices. Although optional, it makes access credentials feel like a prerequisite. The interface also never explicitly says that valid changes automatically recalculate results.
- **Fix:** Lead with location and a “Quick estimate” basic group; move the API key into a compact “API access” disclosure or surface it contextually after a rate-limit error; add “Results update automatically”; define capacity factor, energy yield, DC/AC ratio, and GCR inline.
- **Suggested command:** `/impeccable onboard`

### [P2] Actions advertise availability before the system can fulfill them

- **Why it matters:** Export and copy controls are active while KPI values are `—`; clicking only produces an error toast (`static/app.js:71-75`, `797-799`, `821-823`). Reset immediately destroys the current configuration without an undo affordance.
- **Fix:** Disable copy/export until a successful result exists, communicate why in accessible help text, move exports closer to the completed result state, and provide an undo toast for Reset.
- **Suggested command:** `/impeccable harden`

## Cognitive Load

**Moderate: 3 of 8 checks fail.**

| Check | Result | Evidence |
|---|---|---|
| Single focus | Pass | Simulator and Parametric Studio are cleanly separated. |
| Chunking | **Fail** | API access, location, five primary assumptions, orientation visualization, and advanced disclosure share one “System Parameters” card. |
| Grouping | Pass | Labels, sliders, numeric fields, and result classes are visually coherent. |
| Visual hierarchy | Pass on desktop | Status→KPIs→charts→table is immediately legible. |
| One thing at a time | **Fail on mobile** | Controls serialize into a long rail before any consequence is visible. |
| Minimal choices | Pass | No basic decision exposes more than four simultaneous options; selects contain larger sets without displaying them all. |
| Working memory | **Fail on mobile** | Users must remember prior input values while scrolling to distant results. |
| Progressive disclosure | Pass | Advanced Settings hides specialist inputs initially. |

**Decision points with more than four visible options:** Expanding **Advanced Settings** reveals 12 monthly irradiance-loss inputs at once. They are logically grouped, but still form a wall of parallel decisions without presets or a uniform-value shortcut.

## Emotional Journey

The opening communicates technical authority, and the immediate calculation status reduces uncertainty. Successful KPI illumination creates a satisfying peak: users see that their assumptions produced a real, sourced estimate. The valleys are the credential-first opening, the long mobile journey, and the 77-run sweep where the user loses control. The experience ends on a dense table and legal disclaimer; it lacks an educational “so what?”—for example, a concise statement of which assumption most influenced the estimate or what to compare next.

## Persona Red Flags

**Jordan (first-time student):** The first field asks for an “NLR API Key,” followed quickly by DC size, losses, tilt, azimuth, capacity factor, and NSRDB terminology. Smart defaults keep Jordan moving, but there is no explicit “start here,” no statement that results update automatically, and no glossary explaining how to interpret the four KPIs.

**Sam (keyboard/screen-reader user):** Slider focus can disappear because `.slider-input` removes outlines without adding a replacement. Navigation tabs do not expose selected state semantically. Toasts are visually transient but not live-announced. Small, low-contrast help copy is difficult at normal zoom, and the 77-series sweep result has no accessible data alternative.

**Casey (distracted mobile user):** Header actions are likely to crowd or overflow because no header breakpoint exists. Compact buttons and copy controls fall below the 44px touch-target target. Inputs precede results in a very long stack, and refreshing loses the current configuration. The API key must remain session-only by policy, but non-secret model parameters could still be recoverable.

## Minor Observations

- The compass and roof-pitch visuals are strong product-specific teaching devices; they deserve more prominence or richer directional labels.
- “High-Performance Solar Calculator” in the document title is less precise than the otherwise careful product voice.
- The status strip communicates model/version/grid provenance well and should remain prominent.
- The Reset handler changes the azimuth badge from “South” to “S,” a small terminology inconsistency.
- The desktop screenshot’s very wide canvas leaves large unused margins beyond the 1440px workspace, but the centered instrument enclosure still reads intentionally.
- The full-palette parametric rail is sanctioned by DESIGN.md; do not remove it merely to satisfy the detector.

## Questions to Consider

- Is the API key really part of the **primary modeling task**, or should it appear only when quota conditions make it relevant?
- Should Parametric Studio compare the exact current system, or a standardized 6 kW / 11% baseline that is explicitly taught and labeled?
- On mobile, is the primary success “configure every parameter,” or “see a credible estimate quickly and refine assumptions afterward?”
- What should a student understand at the end beyond the number—confidence in the estimate, sensitivity to assumptions, or the best next comparison?
