"use client";

import { useId, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/shadcn/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/shadcn/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/shadcn/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/shadcn/avatar";

interface Option { value: string; label: string; imageUrl?: string | null; }
interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** If true, an "Other" option is appended when there are no search results */
  allowOther?: boolean;
  otherValue?: string;
  otherLabel?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

function OptionAvatar({ option }: { option: Option }) {
  return <Avatar className="size-5 rounded"><AvatarImage src={option.imageUrl ?? undefined} alt="" /><AvatarFallback className="rounded">{option.label[0]?.toUpperCase()}</AvatarFallback></Avatar>;
}

export function SearchableSelect({ options, value, onChange, placeholder = "Select…", allowOther = false, otherValue = "other", otherLabel = "Other", disabled = false, required = false, id }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const showOther = allowOther && query.trim().length > 0 && filtered.length === 0;
  const selected = allowOther && value === otherValue ? { value, label: otherLabel } : options.find((option) => option.value === value);
  function select(next: string) { onChange(next); setOpen(false); setQuery(""); }

  return (
    <Popover open={open && !disabled} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button ref={triggerRef} id={id} type="button" variant="outline" role="combobox" aria-expanded={open && !disabled} aria-controls={listId} aria-required={required} disabled={disabled} className="w-full justify-between">
          <span className="flex min-w-0 items-center gap-2">{selected && <OptionAvatar option={selected} />}<span className="truncate">{selected?.label ?? placeholder}</span></span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0" onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search…" aria-label="Search options" onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
          <CommandList id={listId}>
            {!showOther && <CommandEmpty>No results found</CommandEmpty>}
            <CommandGroup>
              {filtered.map((option) => <CommandItem key={option.value} value={option.value} onSelect={() => select(option.value)}><OptionAvatar option={option} /><span className="flex-1 truncate">{option.label}</span>{value === option.value && <Check aria-label="Selected" />}</CommandItem>)}
              {showOther && <CommandItem value={otherValue} onSelect={() => select(otherValue)}>{otherLabel}{value === otherValue && <Check aria-label="Selected" />}</CommandItem>}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
