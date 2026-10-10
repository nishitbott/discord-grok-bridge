"use client";

import { useActionState } from "react";

import { createKeyAction, type CreateKeyState } from "@/app/(console)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: CreateKeyState = { rawKey: "", error: "" };

export function CreateKeyForm({ disabled }: { disabled: boolean }) {
  const [state, formAction, pending] = useActionState(createKeyAction, initialState);

  return (
    <div className="space-y-4">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="name">Key name</Label>
          <Input
            id="name"
            name="name"
            maxLength={64}
            required
            disabled={disabled || pending}
            placeholder="railway-listener"
          />
        </div>
        <Button type="submit" disabled={disabled || pending}>
          {pending ? "Creating…" : "Create key"}
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.rawKey ? (
        <div className="space-y-2 rounded-lg border bg-muted/60 p-4" role="status">
          <p className="text-sm font-medium">Copy this key now. It is not stored and will not be shown again.</p>
          <Input readOnly value={state.rawKey} aria-label="New API key" spellCheck={false} className="font-mono" />
        </div>
      ) : null}
    </div>
  );
}
