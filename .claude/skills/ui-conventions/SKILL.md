---
name: ui-conventions
description: Any UI work in apps/web: design tokens, Turkish text rules, simple mode, reduced motion, accessibility, layout from spec §3.
---

# UI conventions (spec §3, §8.2)

- Next.js App Router + React + Tailwind. Shared components in `packages/ui`.
- **Design tokens** in one place (colors, spacing, radius, font). Light, off-white left menu; white work area. No hard-coded colors.
- **Text:** all UI text in translation files (`apps/web/messages/tr.json` first, en later). Use plain workshop language ("İçini boşalt", "Sadece çember (kanal)"), never CAM jargon without explanation. Use Turkish number format in the UI (1.220 × 2.440 mm) while data stays in mm numbers.
- **Simple mode** for old computers: no 3D, no heavy animation.
- **Reduced motion:** honor `prefers-reduced-motion`; pause animations when the tab is hidden; turn them off on small screens.
- **Accessibility:** keyboard navigation, focus rings, labels, contrast ≥ 4.5:1.
- Heavy work (nesting, toolpath) runs in a Web Worker; the UI never freezes.
- The UI never mutates the project directly; it always calls commands (command-layer skill).
- Every screen needs empty, loading and error states.
- Menu: Ana sayfa, Makineler, Projeler, Şablonlar, Oluştur, Ayarlar, plus a prominent "+ Yeni proje".
- The `frontend-design` skill may be used for visual quality.
