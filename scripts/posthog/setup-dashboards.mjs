#!/usr/bin/env node
/**
 * Idempotent PostHog dashboard setup for Qariah v2.
 *
 * Reads POSTHOG_PERSONAL_API_TOKEN + POSTHOG_PROJECT_ID from env (.env.local),
 * then creates / updates 3 dashboards:
 *
 *   1. Tester health        — DAU, sessions, first-launch funnel, engagement
 *   2. Listening behavior   — top surahs/reciters/riwayat, meaningful listens, favorites, mushaf
 *   3. Errors + quality     — sessions w/ zero plays, app version distribution
 *
 * Idempotent: looks up dashboards by name; if found, updates the tile set
 * by deleting + recreating insights with matching short_id-prefixed names.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   node scripts/posthog/setup-dashboards.mjs
 *
 * Region: US (us.posthog.com). Doc historically said EU; corrected here.
 */

const HOST = process.env.POSTHOG_HOST || 'https://us.posthog.com';
const TOKEN = process.env.POSTHOG_PERSONAL_API_TOKEN;
const PROJECT = process.env.POSTHOG_PROJECT_ID;

if (!TOKEN || !PROJECT) {
  console.error(
    'Missing POSTHOG_PERSONAL_API_TOKEN or POSTHOG_PROJECT_ID env. ' +
      'Run: set -a && source .env.local && set +a',
  );
  process.exit(1);
}

const api = async (path, opts = {}) => {
  const res = await fetch(`${HOST}/api/projects/${PROJECT}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      `${opts.method || 'GET'} ${path} → HTTP ${res.status}\n${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}`,
    );
  }
  return body;
};

// ---------- Insight builders (modern `query` schema, InsightVizNode) ----------

const trendsLine = ({
  name,
  events,
  breakdown,
  interval = 'day',
  dateFrom = '-30d',
  mathProp,
}) => ({
  name,
  query: {
    kind: 'InsightVizNode',
    source: {
      kind: 'TrendsQuery',
      dateRange: {date_from: dateFrom},
      interval,
      series: events.map(e => ({
        kind: 'EventsNode',
        event: e.event,
        name: e.event,
        math: e.math || 'total',
        ...(e.mathProperty ? {math_property: e.mathProperty} : {}),
        ...(e.properties ? {properties: e.properties} : {}),
      })),
      ...(breakdown
        ? {
            breakdownFilter: {
              breakdown_type: breakdown.type || 'event',
              breakdown: breakdown.property,
              breakdown_limit: breakdown.limit || 20,
            },
          }
        : {}),
      trendsFilter: {display: 'ActionsLineGraph'},
    },
  },
});

const trendsBig = ({name, events, dateFrom = '-7d'}) => ({
  name,
  query: {
    kind: 'InsightVizNode',
    source: {
      kind: 'TrendsQuery',
      dateRange: {date_from: dateFrom},
      interval: 'day',
      series: events.map(e => ({
        kind: 'EventsNode',
        event: e.event,
        name: e.event,
        math: e.math || 'dau',
      })),
      trendsFilter: {display: 'BoldNumber'},
    },
  },
});

const trendsBar = ({
  name,
  events,
  breakdown,
  dateFrom = '-14d',
  breakdownLimit = 20,
}) => ({
  name,
  query: {
    kind: 'InsightVizNode',
    source: {
      kind: 'TrendsQuery',
      dateRange: {date_from: dateFrom},
      interval: 'day',
      series: events.map(e => ({
        kind: 'EventsNode',
        event: e.event,
        name: e.event,
        math: e.math || 'total',
      })),
      breakdownFilter: {
        breakdown_type: 'event',
        breakdown: breakdown,
        breakdown_limit: breakdownLimit,
      },
      trendsFilter: {display: 'ActionsBarValue'},
    },
  },
});

const funnel = ({
  name,
  steps,
  dateFrom = '-30d',
  windowInterval = 7,
  windowIntervalUnit = 'day',
}) => ({
  name,
  query: {
    kind: 'InsightVizNode',
    source: {
      kind: 'FunnelsQuery',
      dateRange: {date_from: dateFrom},
      series: steps.map(s => ({
        kind: 'EventsNode',
        event: s,
        name: s,
      })),
      funnelsFilter: {
        funnelWindowInterval: windowInterval,
        funnelWindowIntervalUnit: windowIntervalUnit,
      },
    },
  },
});

// ---------- Dashboard definitions ----------

const DASHBOARDS = [
  {
    name: 'Qariah — Tester health',
    description:
      'Are testers using the app at all? DAU, sessions, first-launch funnel, engagement. ' +
      'Source-of-truth: planning/posthog-dashboards.md (Dashboard 1).',
    insights: [
      trendsBig({
        name: 'Daily active users (today)',
        events: [{event: 'app_opened', math: 'dau'}],
        dateFrom: '-1d',
      }),
      trendsLine({
        name: 'Daily active users (30d)',
        events: [{event: 'app_opened', math: 'dau'}],
        dateFrom: '-30d',
      }),
      trendsLine({
        name: 'Sessions per day (app_opened count)',
        events: [{event: 'app_opened', math: 'total'}],
        dateFrom: '-30d',
      }),
      funnel({
        name: 'First-launch funnel (open → reciter → playback → meaningful listen)',
        steps: [
          'app_opened',
          'reciter_selected',
          'playback_started',
          'meaningful_listen',
        ],
        windowInterval: 7,
        windowIntervalUnit: 'day',
      }),
      trendsLine({
        name: 'Active testers (last 7 days, daily DAU)',
        events: [{event: 'app_opened', math: 'dau'}],
        dateFrom: '-7d',
      }),
    ],
  },
  {
    name: 'Qariah — Listening behavior',
    description:
      'What are testers actually listening to? Top surahs, reciters, riwayat, ' +
      'meaningful-listen rate, favorites, mushaf engagement. ' +
      'Source-of-truth: planning/posthog-dashboards.md (Dashboard 2).',
    insights: [
      trendsBar({
        name: 'Top 20 surahs by plays (14d)',
        events: [{event: 'playback_started'}],
        breakdown: 'surah_id',
        breakdownLimit: 20,
      }),
      trendsBar({
        name: 'Top 20 reciters by plays (14d)',
        events: [{event: 'playback_started'}],
        breakdown: 'reciter_id',
        breakdownLimit: 20,
      }),
      trendsBar({
        name: 'Plays per riwāyāh (14d)',
        events: [{event: 'playback_started'}],
        breakdown: 'rewayah_id',
        breakdownLimit: 10,
      }),
      funnel({
        name: 'Meaningful-listen rate (playback_started → meaningful_listen)',
        steps: ['playback_started', 'meaningful_listen'],
        windowInterval: 30,
        windowIntervalUnit: 'minute',
      }),
      trendsLine({
        name: 'Favorite-add rate (daily)',
        events: [
          {
            event: 'favorite_toggled',
            properties: [
              {key: 'action', value: 'added', operator: 'exact', type: 'event'},
            ],
          },
        ],
        dateFrom: '-14d',
      }),
      trendsBar({
        name: 'Reciter-profile views (reciter_selected, 14d)',
        events: [{event: 'reciter_selected'}],
        breakdown: 'reciter_id',
        breakdownLimit: 20,
      }),
      trendsLine({
        name: 'Mushaf page reads (daily)',
        events: [{event: 'mushaf_page_read', math: 'total'}],
        dateFrom: '-14d',
      }),
      trendsLine({
        name: 'Downloads completed (daily)',
        events: [{event: 'download_completed', math: 'total'}],
        dateFrom: '-14d',
      }),
      // Tiles wired Sprint 9-post — events are instrumented (ExpoAudioProvider + playerStore)
      // but had no firings yet at provisioning time. Will populate as testers complete /
      // skip tracks.
      {
        name: 'Avg completion percentage (14d)',
        query: {
          kind: 'InsightVizNode',
          source: {
            kind: 'TrendsQuery',
            dateRange: {date_from: '-14d'},
            interval: 'day',
            series: [
              {
                kind: 'EventsNode',
                event: 'playback_completed',
                name: 'playback_completed',
                math: 'avg',
                math_property: 'completion_pct',
              },
            ],
            trendsFilter: {display: 'ActionsLineGraph'},
          },
        },
      },
      trendsBar({
        name: 'Most-skipped surahs (14d)',
        events: [{event: 'playback_skipped'}],
        breakdown: 'surah_id',
        breakdownLimit: 20,
      }),
    ],
  },
  {
    name: 'Qariah — Errors + quality',
    description:
      'Are testers hitting bugs? Sessions with zero plays + app version distribution. ' +
      'Sentry is the primary error tracker; this dashboard surfaces correlates. ' +
      'Source-of-truth: planning/posthog-dashboards.md (Dashboard 3).',
    insights: [
      trendsLine({
        name: 'Sessions opened vs playback_started (daily)',
        events: [
          {event: 'app_opened', math: 'total'},
          {event: 'playback_started', math: 'total'},
        ],
        dateFrom: '-14d',
      }),
      trendsBar({
        name: 'App version distribution (last 7d)',
        events: [{event: 'app_opened', math: 'dau'}],
        breakdown: '$app_version',
        breakdownLimit: 10,
        dateFrom: '-7d',
      }),
      trendsLine({
        name: 'Playback paused (daily, possible audio issue signal)',
        events: [{event: 'playback_paused', math: 'total'}],
        dateFrom: '-14d',
      }),
      trendsLine({
        name: 'Skip vs completion (daily counts)',
        events: [
          {event: 'playback_skipped', math: 'total'},
          {event: 'playback_completed', math: 'total'},
        ],
        dateFrom: '-14d',
      }),
    ],
  },
];

// ---------- Idempotent runner ----------

async function findDashboardByName(name) {
  const res = await api(
    `/dashboards/?search=${encodeURIComponent(name)}&limit=50`,
  );
  return (res.results || []).find(d => d.name === name) || null;
}

async function listInsightsOnDashboard(dashboardId) {
  // The dashboard detail endpoint returns its tiles inline.
  const dashboard = await api(`/dashboards/${dashboardId}/`);
  const tiles = dashboard.tiles || [];
  return tiles.map(t => t.insight).filter(Boolean);
}

async function ensureDashboard(spec) {
  let dashboard = await findDashboardByName(spec.name);
  if (dashboard) {
    console.log(`  ✓ Dashboard exists: "${spec.name}" (id=${dashboard.id})`);
    // Update description in case it drifted.
    await api(`/dashboards/${dashboard.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({description: spec.description}),
    });
  } else {
    dashboard = await api('/dashboards/', {
      method: 'POST',
      body: JSON.stringify({
        name: spec.name,
        description: spec.description,
      }),
    });
    console.log(`  + Created dashboard: "${spec.name}" (id=${dashboard.id})`);
  }

  const existingInsights = await listInsightsOnDashboard(dashboard.id);
  const byName = new Map(existingInsights.map(i => [i.name, i]));

  for (const insight of spec.insights) {
    const existing = byName.get(insight.name);
    if (existing) {
      // Update query in place (keeps share-links + tiles stable).
      await api(`/insights/${existing.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: insight.name,
          query: insight.query,
        }),
      });
      console.log(`     ↻ Updated insight: "${insight.name}"`);
    } else {
      await api('/insights/', {
        method: 'POST',
        body: JSON.stringify({
          name: insight.name,
          query: insight.query,
          dashboards: [dashboard.id],
        }),
      });
      console.log(`     + Created insight: "${insight.name}"`);
    }
  }

  return dashboard;
}

(async () => {
  console.log(`PostHog: ${HOST} project=${PROJECT}`);
  for (const d of DASHBOARDS) {
    console.log(`\nDashboard: ${d.name}`);
    await ensureDashboard(d);
  }
  console.log(
    '\n✓ Done. Open https://us.posthog.com/project/' + PROJECT + '/dashboard',
  );
})().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
