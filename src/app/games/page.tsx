"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/firebase/auth-context";

/** Legacy route — Player View is one Game page at /. */
function RedirectGames() {
  const router = useRouter();
  const { showAdminUI } = useAuth();

  useEffect(() => {
    router.replace(showAdminUI ? "/admin/games" : "/");
  }, [router, showAdminUI]);

  return (
    <p className="text-slate-400">Redirecting…</p>
  );
}

export default function GamesPage() {
  return (
    <RequireAuth>
      <RedirectGames />
    </RequireAuth>
  );
}
