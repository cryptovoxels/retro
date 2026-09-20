# AGENTS.md

## scope and judgment

- This is gamedev. Keep Voxels small and maintainable.
- Make the smallest complete fix, not the smallest diff. Correctness comes before line count.
- Find the cause before editing. Read the relevant caller, implementation, and build configuration when the problem crosses those boundaries.
- Refactoring the affected path is in scope. Unrelated cleanup, formatting, and architecture changes are not.
- When replacing a system, carry over its required behavior and delete the obsolete implementation, dependencies, and configuration.
- Preserve functionality unless the user explicitly approves removing it. Do not add features, redesign the UI, or resurrect removed systems unless asked.
- Do not hide regressions behind fallbacks, `any`, or `todo` comments. Fix required work before calling the task complete.
- Follow the approved plan. If evidence makes it incorrect, explain the issue and resolve it rather than blindly implementing it.
- User instructions override this file. If a material ambiguity remains, ask a focused question. Make routine implementation decisions yourself.

## code

- Prefer direct code at the calling site. Add helpers only for concrete reuse or a clear reduction in complexity; no speculative layers, dispatchers, or configuration.
- Share repeated logic when it prevents real duplication. Use an appropriate existing `utils.ts` when useful, not as a dumping ground.
- Delete dead code instead of leaving commented code, unused imports, or compatibility scaffolding.
- Use plain names. Function names should have no more than two words, such as `voxelCollider` or `hullPoints`.
- Give every parameter an immediate purpose. Do not build for hypothetical callers.
- Comments explain constraints or surprising behavior. Keep logs limited to useful state and failures.
- Use ASCII in new code, comments, and written output.

## runtime and performance

- `BABYLON` is loaded globally. Use Babylon observables, never `requestAnimationFrame`.
- Avoid allocations in hot paths. Reuse expensive objects and freeze materials when appropriate.
- Chunk expensive work under a time budget or use workers so frames stay responsive.
- Guard genuinely missing state and malformed external input. Do not add runtime schema validation for our own server responses.
- Handle known browser API failures locally. A fallback must preserve acceptable behavior; it must not silently conceal a broken build or load path.
- Use deterministic defaults for known platform quirks and explain the constraint. Do not hardcode around an unexplained regression.

## UI

- Keep the existing UI and styling unless the task calls for changes.
- Use simple forms: `<div class="f">` containing a label and input. Add few classes; never use class names starting with a hyphen. Remove those prefixes when changing the affected markup and selectors.
- Layout changes are fine when needed. Use `1rem` padding. Do not add decorative styling, borders, solid backgrounds, or font sizes unless asked.
- Never use `border-radius` or hardcoded colors; use CSS variables for colors.
- Write UI copy in direct, specific, human language with warmth and DIY personality. Use lower case subheadings. No corporate hedging.

## client data

- Web pages use `cachedFetch` from `web/src/helpers/cached-fetch.ts` instead of raw `fetch` (default cache TTL: 60 seconds).
- After a mutation, call `invalidateUrl(url)` before routing back to the affected view.
- Use `await invalidateUrl(url, true)` to immediately re-fetch and warm the cache. Wildcard prefixes such as `/api/parcels/123/*` invalidate related entries.

## public API

- If adding, removing, or changing a route described in `server/openapi.yaml`, update the spec in the same PR.
- After editing the spec, run `npm run docs:api` and include the generated API page and `llms.txt` changes.
- `server/test/openapi-routes-test.ts` fails for documented routes that no longer exist and warns about undocumented routes. Keep the documentation accurate.

## verification and delivery

- Verify the behavior that failed. A successful build alone is not enough; build and worker changes need runtime checks of the affected load path.
- Re-read code when needed to verify a change. Run relevant checks and report anything you could not verify.
- Before committing, run `pnpm run precommit` and fix the errors.
- Keep each PR focused on one problem. Explain the change, its reason, and the verification concisely. Include a screenshot for UI changes.
- Before adding checks to `.github/workflows/check.yml`, measure the job. Keep it within 60 seconds, avoid slowing development, and use objective checks rather than complexity scores.
- Be direct and concise. No fluff, invented facts, paths, or function names. State uncertainty and blockers plainly.
