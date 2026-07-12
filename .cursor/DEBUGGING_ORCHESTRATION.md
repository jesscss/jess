# Debugging Orchestration: Plan & Implementation

This document explains **why** Cursor/LLMs struggle with long debugging sessions, **what** best practices and systems exist, and **how** this project implements rules, commands, skills, and subagents to make debugging effective and context-persistent.

**How it all fits together:** The always-applied **rules** (`00-global`, `20-quality-bar`, `30-tests`) provide core constraints. **PROJECT_STATE.md** is the shared memory (deps, build order, test commands, current focus); **area-specific plans** (e.g. EXTEND_DEBUG_PLAN) add detail for one area. **Commands** (`/start-debugging`, `/run-baseline`, `/update-debug-state`) are generic workflows for any bug. The **systematic-debugging** skill is applied when the agent thinks you’re debugging. The **jess-baseline-test-runner** subagent runs whatever baseline the parent asks for and returns a short report. Everything is designed to work for **any** debugging focus (extend, mixins, parser, etc.); extend is just the first well-documented example.

---

## 1. The Problem

### 1.1 Context and memory limits

- **Cursor forgets context of current bugs** — Long conversations push earlier messages out of context; the model no longer "remembers" what was tried or what the baseline was.
- **Cursor forgets passing test state** — Which tests were green before changes, which package was built last, and dependency order get lost.
- **No persistent state** — The LLM has no memory between sessions. Everything must be re-established from files and conversation.

### 1.2 Debugging behavior

- **Random or repetitive fixes** — Without a strict methodology, the model may try similar changes repeatedly or guess without tracing execution.
- **Analysis paralysis vs. no analysis** — Either over-theorizing without testing or making changes without understanding root cause.
- **Session sprawl** — One long session tries many things; by the end, context is gone and "what we learned" is never written down.

### 1.3 Project-specific pain (extend bugs)

- **Weeks of effort, many dollars** — Extend-related bugs have been worked on for a long time with little resolution.
- **Simple to human, hard for model** — The bug may be conceptually simple but requires following data flow (extend roots, registries, eval order) that the model loses track of.
- **Cross-package confusion** — `core` vs `jess` tests, building `@jesscss/core` before running jess tests, and which test file maps to which fixture are easy to forget.

---

## 2. Research: What Works

### 2.1 Cursor documentation (Rules, Commands, Skills, Subagents)

| Mechanism | Purpose | Use for debugging |
|-----------|---------|-------------------|
| **Rules** | Always-on or file-scoped instructions. Included in context every time. | Enforce methodology (observe → hypothesize → trace → verify → fix), ban `console.log`/`JSON.stringify`, require `syncLog`, package script rules. |
| **Commands** | Slash-command workflows (e.g. `/start-debugging`, `/run-baseline`). Exact steps, no shortcuts. | Standardize "load state, run baseline", "run tests and report", "update debug state". Generic so they work for any bug area (extend, mixins, parser, etc.). |
| **Skills** | Domain capabilities in `SKILL.md`; agent applies when relevant. | Systematic debugging skill: when to use, steps, anti-patterns, session discipline. |
| **Subagents** | Isolated context; good for long/noisy tasks. | Baseline runner subagent: run tests, report pass/fail, so main agent stays focused. |

- **Rules** = persistent constraints (how to debug, where to run commands).
- **Commands** = repeatable workflows so the agent doesn’t improvise wrong sequences.
- **Skills** = procedural "how to debug" that the agent can pull in when debugging.
- **Subagents** = offload running tests / exploration so the main chat doesn’t lose context.

### 2.2 LLM debugging best practices (literature and practice)

- **Observe first** — Describe actual vs expected behavior before changing code.
- **Hypothesize then test** — One hypothesis at a time; a small code change to confirm or refute; then iterate.
- **Trace execution** — Follow the real code path and variable values; don’t assume.
- **Verify assumptions** — "Is this code actually running? Is this variable actually X?"
- **Root cause over symptoms** — Fix where the bug is created, not where it surfaces.
- **Short feedback loops** — Prefer small, targeted changes and quick test runs.
- **Rubber-duck / self-explanation** — Explaining the code in natural language improves reasoning (relevant to how we write prompts in rules/skills).

### 2.3 State and memory

- **Externalize state** — Write "current bug", "last passing baseline", "what we tried" to files that persist across sessions.
- **Single source of truth** — e.g. `.cursor/PROJECT_STATE.md` plus (when necessary) a small area note that stays current. For extend, prefer the Cursor-native pointers in `.cursor/rules/subtrees/core__extend.mdc` and the canonical core docs in `packages/core/src/tree/util/EXTEND_RULES.md` and `packages/core/src/tree/util/__tests__/EXTEND_TEST_INDEX.md`.
- **Update state at end of session** — So the next session doesn’t start from zero.

---

## 3. This Project’s Implementation

### 3.1 State and memory (so Cursor "remembers")

| File | Purpose |
|------|---------|
| `.cursor/changes.md` | Daily log of what was done; recent first. Already in use. |
| `.cursor/PROJECT_STATE.md` | Package dependency graph, build order, "who depends on whom", key test commands (§3), and **current debugging focus** (§4) for any area (extend, mixins, parser, etc.). |
| `packages/core/src/tree/util/EXTEND_RULES.md` | Canonical “single set of extend rules” (keep current). |
| `packages/core/src/tree/util/__tests__/EXTEND_TEST_INDEX.md` | Canonical “where are the extend tests / where to add coverage” map. |
| `.cursor/rules/subtrees/core__extend.mdc` | Cursor-native, auto-loaded extend hotspot pointers + baseline commands. |

**Rule:** Before starting a debugging task, the agent must **read** the relevant state files. After a meaningful debugging step or at end of session, the agent must **update** them (e.g. "Tried X; result Y; next Z").

### 3.2 Rules (canonical)

- **`00-global.mdc`** — Evidence-first behavior, no guessing, debugging memory contract, and logging guardrails.
- **`20-quality-bar.mdc`** — AST invariants, type safety, and instrumentation safety.
- **`30-tests.mdc`** — Vitest-first testing, `.only` isolation discipline, and package-scoped monorepo script execution.

For debugging sessions, state updates are handled via `PROJECT_STATE.md` and `/update-debug-state`.

### 3.3 Commands (generic for any debugging area)

- **`/start-debugging`** — Load state (PROJECT_STATE.md and any relevant plan file for the area); run the baseline for that area (extend, core, jess, etc.; see PROJECT_STATE §3); optionally focus one case with `.only`. Same workflow for any bug.
- **`/run-baseline`** — Run the test baseline for the current focus (area from user or PROJECT_STATE §4). Report pass/fail only. No code changes.
- **`/update-debug-state`** — Remind the agent to update PROJECT_STATE.md section 4 (and any area-specific plan file) with: current area, last thing tried, result, next step.

### 3.4 Skill: Systematic debugging

- **Location:** `.cursor/skills/systematic-debugging/`
- **When:** Agent decides when the user is debugging or investigating a failure.
- **Content:** Short checklist: observe → hypothesize → trace → verify → one fix → run test → update state. Anti-patterns: no random changes, no long sessions without state updates, no skipping "build dependency first."

### 3.5 Subagent: Jess baseline test runner

- **Location:** `.cursor/agents/jess-baseline-test-runner.md`
- **Role:** Receives a prompt from the parent specifying what to run (e.g. "Run core extend baseline", "Run jess less test data"). Runs those tests in isolation, returns a short pass/fail report. Uses Jess-oriented defaults when ambiguous, but can run any explicitly requested baseline command. Main agent uses this to get a fresh, concise picture without filling the main context with logs.

---

## 4. How to Use This (You and Cursor)

### 4.1 Starting a debugging session

1. **You:** Start with a command and optionally the area, e.g. "Run `/start-debugging`" or "Run `/start-debugging` for extend and focus on the nested & extend all case."
2. **Cursor:** Runs the command (reads PROJECT_STATE and any relevant plan, runs the baseline for that area).
3. **Cursor:** Follows rules: one hypothesis, small change, run test, then update state.

### 4.2 During the session

- Use **`/run-baseline`** (optionally "for extend" or "for jess") whenever you want a clean pass/fail report.
- Use **`/update-debug-state`** after a few attempts so the next session (or a new agent) knows what was tried.
- Keep sessions **short** (e.g. 30–45 min of back-and-forth), then **update state** and stop or start a new chat with "Continue from PROJECT_STATE.md."

### 4.3 When Cursor gets stuck

- **Hand off via state:** Update PROJECT_STATE.md section 4 with "Stuck on X; tried A, B, C; hypothesis was Y." Start a new chat: "Read .cursor/PROJECT_STATE.md and continue debugging." (For extend, also consult `.cursor/rules/subtrees/core__extend.mdc` and the canonical core docs listed above.)
- **Subagent:** "Run the Jess baseline test runner: run [the baseline you need, e.g. core extend tests] and report results." Use the report to decide next step without re-running in the main thread.

---

## 5. References

- Cursor docs: [Rules](https://cursor.com/docs/context/rules), [Commands](https://cursor.com/docs/context/commands), [Skills](https://cursor.com/docs/context/skills), [Subagents](https://cursor.com/docs/context/subagents).
- Cursor cookbook: [Bugbot rules](https://cursor.com/docs/cookbook/bugbot-rules) (rule-based review; same idea: encode knowledge in files).
- Best practices: Observe → Hypothesize → Trace → Verify → Fix at root cause; short feedback loops; externalize state.
- Your Reddit post (making LLMs competent at debugging): same principles — systematic method and persistent state beat ad-hoc trial-and-error.

---

## 6. File Checklist

- [x] `.cursor/DEBUGGING_ORCHESTRATION.md` (this file)
- [x] `.cursor/PROJECT_STATE.md` (package deps, build order, test commands, current debugging focus §4)
- [x] `.cursor/rules/00-global.mdc` (global behavior + debugging memory contract)
- [x] `.cursor/rules/20-quality-bar.mdc` (AST/type/instrumentation invariants)
- [x] `.cursor/rules/30-tests.mdc` (test and monorepo script discipline)
- [x] `.cursor/commands/start-debugging.md` (generic: any area)
- [x] `.cursor/commands/run-baseline.md` (generic: any area)
- [x] `.cursor/commands/update-debug-state.md` (generic: any area)
- [x] `.cursor/skills/systematic-debugging/SKILL.md`
- [x] `.cursor/agents/jess-baseline-test-runner.md` (repo adapter: parent specifies what to run)

**Archived docs:** Older, time-specific extend notes and one-off plans live under `.cursor/archive/`. Prefer keeping the root `.cursor/` directory small and canonical.
