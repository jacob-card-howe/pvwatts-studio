---
name: PVWatts Studio
description: A calibrated solar modeling workspace that makes official PVWatts estimates precise, legible, and approachable.
colors:
  brand-blue: "#1257D1"
  panel-black: "#000000"
  deep-panel-blue: "#00396E"
  console-navy: "#001C36"
  input-well: "#071A2B"
  light-readout-blue: "#5ADBFF"
  signal-cyan: "#00B5F1"
  instrument-aqua: "#62DAFC"
  solar-yellow: "#FFD140"
  success-green: "#3BD5AE"
  fault-orange: "#FB471F"
  analysis-fern: "#027669"
  analysis-river: "#4295A9"
  analysis-gold: "#D0AF22"
  analysis-maroon: "#9E3124"
  hardware-gray: "#878A8F"
  text-primary: "#F7FBFF"
  text-secondary: "#B8C7D5"
  card-surface: "rgba(0, 57, 110, 0.3)"
  card-hover: "rgba(18, 87, 209, 0.28)"
  border-cyan: "rgba(90, 219, 255, 0.34)"
  border-subtle: "rgba(90, 219, 255, 0.16)"
typography:
  headline-data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "1.85rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "normal"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.775rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.05em"
  measurement:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.825rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  xl: "24px"
  pill: "9999px"
spacing:
  xxs: "0.25rem"
  xs: "0.35rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  control: "1.15rem"
  surface: "1.25rem"
  section: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.brand-blue}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    typography: "{typography.body}"
  button-outline:
    backgroundColor: "{colors.card-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.card-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  input:
    backgroundColor: "{colors.input-well}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0.55rem 0.75rem"
    typography: "{typography.body}"
  navigation-active:
    backgroundColor: "{colors.brand-blue}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 1rem"
    typography: "{typography.body}"
  solar-value-badge:
    backgroundColor: "rgba(255, 209, 64, 0.1)"
    textColor: "{colors.solar-yellow}"
    rounded: "{rounded.sm}"
    padding: "0.15rem 0.5rem"
    typography: "{typography.measurement}"
  status-success:
    backgroundColor: "rgba(59, 213, 174, 0.09)"
    textColor: "{colors.success-green}"
    rounded: "{rounded.md}"
    padding: "0.55rem 0.8rem"
    typography: "{typography.body}"
---

# Design System: PVWatts Studio

## Overview

**Creative North Star: "The Solar Instrument Panel"**

PVWatts Studio should feel like calibrated solar test equipment translated into a teaching workspace. The black and deep-blue canvas recedes while structured panel layers, cyan instrument lines, yellow energy readouts, and green validation signals make the model's state immediately visible. The system is technical because the work is technical, but every label, unit, grouping, and state should help a first-time student orient rather than make expertise a prerequisite.

The chosen character is **layered and calibrated**: tonal depth and precise borders establish hierarchy before any glow appears. Translucency, blur, shadow, and illumination are functional instrument effects—not atmosphere applied indiscriminately. The UMass Lowell-derived palette is a binding visual identity, but the interface does not need to name the institution and must never use the palette to imply affiliation or endorsement.

**Key Characteristics:**
- Deep black and navy operating canvas with calibrated blue surface layers.
- Solar yellow reserved for energy, measured emphasis, and physical control feedback.
- Cyan and brand blue carry navigation, information, focus, and actionable state.
- Compact sans-serif interface language paired with monospaced measured values.
- Dense but strongly grouped layouts that remain precise, never intimidating.
- Restrained ambient depth with selective signal glow.

## Colors

The palette behaves like an instrument legend: dark hardware establishes the field, blue identifies structure and interaction, and high-chroma accents communicate specific kinds of information.

### Primary
- **Instrument Blue** (`#1257D1`): primary actions, selected navigation, and the strongest brand-bearing control state.
- **Deep Panel Blue** (`#00396E`): slider tracks, structural blue fields, and the darkest blue layer above black.
- **Panel Black** (`#000000`): root canvas and sticky-header foundation; it keeps dense data from feeling visually foggy.

### Secondary
- **Signal Cyan** (`#00B5F1`): active information, chart lines, focus-oriented feedback, and technical highlights.
- **Light Readout Blue** (`#5ADBFF`): cyan-tinted borders, status copy, and high-legibility accents on dark surfaces.
- **Instrument Aqua** (`#62DAFC`): supporting analytical series and occasional high-clarity comparison marks.
- **Analysis River** (`#4295A9`): restrained comparison-series color and secondary instrumentation.

### Tertiary
- **Solar Charge** (`#FFD140`): calculated AC energy, slider handles, energy charts, and the most important measured emphasis.
- **Valid Green** (`#3BD5AE`): successful calculations, selected locations, completion feedback, and positive status—not decoration.
- **Fault Orange** (`#FB471F`): errors and interrupted calculations that need corrective attention.
- **Analysis Fern** (`#027669`), **Analysis Gold** (`#D0AF22`), and **Analysis Maroon** (`#9E3124`): additional parametric-series colors used only when a multi-series comparison needs clear separation.

### Neutral
- **Console Navy** (`#001C36`): raised dark surface, tooltip field, and deep structural backdrop.
- **Input Well** (`#071A2B`): recessed fields and numeric-entry surfaces.
- **Instrument White** (`#F7FBFF`): primary text and values.
- **Secondary Readout** (`#B8C7D5`): labels and supporting text that must remain comfortably legible.
- **Hardware Gray** (`#878A8F`): tertiary metadata and quiet attribution.
- **Calibrated Card Layer** (`rgba(0, 57, 110, 0.3)`): translucent content panels over the dark canvas.
- **Structural Cyan** (`rgba(90, 219, 255, 0.34)`) and **Quiet Structural Cyan** (`rgba(90, 219, 255, 0.16)`): control borders and subtle surface divisions.

### Named Rules

**The Energy Has a Color Rule.** Solar yellow belongs to energy output, measured emphasis, and direct manipulation feedback; it is not a generic decorative accent.

**The Signal Semantics Rule.** Blue and cyan mean interaction or information, green means valid or complete, and orange means error or recovery. Never swap these roles for visual variety.

**The Full-Palette Exception Rule.** Use the extended fern, river, gold, and maroon accents together only in parametric comparison views where series distinction is functional.

## Typography

**Display Font:** The native interface sans stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Helvetica`, `Arial`, sans-serif)

**Body Font:** The native interface sans stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Helvetica`, `Arial`, sans-serif)

**Label/Mono Font:** The native monospaced data stack (`ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, monospace)

**Character:** The sans-serif stack keeps controls immediate and platform-familiar; the mono stack turns calculated values, units, table cells, coordinates, and field measurements into aligned readouts. Weight, case, and spacing create hierarchy without introducing a separate display personality.

### Hierarchy
- **Headline Data** (800, `1.85rem`, `1.1`): KPI values and the strongest numeric outcomes; use tabular alignment where values update or compare.
- **Title** (700, `1.05rem`, `1.5`): card, panel, and chart headings.
- **Body** (400, `0.875rem`, `1.5`): explanations, controls, and supporting interface copy.
- **Label** (600, `0.775rem`, `0.05em`, uppercase only for KPI/table metadata): scan labels and compact categories, never paragraph content.
- **Measurement** (700, `0.825rem`, `1.5`): values attached to controls, units, coordinates, and tabular data.

### Named Rules

**The Two-Voices Rule.** Sans-serif explains and directs; monospace measures and compares.

**The No Faux Terminal Rule.** Do not use monospace for prose, navigation, or headings merely to make the interface feel technical.

**The Units Stay Attached Rule.** Keep units visually subordinate but adjacent to their values, and never rely on position alone to explain a measurement.

## Layout

The primary desktop workspace uses a fixed control rail beside a flexible results field: a `380px` parameter column and a `1fr` output column inside a centered `1440px` container. The major gutter is `1.5rem`; cards and results use the same `1.5rem` rhythm so controls, metrics, charts, and tables read as one calibrated system rather than a collection of widgets.

Within the results field, four KPIs form an adaptive row, paired charts form a two-column grid, and the monthly table spans the full field. Tight spacing belongs inside a parameter group; larger spacing separates different tasks or output classes. At `1080px` and below, controls stack above results. At `900px` and below, paired charts stack into a single column. Horizontal table overflow is preserved rather than crushing measurement columns.

The composition is dense by design, but hierarchy must remain obvious within a few seconds: current calculation state first, headline results second, trends third, detailed values fourth. New layouts should preserve a direct line from an input change to its updated result.

**The Control-to-Result Rule.** Inputs and their consequences must remain in the same working context; do not hide primary results behind a separate route or modal.

**The Group Before Space Rule.** Use proximity to bind labels, values, and controls, then use the larger section rhythm to separate tasks. Do not make every gap equal.

## Elevation & Depth

Depth is layered and calibrated. Dark tonal surfaces and cyan-tinted one-pixel borders establish most hierarchy; soft, offset shadows separate panels from the canvas without making them float. Backdrop blur reinforces the sticky header and translucent instrument panels when content actually passes beneath them. Colored halos are reserved for active brand controls, solar manipulation, information focus, or confirmed success.

### Shadow Vocabulary
- **Surface Low** (`0 1px 2px 0 rgba(0, 0, 0, 0.05)`): quiet separation for small controls where a border alone is insufficient.
- **Instrument Panel** (`0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)`): default card and panel depth.
- **Raised Overlay** (`0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.25)`): location results, toasts, and temporary elements that sit above the work surface.
- **Solar Signal** (`0 0 20px -5px rgba(255, 209, 64, 0.25)`): decorative energy emphasis only; never a substitute for structural elevation.

**The Structure Before Glow Rule.** Establish hierarchy with tone, border, and offset shadow first. Add glow only when it communicates active, focused, solar, or successful state.

**The One Raised Plane Rule.** Reserve the strongest shadow for overlays and temporary feedback; ordinary cards share one quieter elevation plane.

## Shapes

The form language is gently engineered rather than sharp or pillowy. Small elements use a `6px` radius, standard controls use `10px`, cards use `16px`, and only large framing surfaces may reach `24px`. Full pills (`9999px`) are reserved for badges, slider tracks, and inherently capsule-shaped indicators.

Cyan-tinted one-pixel borders describe control boundaries and panel structure. A thin top rail or compact glow may mark a measured output, but thick colored side borders are not part of the language. Circular geometry belongs to direct physical metaphors such as slider thumbs, the compass dial, progress spinners, and status dots.

**The Nested Radius Rule.** Inner controls must use a smaller radius than the surface containing them, preserving the sense of assembled instrumentation.

## Components

### Buttons
- **Shape:** compact, gently curved controls (`10px` standard radius; `6px` inside tab groups).
- **Primary:** Instrument Blue to Deep Panel Blue treatment with Instrument White text and `0.5rem 1rem` padding; compact actions use `0.35rem 0.75rem`.
- **Hover / Focus:** slightly brighten and lift primary actions by one pixel; focused controls receive a visible blue/cyan ring. Disabled or loading buttons reduce opacity, retain readable text, and do not lift.
- **Outline:** translucent deep-blue fill, cyan-tinted border, and primary text; hover increases the surface blue and border clarity rather than changing semantic color.

### Chips
- **Style:** compact capsule or small-radius readout with a low-alpha semantic fill, matching border, and high-chroma label.
- **State:** Solar Charge for measured-value badges; green for completed or selected states. Do not use chips as generic decoration.

### Cards / Containers
- **Corner Style:** gently curved instrument enclosure (`16px`).
- **Background:** translucent Calibrated Card Layer over Panel Black or Console Navy.
- **Shadow Strategy:** default Instrument Panel elevation; borders carry more hierarchy than shadow.
- **Border:** one-pixel Quiet Structural Cyan at rest, strengthening modestly on hover.
- **Internal Padding:** `1.25rem`, with `1rem` or `1.5rem` gaps between related surfaces.

### Inputs / Fields
- **Style:** recessed Input Well background, one-pixel Structural Cyan border, `10px` radius, and `0.55rem 0.75rem` padding.
- **Focus:** Instrument Blue border plus a restrained blue focus ring; retain the dark well so focus does not invert the field.
- **Error / Disabled:** Fault Orange belongs to actual validation or service failure. Disabled controls reduce opacity and keep their label and current value legible.

### Navigation
- **Style:** tabs sit within a translucent Deep Panel Blue group with a subtle border. Inactive tabs use Secondary Readout; hover reveals a faint cyan layer; the active tab uses Instrument Blue and Instrument White with a restrained brand glow. The sticky header remains black-dominant so navigation does not compete with live results.

### KPI Readouts
- **Style:** each result uses a thin yellow-to-cyan calibration rail, an uppercase sans-serif label, a large monospaced value, a smaller attached unit, and green explanatory metadata.
- **Behavior:** copy actions remain subordinate until hover or focus. Updating values must not shift the card's structure.

### Charts and Tables
- **Style:** Solar Charge represents AC energy; Signal Cyan represents solar radiation; grid lines stay quiet and cyan-tinted. Table headings use a deeper blue field, numeric cells use monospace, and the primary AC column receives measured yellow emphasis.
- **Behavior:** tooltips use Console Navy with semantic series color. Multi-series views draw from the extended analysis palette and never reuse indistinguishable hues.

### Status and Progress
- **Style:** information uses cyan, success uses green, and error uses orange over semantically tinted dark fields. Loading overlays occupy the chart they block and explain both the current phase and whether progress is measured or indeterminate.

## Do's and Don'ts

### Do:
- **Do** preserve the UMass Lowell-derived palette while keeping institutional naming optional and non-affiliation explicit.
- **Do** use Solar Charge to connect energy controls, charts, and calculated AC output.
- **Do** make every measurement's label, value, and unit understandable without relying on color alone.
- **Do** build hierarchy with tonal layering and cyan-tinted borders before adding shadow or glow.
- **Do** keep technical density approachable through strong grouping, plain labels, progressive disclosure, and visible system status.
- **Do** use the extended accent family when a parametric comparison genuinely needs multiple distinguishable series.

### Don't:
- **Don't** imply that the palette or interface represents sponsorship, endorsement, or an official NLR, NREL, Department of Energy, PVWatts, or UMass Lowell product.
- **Don't** use Solar Charge, Valid Green, or Fault Orange interchangeably; each has a fixed semantic job.
- **Don't** spread glow, blur, or translucency across every surface; instrument effects must explain depth or state.
- **Don't** use monospace as a technical costume for prose, navigation, or general headings.
- **Don't** extend the logo's legacy white-to-blue text gradient into headings, KPIs, or body copy.
- **Don't** display the full accent family outside analytical comparison contexts.
