// update-scorers.mjs
// Pulls top scorer data from ESPN's public feed and writes scorers.json

import { writeFileSync } from 'fs';

const ESPN_SCORERS_URL = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/leaders';

async function main() {
  let scorers = { leaders: [], updatedAt: new Date().toISOString() };

  try {
    const res = await fetch(ESPN_SCORERS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const goalLeaders = (data.categories || []).find(c =>
      c.name === 'goals' || c.displayName?.toLowerCase().includes('goal')
    );

    if (goalLeaders) {
      scorers.leaders = (goalLeaders.leaders || []).slice(0, 20).map(l => ({
        name: l.athlete?.displayName || l.athlete?.fullName || '',
        team: l.athlete?.team?.displayName || '',
        goals: parseInt(l.value ?? l.displayValue ?? 0)
      }));
    }
  } catch(e) {
    console.error('Scorer fetch failed:', e.message);
  }

  scorers.updatedAt = new Date().toISOString();
  writeFileSync('scorers.json', JSON.stringify(scorers, null, 2));
  console.log(`[${scorers.updatedAt}] scorers.json written — ${scorers.leaders.length} leaders`);
}

main();
