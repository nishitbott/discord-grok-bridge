"use client";

import { useActionState } from "react";

import { startGatewayAction, type StartGatewayState } from "@/app/(console)/actions";
import { Button } from "@/components/ui/button";

const initialState: StartGatewayState = { message: "" };

export function StartGatewayButton() {
  const [state, formAction, pending] = useActionState(startGatewayAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="intent" value="start" />
      <Button type="submit" disabled={pending}>
        {pending ? "Starting…" : "Start gateway now"}
      </Button>
      {state.message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
