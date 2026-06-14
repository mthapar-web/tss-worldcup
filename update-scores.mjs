// update-scores.mjs
// Fetches each day of the group stage individually from ESPN,
// builds group tables with FIFA tiebreakers, and writes results.json.

import { writeFileSync, readFileSync, existsSync } from 'fs';

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

const NAME_MAP = {
  'United States': 'USA',
  'South Korea': 'Korea Republic',
  'Bosnia & Herzegovina': 'Bosnia-Herzegovina',
  'Bosnia and Herzegovina': 'Bosnia-Herzegovina',
  "Côte d'Ivoire": 'Ivory Coast',
  "Cote d'Ivoire": 'Ivory Coast',
  'Turkey': 'Türkiye',
  'Cape Verde Islands': 'Cape Verde',
  'Democratic Republic of Congo': 'DR Congo',
  'Congo DR': 'DR Congo',
  'Curacao': 'Curaçao',
};

function norm(n) { return NAME_MAP[n] || n; }

const TEAM_TO_GROUP = {};
for (const [grp, teams] of Object.entries(GROUP_TEAMS)) {
  for (const t of teams) TEAM_TO_GROUP[t] = grp;
}

// Generate all dates from June 11 to June 27 (full group stage)
function getGroupStageDates() {
  const dates = [];
  const start = new Date('2026-06-11');
  const end = new Date('2026-06-27');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0,10).replace(/-/g,''));
  }
  return dates;
}

async function fetchDay(dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`;
  try {
    const res = await fetch(url);
    if (!res.ok) { console.error(`HTTP ${res.status} for ${dateStr}`); return []; }
    const data = await res.json();
    const events = data.events || [];
    if (events.length) console.log(`  ${dateStr}: ${events.length} events`);
    return events;
  } catch(e) {
    console.error(`Fetch failed for ${dateStr}:`, e.message);
    return [];
  }
}

function buildTables(events) {
  const stats = {};
  for (const [grp, teams] of Object.entries(GROUP_TEAMS)) {
    stats[grp] = {};
    for (const t of teams) stats[grp][t] = { w:0, d:0, l:0, gf:0, ga:0, gd:0, pts:0, gp:0 };
  }

  let matchesProcessed = 0;

  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    if (!comp.status?.type?.completed) continue;

    const competitors = comp.competitors || [];
    if (competitors.length !== 2) continue;

    const homeRaw = competitors.find(c => c.homeAway === 'home') || competitors[0];
    const awayRaw = competitors.find(c => c.homeAway === 'away') || competitors[1];

    const home = norm(homeRaw.team?.displayName || homeRaw.team?.name || '');
    const away = norm(awayRaw.team?.displayName || awayRaw.team?.name || '');
    const grp = TEAM_TO_GROUP[home];

    if (!grp || TEAM_TO_GROUP[away] !== grp) continue;

    const hg = parseInt(homeRaw.score ?? 0);
    const ag = parseInt(awayRaw.score ?? 0);
    if (isNaN(hg) || isNaN(ag)) continue;

    stats[grp][home].gp++; stats[grp][away].gp++;
    stats[grp][home].gf += hg; stats[grp][home].ga += ag; stats[grp][home].gd += (hg-ag);
    stats[grp][away].gf += ag; stats[grp][away].ga += hg; stats[grp][away].gd += (ag-hg);

    if (hg > ag) {
      stats[grp][home].w++; stats[grp][home].pts += 3; stats[grp][away].l++;
    } else if (hg < ag) {
      stats[grp][away].w++; stats[grp][away].pts += 3; stats[grp][home].l++;
    } else {
      stats[grp][home].d++; stats[grp][home].pts++;
      stats[grp][away].d++; stats[grp][away].pts++;
    }

    console.log(`    ${home} ${hg}-${ag} ${away} (Group ${grp})`);
    matchesProcessed++;
  }

  console.log(`Total: ${matchesProcessed} completed matches`);

  const groups = {};
  for (const [grp, teamStats] of Object.entries(stats)) {
    const sorted = Object.entries(teamStats)
      .sort(([,a],[,b]) => b.pts-a.pts || b.gd-a.gd || b.gf-a.gf);
    const posMap = {};
    sorted.forEach(([team], idx) => { posMap[team] = idx+1; });
    groups[grp] = posMap;
  }

  return { groups, stats };
}

function findThirds(stats) {
  const thirds = [];
  for (const [grp, teamStats] of Object.entries(stats)) {
    const sorted = Object.entries(teamStats)
      .sort(([,a],[,b]) => b.pts-a.pts || b.gd-a.gd || b.gf-a.gf);
    if (sorted.length >= 3) {
      const [team, s] = sorted[2];
      if (s.gp >= 3) thirds.push({ team, ...s });
    }
  }
  thirds.sort((a,b) => b.pts-a.pts || b.gd-a.gd || b.gf-a.gf);
  return thirds.slice(0,8).map(t => t.team);
}

async function main() {
  let overrides = {};
  if (existsSync('overrides.json')) {
    try { overrides = JSON.parse(readFileSync('overrides.json','utf8')); } catch(e) {}
  }
  let existing = { groups:{}, stats:{}, thirds:[], champion:null, boot:null };
  if (existsSync('results.json')) {
    try { existing = JSON.parse(readFileSync('results.json','utf8')); } catch(e) {}
  }

  // Fetch all group stage days
  const dates = getGroupStageDates();
  const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const pastAndToday = dates.filter(d => d <= today);

  console.log(`Fetching ${pastAndToday.length} days...`);
  const allEvents = [];
  for (const date of pastAndToday) {
    const events = await fetchDay(date);
    allEvents.push(...events);
  }

  // Deduplicate by event id
  const seen = new Set();
  const unique = allEvents.filter(e => { if(seen.has(e.id)){return false;} seen.add(e.id); return true; });

  let groups, stats;
  if (unique.length > 0) {
    ({ groups, stats } = buildTables(unique));
  } else {
    groups = existing.groups || {};
    stats = existing.stats || {};
  }

  if (overrides.standings) {
    for (const [grp, manual] of Object.entries(overrides.standings)) {
      groups[grp] = manual;
    }
  }

  const thirds = overrides.thirds?.length ? overrides.thirds : findThirds(stats);

  const out = {
    groups, stats, thirds,
    champion: overrides.champion || existing.champion || null,
    boot: overrides.boot || existing.boot || null,
    updatedAt: new Date().toISOString()
  };

  writeFileSync('results.json', JSON.stringify(out, null, 2));
  console.log(`[${out.updatedAt}] Done — ${Object.keys(groups).length} groups, ${thirds.length} thirds`);
}

main();
