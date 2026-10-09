import assert from "node:assert/strict";
import { test } from "node:test";
import { detectResumeMime, resumeExtension } from "./resume-file";

/**
 * Resumes are uploaded by applicants and opened by posters, so the file's
 * real format matters: the declared MIME type is never trusted, and a file
 * that is not one of the four accepted formats must be refused. These tests
 * pin the magic-byte detector, including the case that a plain ZIP is not a
 * DOCX.
 */

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(32, 0x20)]);
const RTF = Buffer.concat([Buffer.from("{\\rtf1\\ansi hello"), Buffer.alloc(16)]);
const DOC = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(32, 0x00),
]);

function docxBuffer(): Buffer {
  // A minimal zip local header followed by the OOXML word part, which is
  // what distinguishes a DOCX from any other zip.
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("PK\u0003\u0004 [Content_Types].xml word/document.xml"),
    Buffer.alloc(16),
  ]);
}

test("recognises the four accepted resume formats by their bytes", () => {
  assert.equal(detectResumeMime(PDF), "application/pdf");
  assert.equal(detectResumeMime(RTF), "application/rtf");
  assert.equal(detectResumeMime(DOC), "application/msword");
  assert.equal(
    detectResumeMime(docxBuffer()),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
});

test("refuses a plain zip even though DOCX starts with the same signature", () => {
  const zip = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("PK\u0003\u0004 photos/vacation.jpg"),
    Buffer.alloc(16),
  ]);
  assert.equal(detectResumeMime(zip), null);
});

test("refuses images, executables and empty files", () => {
  assert.equal(
    detectResumeMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), // JPEG
    null
  );
  assert.equal(detectResumeMime(Buffer.from([0x4d, 0x5a, 0x90])), null); // MZ
  assert.equal(detectResumeMime(Buffer.alloc(0)), null);
  // A PDF signature must be at the very start, not somewhere inside.
  assert.equal(detectResumeMime(Buffer.concat([Buffer.alloc(4), PDF])), null);
});

test("maps each accepted type to a safe extension", () => {
  assert.equal(resumeExtension("application/pdf"), "pdf");
  assert.equal(resumeExtension("application/msword"), "doc");
  assert.equal(
    resumeExtension("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "docx"
  );
  assert.equal(resumeExtension("application/rtf"), "rtf");
});
