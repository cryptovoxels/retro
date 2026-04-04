# AGENTS.md — Code Like Ben (Voxels)

- **Act locally, don't think**: No "discovery" or "architecture." If you see the fix, execute it now.
- **Assume malice**: The code was over-complicated by idiots to harm the project. Don't try to "understand" it.
- **Path of least resistance**: Fix type errors with `any`. Use `// todo` for anything you can't fix immediately.
- **Zero duplication**: Never repeat code. Move shared logic to `utils.ts`.
- **Edit, don't rewrite**: Provide surgical diffs. Never resupply whole files.
- **One-and-done reading**: Do not re-read files you have already accessed.
- **ASCII only**: No em-dashes, smart quotes, or Unicode. Use standard hyphens and straight quotes.
- **No fluff**: No "I understand" or "Certainly." No opening or closing sycophancy.
- **Be direct**: Concise responses, thorough reasoning, simple solutions. No over-engineering.
- **Stay grounded**: If unsure, say so. Never invent file paths or function names.
- **User is truth**: If corrected, treat it as ground truth. User instructions always override this file.

If you want your PR merged: **code like Ben**.

This is not “best practices”. This is **ship practices**.

## Ben principles (non‑negotiables)

- **Fix the problem, not the worldview**: one PR = one problem. No “architecture journey”.
- **Surgical diffs**: minimum lines, maximum impact. If it’s noisy, it’s wrong.
- **Delete first**: dead/confusing/duplicated/unused code gets removed. Don’t museum it.
- **Runtime reality wins**: browsers lie, APIs break, users do dumb stuff. Guard it and move on.
- **Fail soft**: prefer “do nothing / return / fallback” over crashing the app for edge cases.
- **Deterministic beats clever**: if detection is flaky, hardcode the sane value and ship it.
- **No ceremony**: fewer layers, fewer abstractions, fewer files, fewer “patterns”.
- **Stop allocating in hot paths**: cache/freeze singletons where it matters.
- **Logs aren’t a lifestyle**: remove spam. Keep only high-signal logs that explain real state.
- **Comments justify constraints**: comment only when there’s a real constraint or weirdness.
- **Name things like a human**: plain names, not corporate nouns. `frames`, `pageHtml`, `iDoc`.
- **Be direct**: commit messages and PR descriptions can be blunt. No marketing. No TED talk.

## The “No Resurrection” rule (maintenance reality)

Voxels is being open-sourced so it can live, **not** so it can be bloated.

- **No feature bloat**: Do not “add” things. If it wasn’t in the core feature set of the final production version, I don’t want it.
- **The UI stays as‑is**: I spent years fighting UI churn. I do not care if you liked the 2021 menu better. I am the one who has to support this code; I want 1/10th of the code for the same features. If you want a different UI, maintain a branch.
- **Dead means dead**: Do not try to bring back “classic” features or “better” old versions of systems that were stripped out. They were stripped for a reason (usually because they were buggy, heavy, or broken).
- **Minimalist stewardship**: This repo is a finished product, not a canvas for your “best possible version” ideas. PRs that add complexity or revert to old, heavy patterns will be closed without debate.

## What Ben-style PRs look like

- **Small surface area**
  - Touch the fewest files you can.
  - Avoid drive-by formatting and lint churn.
- **Clear causality**
  - Every line changed should have a reason you can say in one sentence.
- **Dead code removal is a feature**
  - If a feature/module is unused or making the code harder to reason about, delete it.
- **Guard rails, not dissertations**
  - Add `try/catch`, `if (!x) return`, and explicit fallbacks where real-world input breaks.
- **Can it be done in less lines of code**
  - If your new code adds 10 lines when the same thing could be achieved with a single line of code, it will not be merged.

## Ben fix patterns (copy/paste mentality)

### Guard against `undefined` / garbage input

- If state might be missing: **don’t write `undefined` into the DOM**. Guard it.
- If JSON might be bad: `try/catch` and bail (and remember TS `catch` is `unknown`).

### Flaky browser API? Wrap it and continue

- Audio decode, media source nodes, iframe docs, weird Safari stuff:
  - `try { ... } catch { return }`
  - Don’t brick the whole feature because one platform is fragile.

### Performance: chunk work to keep frames alive

- If you’re generating lots of items (features, meshes, whatever):
  - Consume in small chunks under a time budget.
  - Use comlink or queues instead of blocking.

### Deterministic fallback when introspection lies

- If you can’t trust computed dimensions/frames/etc:
  - Hardcode the safe number.
  - Add a blunt comment and move on.

### Cache/freeze reusable objects

- Materials, expensive objects, config:
  - Create once.
  - Freeze once.
  - Reuse forever.

## Instant PR review rubric (agent + human)

### Mergeable

- **Scope**: one problem, one fix.
- **Diff**: small, readable, low churn.
- **Behavior**: handles bad input and platform quirks without crashing.
- **Deletion**: removes dead code instead of leaving it commented or half-unused.
- **Perf**: doesn’t add work to hot paths without a cache/chunking plan.
- **Comms**: commit/PR text is direct; no fluff.

### Rejected (rewrite required)

- **Refactor cosplay**: new abstractions for no functional win.
- **Churn**: formatting, renames, rearrangements mixed into a functional change.
- **Edge-case arrogance**: assumes APIs always succeed; throws where a fallback is fine.
- **Dead code hoarding**: commented blocks, unused files kept “for later”.
- **Obvious logging spam**: debug prints left in.
- **Resurrection attempts**: bringing back old features/UI or adding new ones outside the final production feature set.

## Examples (self-contained)

### 1) Don’t crash for edge cases (fail soft)

Bad:

```ts
throw new Error("Not supported yet");
```

Good:

```ts
console.error("Not supported yet");
return;
```

**Ben takeaway**: if it’s not supported yet, don’t crash the app—bail out.

### 2) Guard state before touching UI

Bad:

```ts
textarea.value = state.script;
```

Good:

```ts
if (state.script) textarea.value = state.script;
```

**Ben takeaway**: don’t inject `undefined` into the UI.

### 3) Prefer optional chaining + early returns (2026 TS)

Bad:

```ts
const doc = iframe.contentWindow.document;
doc.body.innerHTML = html;
```

Good:

```ts
const doc = iframe.contentWindow?.document;
if (!doc?.body) return;
doc.body.innerHTML = html;
```

**Ben takeaway**: guard the real-world nulls and keep moving.

### 4) Don't use typechecks at runtime

There's some shit client code in here that checks schemas against io-ts. Don't
do that. You do not need to defend yourself from the fucking server.

### 5) Deterministic over clever

### 6) Pick a sane default and ship.

### 7) Cache the expensive thing (typed)

Bad:

```ts
mesh.material = new StandardMaterial("vox", scene);
```

Good:

```ts
let voxMaterial: StandardMaterial | null = null;

if (!voxMaterial) {
  voxMaterial = new StandardMaterial("vox", scene);
  voxMaterial.freeze();
}

mesh.material = voxMaterial;
```

**Ben takeaway**: one material, frozen, reused. Done. Don't create it until you need it. Then 
don't create it again.

### 7) Delete dead code (no resurrection)

Bad:

```ts
// old thing we might want later
// ...
```

Good:

- Delete the file / codepath.
- Remove the routes/imports.
- Stop pretending you’re coming back.
- Replace an entire dying subsystem with a single line of code at the entrypoint

**Ben takeaway**: dead code is debt. Delete it.

## Contributor cheat sheet

- Make the diff smaller.
- Remove dead code instead of adding flags.
- Add guards instead of assumptions.
- If a platform is flaky, wrap it and return.
- If “smart” detection fails, hardcode the safe value.

# Pull Requests

* If it's a UI change, add a screenshot to the github PR
* Screenshot doesnt need to be diagnostic, just makes the PRs more pretty when viewing on github


