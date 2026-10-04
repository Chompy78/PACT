#!/usr/bin/env node
/**
 * PACT — account popover gate (no Supabase required).
 *
 * WHY THIS EXISTS. A player-support investigation (2026-09-18, the Caspian/Amble AP mix-up) surfaced
 * a real gap: none of the three tools showed who was signed in beyond a bare "Signed out"/"Signed in"
 * chip, and there was no way to change your password without leaving the app for login.html's
 * forgot-password email round trip. `js/account-ui.js` adds one shared popover (renderAccountPopover)
 * that all three tools' sign-in chip now opens, showing the account's name/email and offering an
 * in-app password change (calling the existing js/auth.js `updatePassword()` directly — Supabase
 * allows this on an active session with no old-password round trip) and a working sign-out. DM
 * Console's own "Sign out" link (`campSignInBtn`) was separately found to be dead — relabelled to
 * "Sign out" but its onclick only called `preventDefault()`, never an actual sign-out — fixed in the
 * same change.
 *
 * This drives the popover directly against a FAKE bridge (no live Supabase/network needed — matches
 * dm-console-ui-e2e.mjs's and economy-ui-e2e.mjs's own "no stack needed" pattern): supabase-js is
 * vendored so the real module bridges load offline regardless, and only the bridge's four functions
 * (currentSession/myProfile/updatePassword/logout) are swapped for test doubles.
 *
 * USAGE:  node testing/scripts/account-ui-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7976;   // not 7970/7971/7973/7974/7975/7979/7987/7991

let pass = 0, fail = 0;
let _summaryPrinted = false;
process.on('exit', (code) => {
  if (_summaryPrinted) return;
  console.log(`\n[account-ui] ABORTED before finishing — ${pass} checks ran, ${fail} failed, then the `
    + `script stopped. This is NOT a pass; treat it as a failure (exit ${code}).`);
});
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e, d) => {
    if (e) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(d);
  });
});
await new Promise(r => server.listen(PORT, r));
const browser = await launchChromium();

/** Injects a fake bridge, clicks the given chip selector, and returns the popover's state.
 *  Mutates the bridge object IN PLACE (never replaces window[key] with a new object) — DM Console's
 *  updateAuth() closes over the object reference it captured at boot (`var B = window._campBridge`),
 *  so reassigning window[key] to a new object would silently leave that closure pointing at the
 *  stale original. */
async function openPopover(page, chipSel, bridgeWindowKey, fakeBridge) {
  await page.evaluate(({ key, b }) => {
    const bridgeObj = window[key] || (window[key] = {});
    window.__acctCalls = { updatePassword: null, logout: 0 };
    Object.assign(bridgeObj, {
      currentSession: async () => (b.session),
      myProfile: b.profile === undefined ? undefined : (async () => b.profile),
      updatePassword: b.rejectPassword
        ? (async (p) => { window.__acctCalls.updatePassword = p; throw new Error(b.rejectPassword); })
        : (async (p) => { window.__acctCalls.updatePassword = p; }),
      logout: async () => { window.__acctCalls.logout++; },
    });
    // DM Console's chip is wired reactively inside updateAuth(), only ever invoked for real from a
    // live Supabase auth event or the initial boot check — neither of which this offline gate can
    // raise. Drive it directly via the test seam so campWho/campSignInBtn pick up the fake session.
    if (typeof window._dmUpdateAuthTest === 'function') window._dmUpdateAuthTest(b.session);
  }, { key: bridgeWindowKey, b: fakeBridge });
  await page.click(chipSel);
  await page.waitForTimeout(150); // popover's own myProfile()-then chain
  return page.evaluate(() => {
    const root = document.getElementById('acctPopoverRoot');
    if (!root) return null;
    return {
      html: root.innerHTML,
      text: root.textContent,
      hasPwButton: !!root.querySelector('button')?.textContent?.includes('Change password')
        || Array.from(root.querySelectorAll('button')).some(b => b.textContent.includes('Change password')),
      hasLogoutButton: Array.from(root.querySelectorAll('button')).some(b => b.textContent.includes('Log out')),
    };
  });
}

/* ======================================================================
 * 1. LIVE SHEET
 * ====================================================================== */
console.log('\n[account-ui] Live Sheet');
{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const fatal = errors.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
  check('no fatal page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));

  check('the chip is present and reachable', await page.evaluate(() => !!document.getElementById('lsSyncChip')));

  // Not signed in — the popover offers a sign-in link, not the account panel.
  let pop = await openPopover(page, '#lsSyncChip', '_authBridge', { session: null });
  check('signed-out click shows a sign-in prompt, not account details', pop && /Sign in/.test(pop.text) && !/Change password/.test(pop.text), pop && pop.text);

  // Signed in — name + email show, XSS-dangerous display name renders as inert text, not markup.
  const dangerousName = '<img src=x onerror=alert(1)>Mallory';
  pop = await openPopover(page, '#lsSyncChip', '_authBridge', {
    session: { user: { email: 'player@example.com' } },
    profile: { display_name: dangerousName },
  });
  check('shows the account email', pop && pop.text.includes('player@example.com'), pop && pop.text);
  check('shows the display name', pop && pop.text.includes(dangerousName), pop && pop.text);
  check('the dangerous name is INERT TEXT, never a live element (no <img> in the popover)', pop && !/<img/i.test(pop.html), pop && pop.html);
  check('carries a Change password control', pop && pop.hasPwButton);
  check('carries a Log out control', pop && pop.hasLogoutButton);

  // Change password: reveal the form, submit, confirm updatePassword() was called with the typed value.
  await page.click('#acctPopoverRoot button'); // "Change password" is the first button when signed in
  await page.fill('.acctNewPw', 'correcthorse');
  await page.fill('.acctNewPw2', 'correcthorse');
  await page.click('.acctPwSave');
  await page.waitForTimeout(50);
  const pwCall = await page.evaluate(() => window.__acctCalls.updatePassword);
  check('Save calls updatePassword() with the typed password', pwCall === 'correcthorse', pwCall);
  const okMsg = await page.evaluate(() => (document.querySelector('.acctPwMsg') || {}).textContent || '');
  check('and shows a success message', /updated/i.test(okMsg), okMsg);

  // Mismatch / too-short are caught client-side, before ever calling updatePassword().
  pop = await openPopover(page, '#lsSyncChip', '_authBridge', { session: { user: { email: 'a@b.com' } }, profile: null });
  await page.click('#acctPopoverRoot button');
  await page.fill('.acctNewPw', 'short');
  await page.fill('.acctNewPw2', 'short');
  await page.click('.acctPwSave');
  let msg = await page.evaluate(() => (document.querySelector('.acctPwMsg') || {}).textContent || '');
  check('a too-short password is rejected client-side', /at least 6/.test(msg), msg);
  let calledYet = await page.evaluate(() => window.__acctCalls.updatePassword);
  check('...without ever calling updatePassword()', calledYet === null, calledYet);

  await page.fill('.acctNewPw', 'longenough1');
  await page.fill('.acctNewPw2', 'longenough2');
  await page.click('.acctPwSave');
  msg = await page.evaluate(() => (document.querySelector('.acctPwMsg') || {}).textContent || '');
  check('a mismatched confirmation is rejected client-side', /do not match/.test(msg), msg);

  // Log out actually calls the bridge's logout().
  pop = await openPopover(page, '#lsSyncChip', '_authBridge', { session: { user: { email: 'a@b.com' } }, profile: null });
  await page.click('text=🚪 Log out');
  const logoutCalls = await page.evaluate(() => window.__acctCalls.logout);
  check('Log out calls the bridge logout()', logoutCalls === 1, logoutCalls);
  check('...and the popover closes', await page.evaluate(() => !document.getElementById('acctPopoverRoot')));

  // Escape key closes an open popover.
  pop = await openPopover(page, '#lsSyncChip', '_authBridge', { session: { user: { email: 'a@b.com' } }, profile: null });
  check('popover open before Escape', await page.evaluate(() => !!document.getElementById('acctPopoverRoot')));
  await page.keyboard.press('Escape');
  check('Escape closes the popover', await page.evaluate(() => !document.getElementById('acctPopoverRoot')));

  // A failed sign-out (offline, dropped connection) must stay visible, not vanish silently
  // (code-review finding, fix/account-details-and-password-change).
  pop = await openPopover(page, '#lsSyncChip', '_authBridge', { session: { user: { email: 'a@b.com' } }, profile: null });
  await page.evaluate(() => { window._authBridge.logout = async () => { throw new Error('offline'); }; });
  await page.click('text=🚪 Log out');
  await page.waitForTimeout(50);
  check('a failed Log out keeps the popover open', await page.evaluate(() => !!document.getElementById('acctPopoverRoot')));
  const outErr = await page.evaluate(() => (document.getElementById('acctPopoverRoot') || {}).textContent || '');
  check('...and shows the real error, not silence', /offline/.test(outErr), outErr);

  // The chip's title/aria-label must keep the account hint after a normal render — it used to be
  // fully overwritten by _lsRenderSyncChip() on load/every autosave (code-review finding).
  await page.evaluate(() => { if (typeof render === 'function') render(); });
  await page.waitForTimeout(50);
  const chipTitle = await page.evaluate(() => document.getElementById('lsSyncChip').title);
  check('the chip keeps its account hint after a sync-status render', /account/i.test(chipTitle), chipTitle);

  await page.close();
}

/* ======================================================================
 * 2. CHARGEN
 * ====================================================================== */
console.log('\n[account-ui] CharGen');
{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const fatal = errors.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
  check('no fatal page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));

  const pop = await openPopover(page, '#cgSyncChip', '_authBridge', {
    session: { user: { email: 'cg-player@example.com' } }, profile: { display_name: 'Cg Player' },
  });
  check('shows the account email', pop && pop.text.includes('cg-player@example.com'), pop && pop.text);
  check('carries a Change password control', pop && pop.hasPwButton);
  await page.close();
}

/* ======================================================================
 * 3. DM CONSOLE — also covers the previously-dead "Sign out" link fix.
 * ====================================================================== */
console.log('\n[account-ui] DM Console');
{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const fatal = errors.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
  check('no fatal page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));

  const pop = await openPopover(page, '#campWho', '_campBridge', {
    session: { user: { email: 'dm@example.com' } }, profile: { display_name: 'The DM' },
  });
  check('shows the account email', pop && pop.text.includes('dm@example.com'), pop && pop.text);
  check('carries a Change password control', pop && pop.hasPwButton);

  // The dedicated "Sign out" link next to campWho — previously called only preventDefault().
  await page.evaluate(() => { const p = document.getElementById('acctPopoverRoot'); if (p) p.remove(); });
  const signOutText = await page.evaluate(() => document.getElementById('campSignInBtn').textContent);
  check('the dedicated link reads "Sign out" once signed in', signOutText === 'Sign out', signOutText);
  await page.click('#campSignInBtn');
  const dedicatedLogoutCalls = await page.evaluate(() => window.__acctCalls.logout);
  check('fix/account-details-and-password-change: it now actually calls logout() (used to no-op)', dedicatedLogoutCalls === 1, dedicatedLogoutCalls);

  await page.close();
}

console.log(`\n[account-ui] ${fail ? fail + ' of ' + (pass + fail) + ' checks FAILED' : 'all ' + pass + ' checks passed'}`);
_summaryPrinted = true;
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
