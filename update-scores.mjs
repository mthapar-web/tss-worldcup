// update-scores.mjs
// Pulls match results from ESPN's public scoreboard feed,
// computes group tables with FIFA tiebreakers,
// works out the 8 best third-place qualifiers once all groups are final,
// merges overrides.json, and writes results.json.

import { writeFileSync, readFileSync, existsSync } from 'fs';

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=200';

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
  "Korea Republic": 'Korea Republic',
  'Bosnia & Herzegovina': 'Bosnia-Herzegovina',
  'Bosnia and Herzegovina': 'Bosnia-Herzegovina',
  "Côte d'Ivoire": 'Ivory Coast',
  "Cote d'Ivoire": 'Ivory Coast',
  'Turkey': 'Türkiye',
  'Cape Verde': 'Cape Verde',
  'Cape Verde Islands': 'Cape Verde',
  'Democratic Republic of Congo': 'DR Congo',
  'Congo, DR': 'DR Congo',
  'DR Congo': 'DR Congo',
  'New Zealand': 'New Zealand',
  'Curacao': 'Curaçao',
  'Scotland': 'Scotland',
  'Norway': 'Norway',
};

function norm(n) { return NAME_MAP[n] || n; }

// Build a lookup: team name -> which group
const TEAM_TO_GROUP = {};
for (const [grp, teams] of Object.entries(GROUP_TEAMS)) {
  for (const t of teams) TEAM_TO_GROUP[t] = grp;
}

function initStats() {
  return { w:0, d:0, l:0, gf:0, ga:0, gd:0, pts:0, gp:0 };
}

async function fetchScoreboard() {
  try {
    const res = await fetch(ESPN_SCOREBOARD);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch(e) {
    console.error('ESPN fetch failed:', e.message);
    return null;
  }
}

function buildTables(data) {
  // Initialize stats for all teams
  const stats = {};
  for (const [grp, teams] of Object.entries(GROUP_TEAMS)) {
    stats[grp] = {};
    for (const t of teams) stats[grp][t] = initStats();
  }

  const events = data?.events || [];
  let matchesProcessed = 0;

  for (const event of events) {
    // Only group stage matches
    const roundName = event.season?.slug || event.competitions?.[0]?.type?.abbreviation || '';
    const comp = event.competitions?.[0];
    if (!comp) continue;

    const status = comp.status?.type?.completed;
    if (!status) continue; // skip unplayed/live matches

    const competitors = comp.competitors || [];
    if (competitors.length !== 2) continue;

    const homeRaw = competitors.find(c => c.homeAway === 'home') || competitors[0];
    const awayRaw = competitors.find(c => c.homeAway === 'away') || competitors[1];

    const home = norm(homeRaw.team?.displayName || homeRaw.team?.name || '');
    const away = norm(awayRaw.team?.displayName || awayRaw.team?.name || '');
    const homeGrp = TEAM_TO_GROUP[home];
    const awayGrp = TEAM_TO_GROUP[away];

    if (!homeGrp || !awayGrp || homeGrp !== awayGrp) continue; // not a group match
    const grp = homeGrp;

    const hg = parseInt(homeRaw.score ?? 0);
    const ag = parseInt(awayRaw.score ?? 0);

    if (isNaN(hg) || isNaN(ag)) continue;

    stats[grp][home].gp++;
    stats[grp][away].gp++;
    stats[grp][home].gf += hg;
    stats[grp][home].ga += ag;
    stats[grp][home].gd += (hg - ag);
    stats[grp][away].gf += ag;
    stats[grp][away].ga += hg;
    stats[grp][away].gd += (ag - hg);

    if (hg > ag) {
      stats[grp][home].w++; stats[grp][home].pts += 3;
      stats[grp][away].l++;
    } else if (hg < ag) {
      stats[grp][away].w++; stats[grp][away].pts += 3;
      stats[grp][home].l++;
    } else {
      stats[grp][home].d++; stats[grp][home].pts++;
      stats[grp][away].d++; stats[grp][away].pts++;
    }
    matchesProcessed++;
  }

  console.log(`Processed ${matchesProcessed} completed group matches`);

  // Build position maps
  const groups = {};
  for (const [grp, teamStats] of Object.entries(stats)) {
    const sorted = Object.entries(teamStats)
      .sort(([,a],[,b]) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    const posMap = {};
    sorted.forEach(([team], idx) => { posMap[team] = idx + 1; });
    groups[grp] = posMap;
  }

  return { groups, stats };
}

function findThirds(stats) {
  const thirds = [];
  for (const [grp, teamStats] of Object.entries(stats)) {
    const sorted = Object.entries(teamStats)
      .sort(([,a],[,b]) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    if (sorted.length >= 3) {
      const [team, s] = sorted[2];
      // Only include if they've played all 3 group games
      if (s.gp >= 3) thirds.push({ team, grp, ...s });
    }
  }
  thirds.sort((a,b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  return thirds.slice(0, 8).map(t => t.team);
}

async function main() {
  let overrides = {};
  if (existsSync('overrides.json')) {
    try { overrides = JSON.parse(readFileSync('overrides.json', 'utf8')); } catch(e) {}
  }

  let existing = { groups:{}, stats:{}, thirds:[], champion:null, boot:null };
  if (existsSync('results.json')) {
    try { existing = JSON.parse(readFileSync('results.json', 'utf8')); } catch(e) {}
  }

  const espnData = await fetchScoreboard();
  let groups, stats;

  if (espnData) {
    ({ groups, stats } = buildTables(espnData));
  } else {
    groups = existing.groups || {};
    stats = existing.stats || {};
  }

  // Apply standings overrides
  if (overrides.standings) {
    for (const [grp, manual] of Object.entries(overrides.standings)) {
      groups[grp] = manual;
    }
  }

  const thirds = (overrides.thirds?.length)
    ? overrides.thirds
    : findThirds(stats);

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
