"use client";

import { useMemo, useState } from "react";
import type { AttendanceStatus, Game, Player } from "@/lib/types";
import { formatShortDate } from "@/lib/schedule";

function statusLabel(s: AttendanceStatus): string {
  if (s === "playing") return "Playing";
  if (s === "maybe") return "Maybe";
  if (s === "not_playing") return "Not playing";
  return "—";
}

function statusClass(status: AttendanceStatus): string {
  if (status === "playing") {
    return "border-green-500/50 bg-green-500/25 text-green-100";
  }
  if (status === "maybe") {
    return "border-amber-500/50 bg-amber-500/20 text-amber-100";
  }
  if (status === "not_playing") {
    return "border-red-500/50 bg-red-500/25 text-red-100";
  }
  return "border-slate-600 bg-slate-800/80 text-slate-300";
}

export type AttendanceListFilter = "all" | "playing" | "maybe" | "not";

/**
 * Compact single-date attendance table for mobile — one desktop date column.
 */
export function MobileAttendanceTable({
  game,
  players,
  myPlayerId,
  cellStatus,
  canEditPlayer,
  attendanceLocked,
  savingKey,
  onChangeStatus,
  showFilters = false,
}: {
  game: Game;
  players: Player[];
  myPlayerId: string | null;
  cellStatus: (gameId: string, playerId: string) => AttendanceStatus;
  canEditPlayer: (playerId: string) => boolean;
  attendanceLocked: boolean;
  savingKey: string | null;
  onChangeStatus: (
    gameId: string,
    playerId: string,
    status: AttendanceStatus
  ) => void;
  showFilters?: boolean;
}) {
  const [listFilter, setListFilter] = useState<AttendanceListFilter>("all");

  const filterCounts = useMemo(() => {
    let playing = 0;
    let maybe = 0;
    let not = 0;
    for (const p of players) {
      const st = cellStatus(game.id, p.id);
      if (st === "playing") playing += 1;
      else if (st === "maybe") maybe += 1;
      else if (st === "not_playing") not += 1;
    }
    return { all: players.length, playing, maybe, not };
  }, [game.id, players, cellStatus]);

  const visiblePlayers = players.filter((p) => {
    if (listFilter === "all") return true;
    const st = cellStatus(game.id, p.id);
    if (listFilter === "playing") return st === "playing";
    if (listFilter === "maybe") return st === "maybe";
    return st === "not_playing";
  });

  const dateLabel = formatShortDate(game.date);

  return (
    <div className="m-att">
      {showFilters ? (
        <div className="m-filters">
          {(
            [
              ["all", `All (${filterCounts.all})`],
              ["playing", `Playing (${filterCounts.playing})`],
              ["maybe", `Maybe (${filterCounts.maybe})`],
              ["not", `Not (${filterCounts.not})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`m-filter${listFilter === key ? " m-filter-on" : ""}`}
              onClick={() => setListFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="m-att-scroll">
        <table className="m-att-table">
          <thead>
            <tr>
              <th scope="col" className="m-att-corner">
                Player
              </th>
              <th scope="col" className="m-att-date-h">
                {dateLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {visiblePlayers.map((p, rowIdx) => {
              const st = cellStatus(game.id, p.id);
              const isMe = p.id === myPlayerId;
              const editable = canEditPlayer(p.id) && !attendanceLocked;
              const busy = savingKey === `${game.id}_${p.id}`;
              return (
                <tr
                  key={p.id}
                  className={`${isMe ? "m-att-row-me" : ""}${
                    !isMe && rowIdx % 2 === 1 ? " m-att-row-alt" : ""
                  }`}
                >
                  <th
                    scope="row"
                    className={`m-att-player${isMe ? " m-att-player-me" : ""}`}
                  >
                    <span className="m-att-player-name">
                      {p.displayName}
                      {isMe ? " (you)" : ""}
                    </span>
                  </th>
                  <td className="m-att-cell">
                    {editable ? (
                      <select
                        aria-label={`${p.displayName} · ${dateLabel}`}
                        className={`attendance-status attendance-status-compact ${statusClass(st)}`}
                        value={st}
                        disabled={busy}
                        onChange={(e) =>
                          onChangeStatus(
                            game.id,
                            p.id,
                            e.target.value as AttendanceStatus
                          )
                        }
                      >
                        <option value="no_response">—</option>
                        <option value="playing">Playing</option>
                        <option value="maybe">Maybe</option>
                        <option value="not_playing">Not playing</option>
                      </select>
                    ) : (
                      <span
                        className={`attendance-badge ${statusClass(st)}${
                          attendanceLocked ? " attendance-badge-locked" : ""
                        }`}
                      >
                        {statusLabel(st)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
