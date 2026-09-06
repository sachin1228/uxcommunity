"use client";

import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/shadcn/toggle-group";

const FILTERS = ["Newest", "Trending", "Following"] as const;
type Filter = (typeof FILTERS)[number];

export function HomeFeedFilters() {
  const [active, setActive] = useState<Filter>("Newest");

  return (
    <section className="flex justify-center px-4 py-4" aria-label="Feed filters">
      <ToggleGroup type="single" variant="outline" value={active} onValueChange={(value) => {
        if (FILTERS.includes(value as Filter)) setActive(value as Filter);
      }} aria-label="Feed sorting">
        {FILTERS.map((filter) => <ToggleGroupItem key={filter} value={filter}>{filter}</ToggleGroupItem>)}
      </ToggleGroup>
    </section>
  );
}
