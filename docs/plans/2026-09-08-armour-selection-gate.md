# Cold review request — PACT: armour-selection-gate feature

## Goal

Get an independent, no-repo-access opinion on a design call made overnight without a human available
to confirm it, before a pull request built on that call is merged. This is a **retrospective**
review — the code is already written, tested, and sitting in an open PR — not a pre-implementation
plan review. The question is whether the call was right, and whether anything else in the approach
was structurally wrong.

## Context (self-contained — assume zero access to the actual repository)

PACT is a tabletop-RPG character-builder web app. Two web tools let a player build/edit a character
(pick species, class, buy stats, choose armour, etc.). A third tool lets a Dungeon Master (DM) run a
"campaign" that many players' characters belong to, and set campaign-wide rules — e.g. "these five
species are banned at my table," "these three drawbacks are banned."

One thing a character build has is a single "worn armour" choice, picked from a dropdown list of
every armour type the game defines (Leather, Studded Leather, Chain Mail, Plate, etc.). Two real
constraints exist around this choice in the game's rules:

1. **Proficiency.** A character only knows how to wear certain categories of armour (light / medium /
   heavy), based on their choices elsewhere in the build. Wearing armour outside your proficiency is,
   by real tabletop convention (this engine mirrors 5e-style D&D rules), something you flatly
   **cannot do effectively** — it produces no benefit and is treated as an error state.
2. **Strength.** Separately, some armour (medium and heavy categories generally, and some specific
   heavy armours even more strictly) requires a minimum Strength score to get its full benefit. Below
   that threshold, by the same real-world convention, the character can still **physically put the
   armour on** — it just gives no AC (defense) benefit, or imposes a movement penalty. This is
   traditionally treated as a **mechanical penalty**, not an impossibility.

**Before this feature:** the armour dropdown in both tools listed every armour with no restriction at
all. The underlying pricing/legality engine already computed two different warning messages when a
character had illegal armour — one using a "stop sign" glyph (⛔) for the proficiency case, one using
a "caution" glyph (⚠) for the Strength case — but neither warning actually *prevented* selecting the
armour in the first place; they only showed up after the fact in a warnings list.

**The two feature requests, verbatim, from the project owner, across two separate messages, with no
further clarification available (the owner said they were going to bed and asked for this to be built
autonomously overnight):**

> "i want to do the first one where the dm in a campaign only can allow certain armours per character
> for them to select to wear in their chargen and livesheet."

> "then do the wearing armour link to str and proficency."

**What was built, in response:**

- **Feature A (DM-set ban-list).** A DM can now mark specific armours as banned campaign-wide. A
  banned armour is disabled (shown greyed-out with a tooltip explaining why) in the dropdown for every
  character in that campaign, in both tools. This mirrors an already-existing pattern in the same
  codebase for banning species/character-boons/character-drawbacks/weapon-masteries/starting-classes —
  same mechanism, just extended to one more category.
- **Feature B (personal capability gate).** The dropdown now also disables (same greyed-out-with-
  tooltip treatment) any armour the character's *own build* isn't eligible for — and here is the
  actual design call under review: **both proficiency AND Strength were made hard gates**, disabling
  the option outright, rather than only proficiency being a hard gate and Strength staying an
  after-the-fact warning (which is what the existing ⛔-vs-⚠ severity distinction in the underlying
  engine would suggest, and which is closer to how real tabletop convention treats the two cases
  differently).
- **Grandfather clause (both features):** if a character *already* has an armour selected that later
  becomes banned or newly ineligible (a DM bans it after the fact, or an edit removes the character's
  proficiency), that existing choice is **not** automatically stripped — the dropdown just won't let
  them pick that armour *again* if they change it, and a separate build-validity check now flags the
  now-illegal state as visible (so a DM/player can see something is wrong) without silently deleting
  the player's prior choice.
- **Presentation choice:** disabled options are rendered as visible-but-unselectable (native HTML
  "disabled option" behavior — shown greyed out, with the reason as hover-text), rather than being
  removed from the list entirely.
- **Scope/shipping choice:** the two features were originally going to be built as two separate,
  independently reviewable pull requests (separate branches). In practice, once implementation
  started, the code for both ended up needing to live in the exact same function (the same dropdown-
  building logic has to check "is this armour banned?" and "is this armour usable by this build?" at
  the same time, for the same list of options) — so they were shipped together as one PR instead of
  two.

## Verified vs. Assumed

**Verified** (by the person/session that built this, against the actual codebase):
- The underlying pricing engine already computed exactly these two warnings (proficiency = "stop
  sign" severity, Strength = "caution" severity) before this feature — this distinction already
  existed in the codebase's own established convention, it just wasn't enforced at selection time.
- The DM-set-ban-list mechanism for other categories (species, boons, drawbacks, etc.) already existed
  in a fully generic, reusable form before this feature — extending it to armour required no new
  architecture, only new configuration.
- No pricing/AC-calculation logic was touched — only the dropdown's option-generation logic. The
  project's own automated regression suite for pricing/legality output (73 fixture checks) was
  confirmed to still pass unchanged after this feature.

**Assumed / judgment call, not verified against any external source:**
- That "the DM should be able to restrict armour" and "wearing armour should be linked to STR and
  proficiency" together imply the owner wanted STR treated with the *same severity* as proficiency
  (a hard block), rather than STR staying an advisory warning while only proficiency became a hard
  block. This is the specific thing being sent for review.
- That shipping both features in one PR, rather than two, was an acceptable practical compromise
  rather than a scope violation the owner would object to.

## Proposed approach (already implemented — described here for the reviewer's judgment, not as a
future plan)

1. Add a new DM-configurable list, "banned armour," using the codebase's existing generic
   "banned list" mechanism (already used for five other categories) — no new pattern invented.
2. Add a new, self-contained legality-check function to the pricing/rules engine: given a build and an
   armour name, return whether the build is currently allowed to wear it, and a list of reasons if not
   (missing proficiency, and/or the Strength shortfall — both checked). This function is purely
   additive: it doesn't touch or call anything in the existing pricing logic, and nothing existing
   calls it except the new dropdown code — so it cannot change any previously-computed price or AC
   value.
3. In both character tools' armour-dropdown rendering, for each armour option, check (a) is it on the
   DM's banned list for this campaign, and (b) is the build eligible per the new legality-check
   function. If either fails, render the option as disabled with a combined reason string as its
   tooltip.
4. Add a matching check to the existing "does this build violate DM campaign rules" validator (an
   existing function that already checks the other five banned-list categories) so a build with an
   already-selected-but-now-banned armour is flagged as a visible rule violation — without being
   silently corrected or having the player's choice erased.
5. Document the STR-hard-block decision explicitly in the project's decision log, flagged as an
   unconfirmed call made without the owner present, with instructions for how to reverse it if the
   owner disagrees once they see it.

## Files/documents involved (named by role, not path — reviewer has no access regardless)

- The shared rules/pricing engine module (one new exported function, one new campaign-rule field
  documented in an existing validator's doc-comment, one new entry in an existing category-name-to-
  rule-field lookup table).
- Two independent character-editing tool files, each with its own copy of the armour-dropdown
  rendering code (the codebase deliberately keeps three tools' UI code separate from the shared
  engine; this is an existing, intentional architecture, not something this feature changed).
- One DM-facing settings tool file, extended with one new checkbox-grid settings block (built by
  adding one entry to an existing generic list-of-settings-blocks array — every other banned-category
  block in that tool is built the same way).
- One project decision-log entry recording this design call.

## Out of scope

- Changing what the Strength requirement or proficiency requirement actually *are* (the numbers/rules
  themselves) — this feature only changes whether an already-existing rule is enforced at
  selection-time vs. only warned-about afterward.
- Any change to how AC (armour class / defense value) or pricing is calculated.
- A UI to let a DM ban armour *categories* (light/medium/heavy) rather than specific named armours —
  only specific-armour banning was requested/built.
- Retroactively fixing any character who already has an illegal/banned armour equipped beyond flagging
  it as a visible issue (see grandfather clause above).

## Alternatives considered

- **STR stays a warning-only, proficiency becomes the only hard gate.** Rejected in favor of the
  built approach because both requests explicitly named Strength alongside proficiency, twice, with no
  qualifying language suggesting they should be treated differently — and there was no way to ask
  which reading was meant before the owner became unavailable overnight.
- **Hide ineligible/banned options from the dropdown entirely, rather than showing them disabled.**
  Rejected because a DM or player mid-session might want to see *what exists but isn't currently
  available*, and one of the two tools already had a (non-blocking) "no proficiency" label next to
  ineligible options before this feature — disabling-with-reason extends that existing precedent
  rather than replacing it with a different one.
- **Two separate PRs as originally scoped.** Not fully followed through on — see the scope/shipping
  choice noted above. Alternative would have meant either duplicating the "is this armour actually
  pickable" check in two places temporarily, or artificially sequencing the two PRs so the second
  waited on the first merging, both of which were judged worse than one clearly-labeled combined PR
  under the time constraint.

## Risks

- **Wrong severity call (STR hard-block).** If the owner actually wanted STR to stay advisory, players
  who would have made a legitimate, if suboptimal, choice (heavy armour despite low Strength, eating
  the mechanical penalty) are now blocked from doing so at all until a human reverses this specific
  check. Low technical cost to reverse (removing two conditions from one function), but a real
  experience regression until then if wrong.
- **Combined PR instead of two.** Makes independent review/rejection of just one of the two features
  slightly harder (a reviewer who likes the ban-list but dislikes the STR call can't merge one without
  the other as cleanly). Mitigated by clear internal comments separating the two concerns in the diff.
- **Grandfather-clause interaction with the DM-facing validator.** A DM seeing a "banned armour still
  equipped" violation flag on a character might expect a one-click fix; none was built (the flag is
  informational only). Low risk, but worth the reviewer's opinion given the question explicitly asks
  about this pattern.

## Verification

- The project's own automated pricing/legality regression suite (73 checks) was run and confirmed
  unchanged/passing after this feature, since no pricing logic was touched.
- All script blocks in the three affected tool files were confirmed to still parse as valid code after
  the edits (a mechanical syntax check, not a functional one).
- No live/manual browser test of the actual dropdown behavior was performed in this session (no
  running instance of the app was exercised) — this is a real gap the reviewer should weigh when
  judging "should this merge as-is."

## Done when

- A human (the project owner) has read the reasoning above, the actual code diff, and this review's
  findings, and either confirms the STR-hard-block call or asks for it to be changed to warning-only.
- If changed, the two Strength-related conditions are removed from the new legality-check function
  (proficiency check stays), and the corresponding decision-log entry is updated to record the
  reversal and why.

---

## Reviewer instructions

Please respond in this structure:

1. **Self-identify** — state your exact model name/version and any relevant settings, as the very
   first line of your response, before anything else.
2. **Judge logic, clarity, scope, and risk** from the text above — not code correctness you cannot
   see. You have no access to the actual repository, code diff, or any other file; work only from what
   is written above.
3. Answer these questions directly:
   - Does the described approach achieve the two stated goals (DM-set armour ban-list; personal
     proficiency/Strength restriction)?
   - **Specifically:** is treating Strength as a hard selection-block (same severity as proficiency)
     defensible given the two verbatim requests quoted above, or is a warning-only treatment for
     Strength (blocking only proficiency) the more defensible reading, given real tabletop convention
     treats "can't wear it at all" (proficiency) and "wear it but get no benefit" (Strength)
     differently?
   - Is disabled-with-reason the right UX choice here over hiding ineligible/banned options entirely?
   - Is shipping both features in one combined change, rather than as two separately reviewable
     changes, a reasonable practical call given the code genuinely interleaved, or a real process
     violation that should be unwound before merge?
   - Is the grandfather-clause approach (never retroactively strip an already-made choice, only block
     new selections, and separately flag the now-illegal state) structurally sound for this specific
     feature, or does it create a confusing state (a DM sees a violation flagged with no way to fix it
     from that flag)?
   - Are any stated assumptions shaky?
   - Is there a better alternative not considered?
   - What's missing from this plan/description?
   - Is the Verification section objectively checkable, or too vague?
   - Should this be split into two separate reviewable items after all?
4. Output your response as a single markdown document.

## Review outcome

*(to be filled in after the reviewer's response is triaged)*
