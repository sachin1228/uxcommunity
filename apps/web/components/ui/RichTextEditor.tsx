"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Heading3, Italic, List, ListOrdered } from "lucide-react";
import {
  RICH_TEXT_MAX_CHARS,
  richTextIsEmpty,
  richTextToInlineHtml,
  richTextToPlainText,
  sanitizeRichText,
  trimRichText,
} from "@/lib/jobs/rich-text";

/**
 * The rich description field.
 *
 * A member pastes a role from a doc and expects it to arrive as they wrote it:
 * bullets, spacing, bold headings. The browser already knows how to keep all of
 * that when html lands in a contentEditable, so the work here is pointed at the
 * two things it does not do — storing the subset the sanitiser allows, and
 * saying what is on and off at the caret.
 *
 * The DOM is deliberately uncontrolled. Writing the value back on every
 * keystroke would move the caret to the start of the field, so the editor is
 * the source of truth while it has focus and the value is only read back into
 * it once focus has left — which is also when a trailing empty line the member
 * left behind is trimmed away.
 *
 * `document.execCommand` is deprecated and is still the only way to ask a
 * contentEditable for bold without hand-writing selection surgery. What it
 * produces is not what is kept: `<b>`, `<i>` and `<span style="font-weight:700">`
 * all become the stored subset through the sanitiser.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [empty, setEmpty] = useState(() => richTextIsEmpty(value));
  const [overBy, setOverBy] = useState(0);
  const [marks, setMarks] = useState<Marks>(IDLE_MARKS);

  /** What the editor currently says, in the stored form. */
  const readOut = useCallback(() => {
    const element = editorRef.current;
    if (!element) return "";
    const html = sanitizeRichText(element.innerHTML);
    setEmpty(richTextIsEmpty(html));
    setOverBy(Math.max(0, richTextToPlainText(html).trim().length - RICH_TEXT_MAX_CHARS));
    return html;
  }, []);

  const handleInput = useCallback(() => {
    onChange(readOut());
  }, [onChange, readOut]);

  // The value flows back into the DOM only when the member is not typing in it.
  useEffect(() => {
    if (focused) return;
    const element = editorRef.current;
    if (!element) return;
    const next = sanitizeRichText(value);
    if (element.innerHTML !== next) element.innerHTML = next;
    setEmpty(richTextIsEmpty(next));
    setOverBy(Math.max(0, richTextToPlainText(next).trim().length - RICH_TEXT_MAX_CHARS));
  }, [focused, value]);

  // Which buttons are lit follows the caret, so the toolbar never lies about
  // the text it is about to change.
  useEffect(() => {
    if (!focused) return;
    const update = () => setMarks(readMarks());
    document.addEventListener("selectionchange", update);
    update();
    return () => document.removeEventListener("selectionchange", update);
  }, [focused]);

  const runCommand = useCallback(
    (command: string, argument?: string) => {
      const element = editorRef.current;
      if (!element || disabled) return;
      element.focus();
      document.execCommand(command, false, argument);
      onChange(readOut());
      setMarks(readMarks());
    },
    [disabled, onChange, readOut]
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      // The rich flavour is what carries bullets, headings and bold; the plain
      // flavour is the fallback, and its line breaks are content the sanitiser
      // keeps. An empty html flavour from some sources is why both are read.
      const html = clipboard.getData("text/html");
      const text = clipboard.getData("text/plain");
      if (!html && !text) return;

      event.preventDefault();
      document.execCommand("insertHTML", false, richTextToInlineHtml(html || text));
      onChange(readOut());
      setMarks(readMarks());
    },
    [disabled, onChange, readOut]
  );

  const handleBlur = useCallback(() => {
    setFocused(false);
    const element = editorRef.current;
    if (!element) return;
    const trimmed = trimRichText(sanitizeRichText(element.innerHTML));
    if (element.innerHTML !== trimmed) element.innerHTML = trimmed;
    setEmpty(richTextIsEmpty(trimmed));
    setOverBy(Math.max(0, richTextToPlainText(trimmed).trim().length - RICH_TEXT_MAX_CHARS));
    onChange(trimmed);
  }, [onChange]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <div
          ref={editorRef}
          id={id}
          contentEditable={!disabled}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          aria-disabled={disabled}
          spellCheck
          onInput={handleInput}
          onBlur={handleBlur}
          onFocus={() => setFocused(true)}
          onPaste={handlePaste}
          onKeyUp={() => setMarks(readMarks())}
          onMouseUp={() => setMarks(readMarks())}
          className={`field min-h-[100px] max-h-72 overflow-y-auto ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
        />
        {empty && !disabled && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-2 font-body text-sm text-foreground-subtle"
          >
            {placeholder}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <ToolButton
          label="Bold"
          icon={Bold}
          active={marks.bold}
          disabled={disabled}
          onClick={() => runCommand("bold")}
        />
        <ToolButton
          label="Italic"
          icon={Italic}
          active={marks.italic}
          disabled={disabled}
          onClick={() => runCommand("italic")}
        />
        <ToolButton
          label="Bulleted list"
          icon={List}
          active={marks.bullet}
          disabled={disabled}
          onClick={() => runCommand("insertUnorderedList")}
        />
        <ToolButton
          label="Numbered list"
          icon={ListOrdered}
          active={marks.ordered}
          disabled={disabled}
          onClick={() => runCommand("insertOrderedList")}
        />
        <ToolButton
          label="Heading"
          icon={Heading3}
          active={marks.heading}
          disabled={disabled}
          onClick={() => runCommand("formatBlock", marks.heading ? "P" : "H3")}
        />
      </div>

      {overBy > 0 ? (
        <span className="font-body text-[11px] text-amber-500">
          {overBy.toLocaleString()} character{overBy === 1 ? "" : "s"} over the{" "}
          {RICH_TEXT_MAX_CHARS.toLocaleString()} limit — trim the text before saving.
        </span>
      ) : (
        <span className="font-body text-[11px] text-foreground-subtle">
          Paste from a doc and the bullets, headings and spacing come with it.
        </span>
      )}
    </div>
  );
}

interface Marks {
  bold: boolean;
  italic: boolean;
  bullet: boolean;
  ordered: boolean;
  heading: boolean;
}

const IDLE_MARKS: Marks = { bold: false, italic: false, bullet: false, ordered: false, heading: false };

/** What the toolbar should light up, read from the caret's own position. */
function readMarks(): Marks {
  const selection = window.getSelection();
  const node = selection?.anchorNode ?? null;
  const element =
    node === null ? null : node.nodeType === 1 ? (node as Element) : node.parentElement;
  const block = element?.closest("h2, h3, ul, ol");
  const tag = block?.tagName.toLowerCase() ?? "";

  return {
    bold: commandState("bold"),
    italic: commandState("italic"),
    bullet: tag === "ul",
    ordered: tag === "ol",
    heading: tag === "h2" || tag === "h3",
  };
}

function commandState(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    // A document without a selection: nothing is on.
    return false;
  }
}

function ToolButton({
  label,
  icon: Icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Bold;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // The press must not move the selection out of the text it is about to
      // change, so the default focus shift on mousedown is cancelled.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-55 ${
        active
          ? "bg-accent-soft text-foreground"
          : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
      }`}
    >
      <Icon strokeWidth={2.25} size={15} />
    </button>
  );
}
