"use client";

import type { Game } from "@/lib/types";
import { formatDisplayDate, formatDisplayTime } from "@/lib/schedule";
import { gameHasNoGame } from "@/lib/no-game";

function gameMetaLine(game: Game): string {
  const time = formatDisplayTime(game.startTime);
  const end = game.endTime ? ` – ${formatDisplayTime(game.endTime)}` : "";
  const loc = game.location ? ` · ${game.location}` : "";
  return `${time}${end}${loc}`;
}

/**
 * Shared mobile game/date selector — one selected game at a time
 * (mobile stand-in for the desktop multi-column date header).
 */
export function MobileGameSelector({
  games,
  selectedGameId,
  onSelect,
  showNoGameToggle = false,
  onToggleNoGame,
  showNoGameBanner = false,
}: {
  games: Game[];
  selectedGameId: string | null;
  onSelect: (gameId: string) => void;
  showNoGameToggle?: boolean;
  onToggleNoGame?: (gameId: string, noGame: boolean) => void;
  /** Player-facing label when the selected game is No Game. */
  showNoGameBanner?: boolean;
}) {
  const game = games.find((g) => g.id === selectedGameId) ?? null;
  if (!game) {
    return <p className="m-muted">No upcoming game.</p>;
  }

  const noGame = gameHasNoGame(game);

  return (
    <div className="m-game-select">
      <div className="m-game-select-face">
        <select
          className="m-game-select-native"
          aria-label="Select game"
          value={game.id}
          onChange={(e) => onSelect(e.target.value)}
        >
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {formatDisplayDate(g.date)}
              {g.location ? ` · ${g.location}` : ""}
            </option>
          ))}
        </select>
        <div className="m-game-select-copy" aria-hidden>
          <p className="m-game-date">{formatDisplayDate(game.date)}</p>
          <p className="m-game-meta">{gameMetaLine(game)}</p>
        </div>
        <span className="m-game-select-chevron" aria-hidden>
          ▾
        </span>
      </div>
      {showNoGameToggle && onToggleNoGame ? (
        <label className="m-nogame-toggle">
          <input
            type="checkbox"
            checked={noGame}
            onChange={(e) => onToggleNoGame(game.id, e.target.checked)}
          />
          No Game
        </label>
      ) : null}
      {showNoGameBanner && noGame ? (
        <p className="m-nogame">No Game this week</p>
      ) : null}
    </div>
  );
}
