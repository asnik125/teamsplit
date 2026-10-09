"use client";

import { useEffect, useState } from "react";
import { movePlayerToSide, type MobileTeamSide } from "@/lib/mobile-team-move";
import { rosterTeamLabel, type ThreeTeamSide } from "@/lib/player-game-view";
import type { TeamMemberPublic } from "@/lib/types";

/**
 * Mobile Admin team columns.
 * Two teams: > moves Black to White, < moves White to Black.
 * Three teams: a Move button lists the other two teams.
 * Moves transfer that player only.
 */
export function MobileTouchTeamColumns({
  teamA,
  teamB,
  teamC = [],
  editable,
  saving = false,
  onChange,
}: {
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  teamC?: TeamMemberPublic[];
  editable: boolean;
  saving?: boolean;
  onChange: (
    teamA: TeamMemberPublic[],
    teamB: TeamMemberPublic[],
    teamC?: TeamMemberPublic[]
  ) => void;
}) {
  const threeTeams = teamC.length > 0;
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    if (saving) setMenuFor(null);
  }, [saving]);

  function move(playerId: string, to: MobileTeamSide) {
    if (!editable || saving) return;
    const next = movePlayerToSide({
      teamA,
      teamB,
      teamC,
      playerId,
      to,
    });
    setMenuFor(null);
    onChange(next.teamA, next.teamB, threeTeams ? next.teamC : undefined);
  }

  function otherSides(side: ThreeTeamSide): ThreeTeamSide[] {
    return (["A", "B", "C"] as const).filter((candidate) => candidate !== side);
  }

  function renderPlayer(side: ThreeTeamSide, member: TeamMemberPublic) {
    const name = (
      <span className="m-team-chip-name">
        {member.displayName}
        {member.maybe ? " (Maybe)" : ""}
      </span>
    );

    if (!editable) {
      return (
        <li key={member.playerId} className="m-team-chip">
          {name}
        </li>
      );
    }

    if (!threeTeams) {
      const to: MobileTeamSide = side === "A" ? "B" : "A";
      const glyph = side === "A" ? ">" : "<";
      return (
        <li key={member.playerId} className="m-team-chip">
          {side === "B" ? (
            <button
              type="button"
              className="m-team-move-btn"
              aria-label={`Move to ${rosterTeamLabel(to)}`}
              disabled={saving}
              onClick={() => move(member.playerId, to)}
            >
              {glyph}
            </button>
          ) : null}
          {name}
          {side === "A" ? (
            <button
              type="button"
              className="m-team-move-btn"
              aria-label={`Move to ${rosterTeamLabel(to)}`}
              disabled={saving}
              onClick={() => move(member.playerId, to)}
            >
              {glyph}
            </button>
          ) : null}
        </li>
      );
    }

    const open = menuFor === member.playerId;
    return (
      <li key={member.playerId} className="m-team-chip">
        {name}
        <button
          type="button"
          className="m-team-move-btn m-team-move-btn-menu"
          aria-label={`Move ${member.displayName}`}
          aria-expanded={open}
          disabled={saving}
          onClick={() =>
            setMenuFor((current) =>
              current === member.playerId ? null : member.playerId
            )
          }
        >
          Move
        </button>
        {open ? (
          <div className="m-team-move-menu" role="menu">
            {otherSides(side).map((destination) => (
              <button
                key={destination}
                type="button"
                role="menuitem"
                disabled={saving}
                onClick={() => move(member.playerId, destination)}
              >
                {rosterTeamLabel(destination)}
              </button>
            ))}
          </div>
        ) : null}
      </li>
    );
  }

  function renderColumn(side: ThreeTeamSide, list: TeamMemberPublic[]) {
    return (
      <div
        data-team-side={side}
        className={`m-team-col m-team-col-${side.toLowerCase()}`}
      >
        <p className="m-team-col-title">{rosterTeamLabel(side)}</p>
        <ul className="m-team-list">
          {list.map((member) => renderPlayer(side, member))}
        </ul>
      </div>
    );
  }

  return (
    <div className="m-team-dnd">
      <div className={`m-team-split${threeTeams ? " m-team-split-3" : ""}`}>
        {renderColumn("A", teamA)}
        {renderColumn("B", teamB)}
        {threeTeams ? renderColumn("C", teamC) : null}
      </div>
    </div>
  );
}
