"use client";

import { RequireAuth } from "@/components/RequireAuth";
import { AppNav } from "@/components/AppNav";
import { ViewportGate } from "@/components/viewport/ViewportGate";
import { MobilePlayerApp } from "@/components/mobile/MobilePlayerApp";
import { MobileAdminApp } from "@/components/mobile/MobileAdminApp";
import { PlayersAdminContent } from "@/components/admin/PlayersAdminContent";

export default function AdminPlayersPage() {
  return (
    <RequireAuth adminOnly>
      <ViewportGate
        desktop={
          <>
            <AppNav />
            <PlayersAdminContent />
          </>
        }
        mobilePlayer={<MobilePlayerApp />}
        mobileAdmin={
          <MobileAdminApp
            initialTab="players"
            playersContent={<PlayersAdminContent />}
          />
        }
      />
    </RequireAuth>
  );
}
