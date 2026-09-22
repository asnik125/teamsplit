/**
 * Audit: original HTML balancer vs TeamSplit balancer.
 * Read-only comparison — does not mutate Firebase.
 * npx tsx scripts/audit-balancer-vs-html.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  calculateOverall,
  generateSnakeDraftTeams,
  teamStrength,
  autoRebalanceAfterMove,
  movePlayerBetweenTeams,
  enforceTeamSizeBalance,
} from "../src/lib/balancer";
import type { PlayerRatings, RatedPlayer } from "../src/lib/types";
import { RATING_KEYS } from "../src/lib/types";

type SeedPlayer = {
  id: string;
  name: string;
} & PlayerRatings;

/** Exact original HTML overall: string from (sum/11).toFixed(1) */
function htmlOverall(p: PlayerRatings): string {
  const sum =
    p.speed +
    p.strength +
    p.stamina +
    p.control +
    p.passing +
    p.action +
    p.defend +
    p.attack +
    p.transition +
    p.decisions +
    p.workrate;
  return (sum / 11).toFixed(1);
}

/** Exact original HTML generateTeams snake (team1 / team2 by name). */
function htmlGenerateTeams(players: SeedPlayer[]): {
  team1: SeedPlayer[];
  team2: SeedPlayer[];
} {
  const active = [...players];
  active.sort(
    (a, b) => parseFloat(htmlOverall(b)) - parseFloat(htmlOverall(a))
  );
  const team1: SeedPlayer[] = [];
  const team2: SeedPlayer[] = [];
  active.forEach((player, index) => {
    const cycle = index % 4;
    if (cycle === 0 || cycle === 3) team1.push(player);
    else team2.push(player);
  });
  return { team1, team2 };
}

function htmlTeamSum(team: SeedPlayer[]): string {
  let sum = 0;
  for (const p of team) sum += parseFloat(htmlOverall(p));
  return sum.toFixed(1);
}

function toRated(p: SeedPlayer): RatedPlayer {
  const ratings = Object.fromEntries(
    RATING_KEYS.map((k) => [k, p[k]])
  ) as PlayerRatings;
  return {
    id: p.id,
    displayName: p.name,
    email: null,
    active: true,
    linkedUid: null,
    createdAt: "",
    updatedAt: "",
    ...ratings,
    overall: calculateOverall(ratings),
  };
}

function names(list: { name?: string; displayName?: string }[]): string[] {
  return list.map((p) => p.name ?? p.displayName ?? "");
}

function sameMembership(
  a: string[],
  b: string[],
  allowLabelSwap: boolean
): { match: boolean; labelSwapped: boolean } {
  const as = [...a].sort().join("|");
  const bs = [...b].sort().join("|");
  if (as === bs) return { match: true, labelSwapped: false };
  if (!allowLabelSwap) return { match: false, labelSwapped: false };
  return { match: false, labelSwapped: false };
}

function teamsEqualOrSwapped(
  htmlA: string[],
  htmlB: string[],
  tsA: string[],
  tsB: string[]
): { ok: boolean; swapped: boolean; detail: string } {
  const sameOrder =
    htmlA.join("|") === tsA.join("|") && htmlB.join("|") === tsB.join("|");
  if (sameOrder) return { ok: true, swapped: false, detail: "exact match" };

  const sameSetA =
    [...htmlA].sort().join("|") === [...tsA].sort().join("|") &&
    [...htmlB].sort().join("|") === [...tsB].sort().join("|");
  if (sameSetA) return { ok: true, swapped: false, detail: "same sets (order may differ)" };

  const swappedSets =
    [...htmlA].sort().join("|") === [...tsB].sort().join("|") &&
    [...htmlB].sort().join("|") === [...tsA].sort().join("|");
  if (swappedSets)
    return { ok: true, swapped: true, detail: "label swap A↔B" };

  return {
    ok: false,
    swapped: false,
    detail: `HTML A=[${htmlA}] B=[${htmlB}] vs TS A=[${tsA}] B=[${tsB}]`,
  };
}

const seed = JSON.parse(
  readFileSync(resolve("soccer_players_backup.json"), "utf8")
) as SeedPlayer[];

console.log("=== 1. OVERALL FORMULA ===\n");
let overallFail = 0;
for (const p of seed) {
  const html = htmlOverall(p);
  const ts = calculateOverall(p).toFixed(1);
  const pass = html === ts;
  if (!pass) overallFail++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${p.name}: html=${html} teamsplit=${ts}`
  );
  console.log(
    `       ratings: ${RATING_KEYS.map((k) => `${k}=${p[k]}`).join(" ")}`
  );
}
console.log(
  `\nOverall: ${overallFail === 0 ? "PASS" : "FAIL"} (${seed.length - overallFail}/${seed.length})\n`
);

console.log("=== 2–4. GENERATION + SIZES + STRENGTH (6..11) ===\n");
const sizeResults: Record<
  number,
  {
    sizesOk: boolean;
    membershipOk: boolean;
    assign: ReturnType<typeof teamsEqualOrSwapped>;
    strengthOk: boolean;
    htmlSum: [string, string];
    tsSum: [string, string];
    htmlSizes: [number, number];
    tsSizes: [number, number];
    enforceChanged: boolean;
  }
> = {};

for (let n = 6; n <= 11; n++) {
  const subset = seed.slice(0, n);
  const html = htmlGenerateTeams(subset);
  const rated = subset.map(toRated);
  const rawSnake = (() => {
    // replicate TeamSplit snake WITHOUT enforce, to detect safety-net impact
    const sorted = [...rated].sort((a, b) => b.overall - a.overall);
    const teamA: RatedPlayer[] = [];
    const teamB: RatedPlayer[] = [];
    sorted.forEach((player, index) => {
      const cycle = index % 4;
      if (cycle === 0 || cycle === 3) teamA.push(player);
      else teamB.push(player);
    });
    return { teamA, teamB };
  })();
  const withEnforce = enforceTeamSizeBalance(rawSnake.teamA, rawSnake.teamB);
  const ts = generateSnakeDraftTeams(rated);

  const enforceChanged =
    names(rawSnake.teamA).join("|") !== names(withEnforce.teamA).join("|") ||
    names(rawSnake.teamB).join("|") !== names(withEnforce.teamB).join("|");

  const htmlA = names(html.team1);
  const htmlB = names(html.team2);
  const tsA = names(ts.teamA);
  const tsB = names(ts.teamB);

  const allIds = new Set([...htmlA, ...htmlB]);
  const membershipOk =
    allIds.size === n &&
    htmlA.length + htmlB.length === n &&
    tsA.length + tsB.length === n &&
    new Set([...tsA, ...tsB]).size === n;

  const sizesOk =
    Math.abs(html.team1.length - html.team2.length) <= 1 &&
    Math.abs(ts.teamA.length - ts.teamB.length) <= 1;

  const assign = teamsEqualOrSwapped(htmlA, htmlB, tsA, tsB);

  const htmlSum: [string, string] = [
    htmlTeamSum(html.team1),
    htmlTeamSum(html.team2),
  ];
  const tsSum: [string, string] = [
    teamStrength(ts.teamA).toFixed(1),
    teamStrength(ts.teamB).toFixed(1),
  ];
  const strengthOk =
    (htmlSum[0] === tsSum[0] && htmlSum[1] === tsSum[1]) ||
    (htmlSum[0] === tsSum[1] && htmlSum[1] === tsSum[0] && assign.swapped);

  sizeResults[n] = {
    sizesOk,
    membershipOk,
    assign,
    strengthOk,
    htmlSum,
    tsSum,
    htmlSizes: [html.team1.length, html.team2.length],
    tsSizes: [ts.teamA.length, ts.teamB.length],
    enforceChanged,
  };

  console.log(`--- N=${n} ---`);
  console.log(
    `  HTML sizes ${html.team1.length}/${html.team2.length}  TS ${ts.teamA.length}/${ts.teamB.length}`
  );
  console.log(`  HTML A: ${htmlA.join(", ")}`);
  console.log(`  HTML B: ${htmlB.join(", ")}`);
  console.log(`  TS   A: ${tsA.join(", ")}`);
  console.log(`  TS   B: ${tsB.join(", ")}`);
  console.log(
    `  strength HTML ${htmlSum[0]}/${htmlSum[1]}  TS ${tsSum[0]}/${tsSum[1]}`
  );
  console.log(
    `  membership=${membershipOk} sizes=${sizesOk} assign=${assign.ok} (${assign.detail}) strength=${strengthOk} enforceChanged=${enforceChanged}`
  );
  console.log(
    `  RESULT: ${
      membershipOk && sizesOk && assign.ok && strengthOk ? "PASS" : "FAIL"
    }\n`
  );
}

console.log("=== 5. AUTO-REBALANCE ===\n");
// Same fixture as unit test: move strong into weak team
const fixture = [
  toRated(seed.find((p) => p.name === "Kolya I")!), // weak-ish
  toRated(seed.find((p) => p.name === "Alex R")!), // strong
  toRated(seed.find((p) => p.name === "Max")!),
];
let teamA = [fixture[0]!];
let teamB = [fixture[1]!, fixture[2]!];
const afterMove = movePlayerBetweenTeams(teamA, teamB, fixture[1]!.id, "A");
const rebalanced = autoRebalanceAfterMove(
  afterMove.teamA,
  afterMove.teamB,
  fixture[1]!.id,
  "A"
);

// Manual HTML-equivalent rebalance on same arrays
function htmlStyleRebalance(
  target: RatedPlayer[],
  source: RatedPlayer[],
  movedId: string
) {
  const sum = (list: RatedPlayer[]) =>
    list.reduce((a, p) => a + parseFloat(htmlOverall(p)), 0);
  let currentTargetSum = sum(target);
  let currentSourceSum = sum(source);
  let minDiff = Math.abs(currentTargetSum - currentSourceSum);
  let best: RatedPlayer | null = null;
  for (const cand of target.filter((p) => p.id !== movedId)) {
    const val = parseFloat(htmlOverall(cand));
    const hypDiff = Math.abs(
      currentTargetSum - val - (currentSourceSum + val)
    );
    if (hypDiff < minDiff) {
      minDiff = hypDiff;
      best = cand;
    }
  }
  const nextTarget = [...target];
  const nextSource = [...source];
  if (best) {
    const idx = nextTarget.findIndex((p) => p.id === best!.id);
    const [sw] = nextTarget.splice(idx, 1);
    nextSource.push(sw!);
  }
  return { nextTarget, nextSource, swappedId: best?.id ?? null };
}

const htmlReb = htmlStyleRebalance(
  afterMove.teamA,
  afterMove.teamB,
  fixture[1]!.id
);
const tsSwapId =
  rebalanced.teamA.find((p) => !afterMove.teamA.some((x) => x.id === p.id))
    ?.id ??
  rebalanced.teamB.find((p) => !afterMove.teamB.some((x) => x.id === p.id))
    ?.id ??
  null;

console.log(`HTML rebalance swap candidate: ${htmlReb.swappedId}`);
console.log(
  `TS autoRebalanceAfterMove result A=[${names(rebalanced.teamA)}] B=[${names(rebalanced.teamB)}]`
);
console.log(
  `HTML-style after swap A=[${names(htmlReb.nextTarget)}] B=[${names(htmlReb.nextSource)}]`
);
const rebalanceMatch =
  names(rebalanced.teamA).sort().join("|") ===
    names(htmlReb.nextTarget).sort().join("|") &&
  names(rebalanced.teamB).sort().join("|") ===
    names(htmlReb.nextSource).sort().join("|");
console.log(`autoRebalanceAfterMove vs HTML logic: ${rebalanceMatch ? "SAME" : "DIFFERENT"}`);
console.log(
  "NOTE: Game-page Admin DnD uses moveMemberKeepingSizeBalance (size constraint), not autoRebalanceAfterMove (strength).\n"
);

console.log("=== 7. FULL SEEDED SET (11) ===\n");
const fullHtml = htmlGenerateTeams(seed);
const fullTs = generateSnakeDraftTeams(seed.map(toRated));
console.log("Original Team 1:", names(fullHtml.team1).join(", "));
console.log("Original Team 2:", names(fullHtml.team2).join(", "));
console.log(
  "Original strength:",
  htmlTeamSum(fullHtml.team1),
  "/",
  htmlTeamSum(fullHtml.team2)
);
console.log("TeamSplit Team A:", names(fullTs.teamA).join(", "));
console.log("TeamSplit Team B:", names(fullTs.teamB).join(", "));
console.log(
  "TeamSplit strength:",
  teamStrength(fullTs.teamA).toFixed(1),
  "/",
  teamStrength(fullTs.teamB).toFixed(1)
);
const fullCmp = teamsEqualOrSwapped(
  names(fullHtml.team1),
  names(fullHtml.team2),
  names(fullTs.teamA),
  names(fullTs.teamB)
);
console.log(`Full set assignment: ${fullCmp.ok ? "PASS" : "FAIL"} (${fullCmp.detail})`);

void sameMembership;
void tsSwapId;

// Summary JSON for canvas
const summary = {
  overallPass: overallFail === 0,
  sizeResults,
  rebalanceLibMatch: rebalanceMatch,
  fullCmp,
  fullHtml: {
    a: names(fullHtml.team1),
    b: names(fullHtml.team2),
    sa: htmlTeamSum(fullHtml.team1),
    sb: htmlTeamSum(fullHtml.team2),
  },
  fullTs: {
    a: names(fullTs.teamA),
    b: names(fullTs.teamB),
    sa: teamStrength(fullTs.teamA).toFixed(1),
    sb: teamStrength(fullTs.teamB).toFixed(1),
  },
  players: seed.map((p) => ({
    name: p.name,
    ratings: Object.fromEntries(RATING_KEYS.map((k) => [k, p[k]])),
    html: htmlOverall(p),
    ts: calculateOverall(p).toFixed(1),
  })),
};
writeFileSync(
  resolve("/tmp/balancer-audit-summary.json"),
  JSON.stringify(summary, null, 2)
);
console.log("\nWrote /tmp/balancer-audit-summary.json");
