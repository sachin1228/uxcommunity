"use client";

import { Button, type ButtonProps } from "@/components/ui/shadcn/button";

export function GradientButton({ type = "button", ...props }: ButtonProps) {
  return <Button type={type} {...props} />;
}
