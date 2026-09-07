import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <div className="relative min-w-0" data-slot="native-select-wrapper">
    <select ref={ref} data-slot="native-select" className={cn("flex h-9 w-full appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-9 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive", className)} {...props}>{children}</select>
    {!props.multiple && !props.size && <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}
  </div>
));
NativeSelect.displayName = "NativeSelect";

function NativeSelectOption(props: React.OptionHTMLAttributes<HTMLOptionElement>) { return <option data-slot="native-select-option" {...props} />; }
function NativeSelectOptGroup(props: React.OptgroupHTMLAttributes<HTMLOptGroupElement>) { return <optgroup data-slot="native-select-optgroup" {...props} />; }
export { NativeSelect, NativeSelectOption, NativeSelectOptGroup };
