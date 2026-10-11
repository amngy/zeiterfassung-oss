"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { pairTerminalAction, type PairState } from "./actions";

export function PairForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState<PairState, FormData>(pairTerminalAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="code" value={code} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        Dieses Gerät als Terminal einrichten
      </Button>
      {state.error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{state.error}</p>
      )}
    </form>
  );
}
