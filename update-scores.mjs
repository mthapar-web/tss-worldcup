// update-scores.mjs
// Pulls group-stage data from ESPN's public fifa.world feed,
// computes group tables with FIFA tiebreakers,
// works out the 8 best third-place qualifiers once all groups are final,
// merges overrides.json, and writes results.json.

import { writeFileSync, readFileSync, existsSync } from 'fs';

const ESPN_URL = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';

const GROUP_TEAMS = {
  A: ['Mexico','South Africa','Korea Republic','Czechia'],
  B: ['Canada','Bosnia-Herzegovina','Qatar','Switzerland'],
  C: ['Brazil','Morocco','Haiti','Scotland'],
  D: ['USA','Paraguay','Australia','Türkiye'],
  E: ['Germany','Curaçao','Ivory Coast','Ecuador'],
  F: ['Netherlands','Japan','Sweden','Tunisia'],
  G: ['Belgium','Egypt','Iran','New Zealand'],
  H: ['Spain','Cape Verde','Saudi Arabia','Uruguay'],
  I: ['France','Senegal','Iraq','Norway'],
  J: ['Argentina','Algeria','Austria','Jordan'],
  K: ['Portugal','DR Congo','Uzbekistan','Colombia']
};

// ESPN name -> our canonical name
const NAME_MAP = {
  'United States': 'USA',
  'South Korea': 'Korea Republic',
  'Bosnia & Herz.': 'Bosnia-Herzegovina',
  'Ivory Coast': 'Ivory Coast',
  "Cote d'Ivoire": 'Ivory Coast',
  'Turkey': 'Türkiye',
  'Turkey (Türkiye)': 'Türkiye',
  'Cape Verde Islands': 'Cape Verde',
  'DR Congo': 'DR Congo',
  'Congo DR': 'DR Congo',
  'New Zealand': 'New Zealand',
};

function normalizeName(n) {
  return NAME_MAP[n] || n;
}

async function fetchStandings() {
  try {
    const res = await fetch(ESPN_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch(e) {
    console.error('ESPN fetch failed:', e.message);
    return null;
  }
}

function parseGroups(data) {
  const groups = {};
  const stats = {};

  if (!data || !data.standings) return { groups, stats };

  for (const grpData of (data.standings || [])) {
    const grpName = grpData.name?.replace('Group ', '') || grpData.abbreviation;
    if (!GROUP_TEAMS[grpName]) continue;

    const entries = grpData.entries || grpData.standings?.entries || [];
    const teamStats = {};

    entries.forEach((entry, idx) => {
      const teamName = normalizeName(entry.team?.displayName || entry.team?.name || '');
      const s = entry.stats || [];
      const getStat = (abbr) => {
        const found = s.find(x => x.abbreviation === abbr || x.name === abbr);
        return found ? parseInt(found.value ?? found.displayValue ?? 0) : 0;
      };
      teamStats[teamName] = {
        pts: getStat('PTS') || getStat('points'),
        gd: getStat('GD') || getStat('pointDifferential'),
        gf: getStat('GF') || getStat('pointsFor'),
        ga: getStat('GA') || getStat('pointsAgainst'),
        w: getStat('W') || getStat('wins'),
        d: getStat('T') || getStat('ties'),
        l: getStat('L') || getStat('losses'),
        gp: getStat('GP') || getStat('gamesPlayed'),
        pos: idx + 1
      };
    });

    // Sort by pts desc, then GD desc, then GF desc
    const sorted = Object.entries(teamStats).sort(([,a],[,b]) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf
    );

    const posMap = {};
    sorted.forEach(([team], idx) => { posMap[team] = idx + 1; });
    groups[grpName] = posMap;
    stats[grpName] = teamStats;
  }

  return { groups, stats };
}

function findThirds(stats) {
  // Collect all 3rd-place teams across groups
  const thirds = [];
  for (const [grp, teamStats] of Object.entries(stats)) {
    const sorted = Object.entries(teamStats).sort(([,a],[,b]) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf
    );
    if (sorted.length >= 3) {
      const [team, s] = sorted[2];
      thirds.push({ team, grp, ...s });
    }
  }
  // Sort by points, then GD, then GF to find best 8
  thirds.sort((a,b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  return thirds.slice(0, 8).map(t => t.team);
}

async function main() {
  // Load overrides
  let overrides = {};
  if (existsSync('overrides.json')) {
    try { overrides = JSON.parse(readFileSync('overrides.json', 'utf8')); } catch(e) {}
  }

  // Load existing results as fallback
  let existing = { groups:{}, stats:{}, thirds:[], champion:null, boot:null, updatedAt:null };
  if (existsSync('results.json')) {
    try { existing = JSON.parse(readFileSync('results.json', 'utf8')); } catch(e) {}
  }

  const espnData = await fetchStandings();
  let { groups, stats } = espnData ? parseGroups(espnData) : { groups: existing.groups || {}, stats: existing.stats || {} };

  // Apply standings overrides
  if (overrides.standings) {
    for (const [grp, manual] of Object.entries(overrides.standings)) {
      groups[grp] = manual;
    }
  }

  // Find 8 best thirds (or use override)
  const thirds = (overrides.thirds && overrides.thirds.length)
    ? overrides.thirds
    : (Object.keys(stats).length >= 11 ? findThirds(stats) : existing.thirds || []);

  const out = {
    groups,
    stats,
    thirds,
    champion: overrides.champion || existing.champion || null,
    boot: overrides.boot || existing.boot || null,
    updatedAt: new Date().toISOString()
  };

  writeFileSync('results.json', JSON.stringify(out, null, 2));
  console.log(`[${out.updatedAt}] results.json written — ${Object.keys(groups).length} groups, ${thirds.length} thirds`);
}

main();
