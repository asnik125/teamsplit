"use client";

import { RequireAuth } from "@/components/RequireAuth";
import { AppNav } from "@/components/AppNav";
import { ViewportGate } from "@/components/viewport/ViewportGate";
import { MobilePlayerApp } from "@/components/mobile/MobilePlayerApp";
import { MobileAdminApp } from "@/components/mobile/MobileAdminApp";
import { AdminGamesContent } from "@/components/admin/AdminGamesContent";

export default function AdminGamesPage() {
  return (
    <RequireAuth adminOnly>
      <ViewportGate
        desktop={
          <>
            <AppNav />
            <AdminGamesContent />
          </>
        }
        mobilePlayer={<MobilePlayerApp />}
        mobileAdmin={
          <MobileAdminApp
            initialTab="manage-games"
            gamesContent={<AdminGamesContent />}
          />
        }
      />
    </RequireAuth>
  );
}
