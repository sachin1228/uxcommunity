/**
 * Resume attachment validation for job applications.
 *
 * Deliberately separate from `lib/image-utils.ts`: that detector only knows
 * JPEG/PNG/WebP and defaults unknown types to .webp, which would silently
 * rename a PDF. Resumes are PDF, DOC, DOCX or RTF, and the allowlist is
 * enforced on the file's magic bytes — the browser-declared MIME type is
 * trivially wrong and never trusted.
 */

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export type ResumeMime =
  | "application/pdf"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/rtf";

const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function startsWith(buffer: Buffer, prefix: Buffer): boolean {
  return buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix);
}

/**
 * The resume's real type from its leading bytes, or null when the file is
 * none of the accepted formats. DOCX is a ZIP container, so the zip signature
 * alone would also admit .xlsx and .pptx; the OOXML word processing part
 * (`word/`) is what narrows it to a Word document.
 */
export function detectResumeMime(buffer: Buffer): ResumeMime | null {
  if (startsWith(buffer, Buffer.from("%PDF-"))) return "application/pdf";
  if (startsWith(buffer, Buffer.from("{\\rtf"))) return "application/rtf";
  if (startsWith(buffer, OLE2_MAGIC)) return "application/msword";
  if (
    startsWith(buffer, Buffer.from([0x50, 0x4b, 0x03, 0x04])) &&
    buffer.includes("word/", 0, "utf8")
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

export function resumeExtension(mime: ResumeMime): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "application/msword":
      return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/rtf":
      return "rtf";
  }
}
