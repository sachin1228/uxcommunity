import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/shadcn/label";

function FieldGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div data-slot="field-group" className={cn("flex w-full flex-col gap-5", className)} {...props} />; }
function Field({ className, orientation = "vertical", ...props }: React.HTMLAttributes<HTMLDivElement> & { orientation?: "vertical" | "horizontal" }) { return <div role="group" data-slot="field" className={cn("flex gap-2 data-[invalid=true]:text-destructive", orientation === "horizontal" ? "items-center" : "flex-col", className)} {...props} />; }
function FieldLabel(props: React.ComponentProps<typeof Label>) { return <Label data-slot="field-label" {...props} />; }
function FieldDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) { return <p data-slot="field-description" className={cn("text-sm leading-relaxed text-muted-foreground", className)} {...props} />; }
function FieldError({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) { return <p role="alert" data-slot="field-error" className={cn("text-sm text-destructive", className)} {...props} />; }
function FieldSet({ className, ...props }: React.FieldsetHTMLAttributes<HTMLFieldSetElement>) { return <fieldset data-slot="field-set" className={cn("flex flex-col gap-5", className)} {...props} />; }
function FieldLegend({ className, ...props }: React.HTMLAttributes<HTMLLegendElement>) { return <legend data-slot="field-legend" className={cn("mb-2 text-sm font-medium", className)} {...props} />; }
export { Field, FieldGroup, FieldLabel, FieldDescription, FieldError, FieldSet, FieldLegend };
