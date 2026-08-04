# D-GH-2026-08-04-handoff-identity-and-invite-decline — triaging three review findings, two real and one not

Status: Active

The 2026-08-04 usability review (`docs/reviews/2026-08-04-usability-qol.md`) raised these as one CRITICAL
and two HIGHs. Verifying each against the code first changed what the work was — worth recording, because
two of the three reports named the wrong cause while still pointing at something real.

## 1. Tool handoff stranded an orphaned duplicate — REAL, fixed

**Reported as:** the CharGen ⇄ Live Sheet handoff "creates a duplicate, orphaned character instead of
round-tripping the same one", with hard evidence — two `Aldric Valor` rows, distinct ids, one bound and
still accruing play state, one under "No campaign" frozen at 78/80 AP and invisible to the DM.

**The local handoff was not the cause.** Driving CharGen → Live Sheet → CharGen in a browser, the id
survives both legs intact; `writeHandoff` carries it, `_lsConsumeHandoff` adopts it, and `applyBuild`
adopts it on the return. That is now asserted permanently.

**The cause was a missing argument on the cloud save.** `saveCharacter({id, name, kind, stats, campaignId})`
uses `campaignId` as the input to its anti-fork guard: when an id is not a UUID, it either adopts the
campaign's existing server row (`campaignId` known) or **mints a fresh id and inserts a new row**
(`campaignId` absent). Every CharGen call site passed it. The Live Sheet's "Save to cloud" never did —
even though the envelope it builds two lines earlier already carries the binding.

So any id drift in the Live Sheet forked instead of reconciling. `js/sync.js`'s own comment describes the
outcome verbatim: *"a brand-new, campaign-less duplicate while its real bound row kept only the seed log."*
The guard was right; one caller was not wired into it.

**Why this shape of fix.** The alternative was to have `saveCharacter` look the campaign up itself when
`campaignId` is omitted. Rejected: that turns a pure local-first save into an unconditional network
round-trip, and it hides a caller's ignorance of its own state rather than fixing it. The Live Sheet knows
its campaign (`window._lsCampaignId`); it should say so.

## 2. Declining an invite was a one-way door — REAL, fixed

Declining the confirm prompt ran `clearPendingToken()` and hid the banner. A player who clicked Cancel —
or misclicked, or meant "let me think" — lost the invite with no explanation, no recovery, and no
difference from a silent failure: re-opening the link produced the same nothing.

The token is now **kept**, only the auto-prompt is suppressed for that load, and the banner becomes the way
back: *"Invite not accepted. Your current build is untouched."* with **Accept invite** and **Discard
invite**. Discarding is still available — it is just explicit now rather than the only outcome.

## 3. "Invites issued never reflects redemption" — NOT a data bug

Reported as HIGH: the invite row still reads "Open" after a player joined, contradicting the roster above
it. Checked the whole chain instead of the symptom:

| link | state |
|---|---|
| `redeem_player_invite` | sets `redeemed_by = auth.uid(), redeemed_at = now()` |
| `campaign_invites` (live) | 13 of 22 rows carry `redeemed_at`; **zero** have `redeemed_by` without it |
| `list_campaign_invites` | returns `i.redeemed_at` |
| `campaign.js` | maps it to `redeemedAt` |
| `renderInvites()` | `v.redeemedAt` → "Redeemed" |

Nothing is broken. The likeliest explanation for what the reviewer saw is the same one behind the
misdiagnosed CRITICAL: **Playwright auto-dismisses `confirm()`**, so the invite was declined rather than
redeemed, and the character in the roster arrived by the shared campaign code (Path B) — which correctly
leaves that invite Open. Two panels describing different facts, not one fact inconsistently.

**What was still worth fixing** is the complaint underneath it: the roster and the invite list are separate
queries that went stale independently, so a DM could see a joined character above an invite marked Open and
have no way to tell whether that was staleness or truth. Either panel's Refresh now reloads both. A
presentation fix, deliberately not dressed up as a data fix.

## The meta-lesson

Two of three findings named a cause that turned out to be wrong, and one of those (`#3`) had no defect at
all — but the review still earned its keep on all three, because each pointed at a real hole nearby. The
discipline that made the difference was refusing to act on a stated cause without reproducing it: the
duplicate was real but not where it was said to be, and "the invite never shows as redeemed" was a
database question answerable in one query.

**Playwright's default dialog handling deserves a standing note.** It dismisses `confirm()` unless a
handler is registered, which silently routes any confirm-gated flow down its rejection branch. That single
behaviour produced a CRITICAL and a HIGH in this report. The new gate registers a handler explicitly and
asserts the dialog count, so the test states which branch it is exercising instead of assuming.

## Verification

`chargen-flows` — 11 checks over handoff identity and decline recovery. Verified **RED** by restoring the
old decline behaviour: 5 of 11 failed. Needs no Supabase stack, so it runs on every PR touching those
paths. Plus `audit` 29/0, `engine-parity` 24/0, `log-fuzz` 500/500, `dm-console-ui` 27/27.

The cloud half of finding 1 (that two rows actually stop appearing) is **not** covered here — it needs a
signed-in session, and `cloud-e2e` is where that belongs if it is ever added.
