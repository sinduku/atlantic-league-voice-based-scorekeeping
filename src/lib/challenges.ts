import type { Challenge, Play } from "@/types/game";
import type { Team } from "@/lib/boxScore";

// "Long Island Ducks challenge: overturned (tag beat the runner)"
export function challengeLabel(challenge: Challenge, teamNames: Record<Team, string>): string {
  const outcome = challenge.result === "overturned" ? "overturned" : "call stands";
  return `${teamNames[challenge.team]} challenge: ${outcome}${challenge.note ? ` (${challenge.note})` : ""}`;
}

export function challengeCounts(plays: Play[]): Record<Team, { used: number; overturned: number }> {
  const counts = { away: { used: 0, overturned: 0 }, home: { used: 0, overturned: 0 } };
  for (const p of plays) {
    if (!p.challenge) continue;
    counts[p.challenge.team].used++;
    if (p.challenge.result === "overturned") counts[p.challenge.team].overturned++;
  }
  return counts;
}
