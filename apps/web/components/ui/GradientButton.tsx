"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type GradientButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function GradientButton({ children, onClick, className = "", ...props }: GradientButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex h-9 w-max shrink-0 cursor-pointer items-center overflow-hidden rounded-lg border-0 px-3 text-sm font-medium tracking-[-0.01em] text-white no-underline shadow-[0_1px_2px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.38)] transition-[filter,box-shadow] duration-150 ease-out hover:brightness-[1.12] hover:shadow-[0_3px_6px_rgba(0,90,210,0.28),inset_0_1px_0_rgba(255,255,255,0.5)] ${className}`}
      {...props}
    >
      <span aria-hidden="true" className="absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#398cff] via-[#0868ed] to-[#0564e8]" />
      <span aria-hidden="true" className="absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/20 via-white/[0.04] to-transparent" />
      <span className="relative flex items-center gap-1.5">{children}</span>
    </button>
  );
}
