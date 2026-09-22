"use client";

import { RequireAuth } from "@/components/RequireAuth";
import { AppNav } from "@/components/AppNav";
import { PageHeading } from "@/components/PageHeading";
import { PlayerGameBoard } from "@/components/PlayerGameBoard";

/** Same Game page for Players and Admins (Admin gets extra controls on the board). */
export default function HomePage() {
  return (
    <RequireAuth>
      <div className="player-shell">
        <AppNav />
        <PageHeading>Game</PageHeading>
        <PlayerGameBoard />
      </div>
    </RequireAuth>
  );
}
