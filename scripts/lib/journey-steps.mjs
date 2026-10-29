// @ai
//
// scripts/lib/journey-steps.mjs
// -----------------------------
// The steps of the journey, one definition for the Daily card
// (scripts/daily-card.mjs) and the signals section `journeyByBuild`.
// Moved here from daily-card.mjs on 2026-10-25 without a change.

import {sqlList} from './lab-exclusion.mjs';

// Ordered, and each step is the UNION of its events (a user who skipped
// onboarding is as "set up" as one who completed it). Labels are deliberately
// plain English: this card gets forwarded to people who do not know what a
// `meaningful_listen` is.
//
// "Installed" is NOT the store download count, and it is NOT a journey step:
// `Application Installed` / `Application Updated` fire once, on the first
// launch after an install or an update. A person who updated before the window
// opens the app every day and never sends one in it, so "installed" can be far
// below "opened" (2598 vs 4656 on 2026-10-11). The card prints it as its own
// line under the people count (card-layout.mjs renderJourney); the journey
// starts at Opened. True downloads need App Store Connect (Sales & Trends) or
// the Play reports bucket.
//
// "Logged in" counts the people who signed in on a counted build. PostHog does
// not know who is ALREADY signed in: the app never calls identify() and sends
// no signed-in property, so a person who signed in on an older build and
// stayed signed in does not count. The number is a floor until the app reports
// its signed-in state on each launch.
export const STEPS = [
  {
    key: 'installed',
    label: 'Installed',
    events: ['Application Installed', 'Application Updated'],
  },
  {key: 'opened', label: 'Opened', events: ['cold_start_began']},
  // Past loading = a first screen rendered: splash_hidden OR
  // screen_content_rendered, the cold-start completion that ColdStartBeganProps
  // (services/analytics/qariahEvents.ts) defines. scripts/lib/ab-card.mjs and
  // the engagement funnel (active-rollout.json) use the same two events.
  {
    key: 'past_loading',
    label: 'Past loading',
    events: ['splash_hidden', 'screen_content_rendered'],
  },
  {
    key: 'logged_in',
    label: 'Logged in',
    events: ['sign_in_succeeded'],
    or: "(event = 'onboarding_completed' AND properties.signed_in = true)",
  },
  {
    key: 'started',
    label: 'Started',
    events: ['playback_started', 'mushaf_page_opened'],
  },
  {
    key: 'used_it',
    label: 'Really used',
    events: ['meaningful_listen', 'mushaf_page_read', 'playback_completed'],
  },
];
/** HogQL: the condition of one step (the union of its events). */
export const stepCond = s =>
  [`event IN (${sqlList(s.events)})`, s.or].filter(Boolean).join(' OR ');
