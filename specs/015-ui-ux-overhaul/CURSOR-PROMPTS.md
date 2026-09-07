# Cursor Prompts — XIRA UI/UX Refactor

Copy-paste each block, in order, into Cursor's chat panel. Every prompt assumes the working branch is `015-ui-ux-overhaul` and that the client-approved demo `specs/015-ui-ux-overhaul/XIRA-DESIGN-DEMO.html` is the visual source of truth.

Rules for the whole run:
- Do NOT touch API contracts, business logic, spec files under `specs/001..014`, or shared packages except for design tokens.
- After every phase: `pnpm --filter @einvoice/web lint && pnpm --filter @einvoice/web typecheck && pnpm --filter @einvoice/web test` MUST pass with zero warnings.
- One phase = one PR. Get review + client screenshot approval before starting the next phase.

---

## 0 · Kick-off (paste once at the start)

```
اقرأ الملفات دي بالكامل قبل ما تعمل أي حاجة:
1. specs/015-ui-ux-overhaul/UI-UX-REFACTOR.md — الـ brief والقواعد الصارمة
2. specs/015-ui-ux-overhaul/XIRA-DESIGN-DEMO.html — التصميم المعتمد من العميل (source of truth)
3. .specify/memory/constitution.md — المبادئ اللي ممنوع أخالفها
4. apps/web/src/styles/tokens.css — الـ tokens الحالية اللي هعدلها
5. apps/web/tailwind.config.ts — إعدادات Tailwind الحالية
6. apps/web/src/components/shell/app-shell.tsx — الـ shell الحالي

ما تبدأش تنفيذ. لما تخلص القراءة قوللي:
- إيه الفروق الرئيسية بين الـ tokens الحالية وتصميم XIRA؟
- إيه الصفحات اللي هتتغيّر بشكل جوهري (مش cosmetic)؟
- عندك أي أسئلة قبل ما نبدأ /speckit-plan؟
```

---

## 1 · Clarify (بعد ما Cursor يخلص القراءة)

```
/speckit-clarify

خد كل النقاط اللي محتاجة توضيح من UI-UX-REFACTOR.md وXIRA-DESIGN-DEMO.html. ركّز على:
- dark mode: هل نطلقه في P1 أم يتأجل لآخر phase؟
- الـ command palette: MVP في P2 يفتح modal بس بالـ nav destinations، أم نأجّله؟
- storybook: نستخدم Ladle أو dev-only page زي ما مكتوب في section 3.4؟
- الخطوط: next/font/google (recommended) أم link tags؟
- الترجمات الجديدة تحت أي namespaces؟
```

بعد ما ترد على أسئلته، كمّل:

```
جاوبت على كل نقاط الـ clarify. ثبّت الإجابات في نهاية UI-UX-REFACTOR.md تحت section "## Clarifications resolved".
```

---

## 2 · Plan

```
/speckit-plan

ابني خطة تنفيذ مفصلة لكل الـ 15 phase الموجودة في UI-UX-REFACTOR.md. لكل phase:
- الملفات اللي هتتعدل / هتتخلق (paths دقيقة)
- المكونات primitive اللي هتنشئ
- الـ tests اللي هتضاف
- Definition of Done
- الوقت المتوقع (hours)

اكتب الخطة في specs/015-ui-ux-overhaul/plan.md. لا تبدأ التنفيذ.
```

---

## 3 · Tasks

```
/speckit-tasks

فكك كل phase لـ tasks صغيرة (max 2h لكل task). كل task عليها ID زي P1-T01. اكتبها في specs/015-ui-ux-overhaul/tasks.md كـ checklist.
```

---

## 4 · Analyze (تدقيق ضد الـ constitution)

```
/speckit-analyze

راجع plan.md وtasks.md ضد .specify/memory/constitution.md. طلعلي أي conflicts أو مبدأ ممكن يتخرق. لو مفيش، أكّد ده صراحةً.
```

---

## 5 · Phase 1 — Design tokens & primitives

```
/speckit-implement

نفّذ Phase 1 من UI-UX-REFACTOR.md — Design tokens + UI primitives.

المصدر البصري: افتح XIRA-DESIGN-DEMO.html وشوف الـ CSS variables في :root، والألوان، والـ shadows، والـ primitives (.btn, .badge, .card, .input, .field). لازم الـ hex values عندنا تطابق الملف حرفيًا.

القيود:
- استبدل :root في apps/web/src/styles/tokens.css بالـ XIRA palette الكاملة (section 3.1 في الـ brief)
- عدّل tailwind.config.ts يعكس كل الألوان الجديدة
- حمّل الخطوط عبر next/font في apps/web/src/app/layout.tsx (IBM Plex Sans Arabic + Inter)
- اعمل كل الـ primitives تحت apps/web/src/components/ui/ زي section 3.2
- اعمل src/components/brand/xira-logo.tsx بشكلين on-dark / on-light
- اعمل src/lib/cn.ts (بدون clsx)
- اعمل dev-only page على /[locale]/(app)/_dev/ui لعرض كل الـ primitives
- اكتب smoke test لكل primitive
- ممنوع hex/px مباشرة في أي component — tokens بس
- ممنوع ml/mr/pl/pr — استخدم ms/me/ps/pe

بعد ما تخلص، شغّل:
pnpm --filter @einvoice/web lint
pnpm --filter @einvoice/web typecheck  
pnpm --filter @einvoice/web test

لو كل حاجة عدّت، commit بـ: "ui(P1): design tokens + XIRA primitives"
لو حصل fail، اوقف واعرض عليّ الـ output.
```

---

## 6 · Phase 2 — App Shell

```
/speckit-implement

نفّذ Phase 2 — App Shell بتصميم XIRA.

المصدر: افتح XIRA-DESIGN-DEMO.html، تبويب "لوحة التحكم". انسخ:
- .app-sidebar (deep navy #0a1628، nav groups بعناوين uppercase صغيرة، active link بـ shadow-brand)
- .nav-search (⌘K quick-search pill)
- .user-block أسفل الـ sidebar بـ avatar gradient
- .app-topbar (tenant pills + ETA env pill بـ 3 حالات)
- .brand-block بـ on-dark variant

قسم components/shell/app-shell.tsx إلى:
- Sidebar / SidebarNav / SidebarUser
- Topbar / TenantSwitcher (موجود بس أعد تصميمه) / EtaEnvPill (بديل EtaEnvironmentBadge) / ThemeToggle / UserMenu
- MobileNavDrawer (يفتح تحت md)
- CommandPalette (MVP: modal يعرض كل nav destinations قابلة للـ filter)

nav sections بالضبط زي section 4 في الـ brief.

Definition of Done + الـ tests + التحقق زي Phase 1.
```

---

## 7 · Phase 3 — Auth

```
/speckit-implement

نفّذ Phase 3 — Auth screens.

المصدر: تبويب "تسجيل الدخول" في XIRA-DESIGN-DEMO.html. مطلوب مطابقة hero-layout بالضبط:
- gradient خلفية hero (linear + radial glows)
- gradient text على span في العنوان
- glass stat cards تحت
- feature chips
- form icon-prefixed
- security footnote

اعمل apps/web/src/app/[locale]/(auth)/layout.tsx يحتوي على <AuthLayout> اللي فيه الـ hero-panel كـ children slot.

الصفحات الـ 3 (login/register/onboarding) تستخدم AuthLayout. Onboarding يبقى stepper 3 خطوات مع sessionStorage draft.

نفس القيود + التحقق.
```

---

## 8 · Phase 4 — Dashboard

```
/speckit-implement

نفّذ Phase 4 — Home / Dashboard.

المصدر: تبويب "لوحة التحكم" في الـ demo. نفّذ بالضبط:
- page-header بترحيب شخصي واسم tenant
- stats grid (4 KPIs مع stat-icon، left border ملوّن، delta up/down/flat)
- 2-column: آخر المستندات (جدول data) + قائمة تفعيل (progress bar + checklist) + widget ETA (بـ navy background)

استخدم موجود من lib/api/* — ممنوع تعمل endpoints جديدة. لو الـ data مش متاحة أعرض skeleton أو empty state.

نفس القيود + التحقق.
```

---

## 9 · Phases 5–13 — Pattern prompt

استخدم الـ template ده لكل phase من 5 لـ 13، غيّر بس اسم الـ phase والصفحات:

```
/speckit-implement

نفّذ Phase <N> — <اسم الـ phase>.

المصدر: افتح تبويب "<الاسم>" في XIRA-DESIGN-DEMO.html وطابق الـ layout والألوان والـ spacing.

للـ pages الكبيرة (>400 سطر): قسّمها إلى apps/web/src/app/[locale]/(app)/<route>/_components/*.tsx زي ما محدد في UI-UX-REFACTOR.md section <رقم الـ section>.

القيود:
- API endpoints نفسها، query keys نفسها، submit payloads نفسها
- data-testid ثابتة
- i18n keys الحالية ثابتة؛ الجديد يتضاف في ar.json + en.json
- ممنوع hex/px مباشرة، ممنوع ml/mr/pl/pr
- 4 states (loading/empty/error/success) موجودة

بعد التنفيذ: lint + typecheck + test. commit بـ "ui(P<N>): <summary>".
```

---

## 10 · Phase 14 — States pass

```
/speckit-implement

نفّذ Phase 14 — States pass.

لكل صفحة تحت apps/web/src/app/[locale]/(app|auth|platform)/**/page.tsx:
- تأكد أن الـ 4 states موجودة (loading = Skeleton، empty = EmptyState مع CTA، error = Card بلون danger مع Retry، success = الـ UI الحقيقي)
- استبدل أي alert() / confirm() بـ Toast / ConfirmDialog
- كل mutation تعرض Toast

ابنِ checklist في specs/015-ui-ux-overhaul/states-audit.md فيها كل route + ✅ لكل حالة موجودة.
```

---

## 11 · Phase 15 — Mobile & RTL audit

```
/speckit-implement

نفّذ Phase 15 — Mobile + RTL audit.

المطلوب:
1. Grep على الكود كله عن ml-/mr-/pl-/pr-/text-left/text-right/left-/right-/justify-start/justify-end واستبدلها بـ logical equivalents (ms-/me-/ps-/pe-/text-start/text-end/start-/end-)
2. راجع كل صفحة على viewport 375×667 في ar وفي en
3. صلّح: horizontal scroll في الجداول، buttons متكسّرة، top-bar overflow، chevrons/arrows اتجاه
4. اعمل apps/web/e2e/rtl-audit.spec.ts (Playwright أو @playwright/test لو مش موجود، أضفه كـ devDependency) يعمل screenshot لكل route في ar و en, mobile و desktop = 4 لقطات لكل route

اطلعّ التقرير في specs/015-ui-ux-overhaul/rtl-audit-report.md.
```

---

## 12 · Converge (لو حصل fail)

```
/speckit-converge

الاختبارات فشلت في Phase <N>. هنا الـ output:
<paste error output>

المطلوب: صلّح من غير ما تغيّر السلوك أو الـ API. لو التصحيح يحتاج تعديل في التصميم، اسألني قبل ما تنفذ.
```

---

## 13 · Final review

```
راجع كل PRs من P1 لـ P15. اعمل specs/015-ui-ux-overhaul/final-report.md فيه:
- عدد الملفات المعدلة / المضافة / المحذوفة
- قائمة كل الـ i18n keys الجديدة
- قائمة كل الـ tests الجديدة  
- coverage الحالي vs السابق (لو متاح)
- أي technical debt متبقي
- screenshots قبل/بعد لأهم 5 صفحات
```
