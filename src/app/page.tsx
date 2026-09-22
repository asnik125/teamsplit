"use client";

import { RequireAuth } from "@/components/RequireAuth";
import { AppNav } from "@/components/AppNav";
import { PageHeading } from "@/components/PageHeading";
import { PlayerGameBoard } from "@/components/PlayerGameBoard";
import { ViewportGate } from "@/components/viewport/ViewportGate";
import { MobilePlayerApp } from "@/components/mobile/MobilePlayerApp";
import { MobileAdminApp } from "@/components/mobile/MobileAdminApp";

/** Same Game page for Players and Admins; mobile uses dedicated presentation. */
export default function HomePage() {
  return (
    <RequireAuth>
      <ViewportGate
        desktop={
          <div className="player-shell">
            <AppNav />
            <PageHeading>Game</PageHeading>
            <PlayerGameBoard />
          </div>
        }
        mobilePlayer={<MobilePlayerApp />}
        mobileAdmin={<MobileAdminApp initialTab="team-builder" />}
      />
    </RequireAuth>
  );
}
