"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/shadcn/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/shadcn/sheet";
import { GlobalSidebar } from "@/components/sidebar/GlobalSidebar";

interface Props {
  userId: string;
  user: {
    name: string;
    email: string;
    avatarUrl: string | null;
    initial: string;
  };
}

export function MobileSidebar({ userId, user }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0 lg:hidden" aria-label="Open navigation menu">
          <Menu aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" aria-describedby={undefined} className="flex w-[min(18rem,85vw)] flex-col gap-0 p-0">
        <SheetHeader className="border-b px-4 py-4 text-left">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1" onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a[href]")) setOpen(false);
        }}>
          <GlobalSidebar userId={userId} user={user} mobile />
        </div>
      </SheetContent>
    </Sheet>
  );
}
