"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function Salir({ email }: { email: string }) {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
      title={email}
      className="border-b border-blue pb-1 text-xs uppercase tracking-[0.18em] text-text hover:text-blue transition-colors"
    >
      Salir
    </button>
  );
}
