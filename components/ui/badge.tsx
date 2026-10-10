import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        ok: "border-transparent bg-emerald-100 text-emerald-950",
        retrying: "border-transparent bg-amber-100 text-amber-950",
        failed: "border-transparent bg-red-100 text-red-950",
        rejected: "border-transparent bg-zinc-200 text-zinc-800",
        pending: "border-transparent bg-sky-100 text-sky-950",
        queued: "border-transparent bg-violet-100 text-violet-950",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
