"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tide)]",
  {
    variants: {
      variant: {
        default: "bg-[var(--tide)] text-[#f6f3ea] hover:bg-[#0c4e4a]",
        outline: "border border-[var(--line)] bg-[var(--paper-2)] hover:bg-white",
        ghost: "hover:bg-black/5",
        danger: "bg-[var(--cinnabar)] text-white hover:bg-[#a3382c]",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Input(props: React.ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--tide)]",
        props.className,
      )}
    />
  );
}

export function Badge({ children, tone = "tide" }: { children: React.ReactNode; tone?: "tide" | "ochre" | "danger" | "pine" | "muted" }) {
  const tones = {
    tide: "bg-[#e5f3f1] text-[var(--tide)]",
    ochre: "bg-[#f8efe4] text-[var(--ochre)]",
    danger: "bg-[#f8e8e4] text-[var(--cinnabar)]",
    pine: "bg-[#e7f3ec] text-[var(--pine)]",
    muted: "bg-black/5 text-[var(--muted)]",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[#142421]/40" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-[var(--line)] bg-[var(--paper-2)] p-6 shadow-[var(--shadow)]">
          <DialogPrimitive.Title className="font-serif text-2xl">{title}</DialogPrimitive.Title>
          <div className="mt-3 text-sm leading-6 text-[var(--muted)]">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Switch(props: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      {...props}
      className={cn(
        "relative h-6 w-11 rounded-full bg-[#d9d0c3] data-[state=checked]:bg-[var(--tide)]",
        props.className,
      )}
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-[22px]" />
    </SwitchPrimitive.Root>
  );
}
