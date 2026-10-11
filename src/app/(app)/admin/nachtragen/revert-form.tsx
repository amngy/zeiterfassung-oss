"use client";

import * as React from "react";
import { useActionState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { revertBatchAction, type BatchState } from "./actions";

/**
 * Undo one batch. The rows are marked SUPERSEDED rather than deleted — a
 * mistaken backfill has to stay visible in the history and in the raw export,
 * it just stops counting toward anyone's hours.
 */
export function RevertBatchForm({ batchId }: { batchId: string }) {
  const [state, action, pending] = useActionState<BatchState, FormData>(
    revertBatchAction,
    {},
  );
  const [open, setOpen] = React.useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
      >
        <Undo2 className="h-3.5 w-3.5" />
        zurücknehmen
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="batchId" value={batchId} />
      <Input
        name="reason"
        required
        minLength={3}
        placeholder="Grund der Rücknahme"
        className="h-8 text-xs"
      />
      <div className="flex items-center gap-1.5">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          Bestätigen
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-ink"
        >
          Abbrechen
        </button>
      </div>
      {state.error && <p className="text-xs font-medium text-danger">{state.error}</p>}
      {state.ok && state.message && (
        <p className="text-xs font-medium text-lime-dark">{state.message}</p>
      )}
    </form>
  );
}
