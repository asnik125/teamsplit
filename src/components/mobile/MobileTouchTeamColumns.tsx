"use client";

import { useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";
import { moveMemberKeepingSizeBalance } from "@/lib/balancer";
import type { TeamMemberPublic } from "@/lib/types";

/**
 * Touch-first Team A | Team B columns for Admin mobile.
 * Uses pointer events (not HTML5 mouse-only drag).
 */
export function MobileTouchTeamColumns({
  teamA,
  teamB,
  editable,
  onChange,
  dragActiveRef,
}: {
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  editable: boolean;
  onChange: (teamA: TeamMemberPublic[], teamB: TeamMemberPublic[]) => void;
  dragActiveRef?: MutableRefObject<boolean>;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverSide, setHoverSide] = useState<"A" | "B" | null>(null);
  const colARef = useRef<HTMLDivElement | null>(null);
  const colBRef = useRef<HTMLDivElement | null>(null);

  function setDragging(id: string | null) {
    setDraggingId(id);
    if (dragActiveRef) dragActiveRef.current = Boolean(id);
  }

  function sideFromPoint(clientX: number, clientY: number): "A" | "B" | null {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    if (colARef.current?.contains(el)) return "A";
    if (colBRef.current?.contains(el)) return "B";
    return null;
  }

  function dropOn(side: "A" | "B") {
    if (!editable || !draggingId) return;
    const { teamA: nextA, teamB: nextB } = moveMemberKeepingSizeBalance(
      teamA,
      teamB,
      draggingId,
      side
    );
    setDragging(null);
    setHoverSide(null);
    if (
      nextA.map((m) => m.playerId).join() !==
        teamA.map((m) => m.playerId).join() ||
      nextB.map((m) => m.playerId).join() !==
        teamB.map((m) => m.playerId).join()
    ) {
      onChange(nextA, nextB);
    }
  }

  function finishPointer(e: ReactPointerEvent) {
    if (!draggingId) return;
    const side = sideFromPoint(e.clientX, e.clientY) ?? hoverSide;
    if (side) dropOn(side);
    else {
      setDragging(null);
      setHoverSide(null);
    }
  }

  function renderColumn(side: "A" | "B", list: TeamMemberPublic[]) {
    return (
      <div
        ref={side === "A" ? colARef : colBRef}
        data-team-side={side}
        className={`m-team-col m-team-col-${side.toLowerCase()}${
          hoverSide === side ? " m-team-col-hover" : ""
        }`}
      >
        <p className="m-team-col-title">Team {side}</p>
        <ul className="m-team-list">
          {list.map((m) => (
            <li
              key={m.playerId}
              className={`m-team-chip${
                draggingId === m.playerId ? " m-team-chip-dragging" : ""
              }`}
              onPointerDown={(e) => {
                if (!editable) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging(m.playerId);
                setHoverSide(side);
              }}
              onPointerMove={(e) => {
                if (!draggingId) return;
                const next = sideFromPoint(e.clientX, e.clientY);
                if (next) setHoverSide(next);
              }}
              onPointerUp={finishPointer}
              onPointerCancel={() => {
                setDragging(null);
                setHoverSide(null);
              }}
            >
              {m.displayName}
              {m.maybe ? " (Maybe)" : ""}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="m-team-dnd">
      <div className="m-team-split">
        {renderColumn("A", teamA)}
        {renderColumn("B", teamB)}
      </div>
      {editable ? (
        <p className="m-team-hint">Drag players between teams</p>
      ) : null}
    </div>
  );
}
