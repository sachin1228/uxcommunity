import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteFromR2, deleteR2AssetIfUnreferenced, uploadToR2 } from "@/lib/r2";
import { ALL_MEDIA_LOOKUPS } from "@/lib/r2-cleanup";
import { detectResumeMime, RESUME_MAX_BYTES, resumeExtension } from "@/lib/jobs/resume-file";
import { MAX_SAVED_RESUMES, type SavedResume } from "@/lib/settings/resumes";

/**
 * The member's saved resumes — the list they manage on Settings and pick from
 * when applying to a job.
 *
 * GET     → `{ resumes }` oldest first.
 * POST    multipart field `resume` — validate (real type from magic bytes,
 *           5 MB cap) and store; the row becomes the default whenever no
 *           saved row currently carries the flag (first upload, or after the
 *           previous default was deleted). 409 once MAX_SAVED_RESUMES are
 *           saved.
 * PATCH   `{ id }` — make that resume the default (unsets the previous one).
 * DELETE  `?id=` — remove the resume; when it was the default, the oldest
 *           remaining resume is promoted, so a non-empty list always keeps
 *           exactly one default. The file is reclaimed from R2 only when
 *           nothing else references it (a job application that reused the URL
 *           keeps it alive — same rule every delete path in the app follows).
 *
 * Every mutation returns the full refreshed `{ resumes }` list, so the caller
 * replaces its state from one response and never re-derives the list itself.
 * The storage key mirrors the apply flow's (`resumes/<userId>/…`) so a saved
 * resume and an attached one live under the same member prefix; the extra
 * `saved/` segment keeps the two listing prefixes apart.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_COLUMNS = "id, file_name, mime_type, size_bytes, url, is_default, created_at";

interface SavedResumeRow {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  is_default: boolean;
  created_at: string;
}

function toSavedResume(row: SavedResumeRow): SavedResume {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    url: row.url,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}

/** The member's current list, oldest first — the shape every response carries. */
async function loadResumeList(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<SavedResume[] | null> {
  const { data, error } = await db
    .from("member_resumes")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) return null;
  return (data as SavedResumeRow[]).map(toSavedResume);
}

function refreshed(resumes: SavedResume[] | null) {
  if (!resumes) {
    return NextResponse.json(
      { error: "load_failed", message: "Your resumes could not be loaded." },
      { status: 500 },
    );
  }
  return NextResponse.json({ resumes });
}

export async function GET() {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const db = createServiceClient();
  return refreshed(await loadResumeList(db, session.userId!));
}

export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "resume_required", message: "Attach a resume to upload." }, { status: 415 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form", message: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("resume");
  if (!file || !(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "resume_required", message: "Attach a resume to upload." }, { status: 422 });
  }
  if (file.size > RESUME_MAX_BYTES) {
    return NextResponse.json({ error: "resume_too_large", message: "Resume exceeds the 5 MB limit." }, { status: 413 });
  }

  const db = createServiceClient();
  const userId = session.userId!;

  const { data: existingRows, error: existingError } = await db
    .from("member_resumes")
    .select("id, is_default")
    .eq("user_id", userId);

  if (existingError) {
    console.error("[settings/resumes] load error:", existingError);
    return NextResponse.json(
      { error: "load_failed", message: "Your resumes could not be loaded." },
      { status: 500 },
    );
  }

  const existing = existingRows ?? [];
  if (existing.length >= MAX_SAVED_RESUMES) {
    return NextResponse.json(
      { error: "resume_limit", message: `You can save up to ${MAX_SAVED_RESUMES} resumes.` },
      { status: 409 },
    );
  }

  // The browser-declared MIME type is never trusted — the allowlist is
  // enforced on the file's magic bytes, exactly like the apply flow does.
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = detectResumeMime(buffer);
  if (!mime) {
    return NextResponse.json(
      { error: "invalid_resume_type", message: "Attach a PDF, DOC, DOCX or RTF resume." },
      { status: 422 },
    );
  }

  const rawName = file instanceof File ? file.name.trim() : "";
  const fileName = rawName || `resume.${resumeExtension(mime)}`;

  const key = `resumes/${userId}/saved/${Date.now()}-${Math.random().toString(36).slice(2)}.${resumeExtension(mime)}`;

  let url: string;
  try {
    url = await uploadToR2(key, buffer, mime);
  } catch (error) {
    console.error("[settings/resumes] upload error:", error);
    return NextResponse.json(
      { error: "upload_failed", message: "Resume upload failed. Please try again." },
      { status: 500 },
    );
  }

  const { error: insertError } = await db.from("member_resumes").insert({
    user_id: userId,
    file_name: fileName,
    mime_type: mime,
    size_bytes: file.size,
    url,
    // The new row is the default whenever no saved row carries the flag —
    // not only on the very first upload: a default goes missing when the
    // default row is deleted, and every non-empty list must have exactly
    // one preselection for ApplyModal to honor.
    is_default: !existing.some((row) => row.is_default),
  });

  if (insertError) {
    console.error("[settings/resumes] insert error:", insertError);
    // The row never landed, so the object has no owner — take it back out.
    try {
      await deleteFromR2(key);
    } catch (cleanupError) {
      console.error("[settings/resumes] upload cleanup error:", cleanupError);
    }
    return NextResponse.json(
      { error: "save_failed", message: "The resume could not be saved. Please try again." },
      { status: 500 },
    );
  }

  return refreshed(await loadResumeList(db, userId));
}

export async function PATCH(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Invalid request body." }, { status: 400 });
  }

  if (typeof body.id !== "string" || !UUID_RE.test(body.id)) {
    return NextResponse.json({ error: "invalid_resume_id", message: "Choose a saved resume." }, { status: 422 });
  }

  const db = createServiceClient();
  const userId = session.userId!;

  const { data: row } = await db
    .from("member_resumes")
    .select("id")
    .eq("id", body.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json(
      { error: "resume_not_found", message: "That resume is no longer available." },
      { status: 404 },
    );
  }

  // Unset first, then set: the partial unique index forbids two defaults even
  // transiently, so the two writes cannot be reordered.
  const { error: clearError } = await db
    .from("member_resumes")
    .update({ is_default: false })
    .eq("user_id", userId)
    .neq("id", body.id);

  if (clearError) {
    console.error("[settings/resumes] default clear error:", clearError);
    return NextResponse.json(
      { error: "save_failed", message: "That change could not be saved. Please try again." },
      { status: 500 },
    );
  }

  const { error: setError } = await db
    .from("member_resumes")
    .update({ is_default: true })
    .eq("id", body.id)
    .eq("user_id", userId);

  if (setError) {
    console.error("[settings/resumes] default set error:", setError);
    return NextResponse.json(
      { error: "save_failed", message: "That change could not be saved. Please try again." },
      { status: 500 },
    );
  }

  return refreshed(await loadResumeList(db, userId));
}

export async function DELETE(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_resume_id", message: "Choose a saved resume." }, { status: 422 });
  }

  const db = createServiceClient();
  const userId = session.userId!;

  const { data: row } = await db
    .from("member_resumes")
    .select("id, url, is_default")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json(
      { error: "resume_not_found", message: "That resume is no longer available." },
      { status: 404 },
    );
  }

  const { error: deleteError } = await db.from("member_resumes").delete().eq("id", id);
  if (deleteError) {
    console.error("[settings/resumes] delete error:", deleteError);
    return NextResponse.json(
      { error: "delete_failed", message: "The resume could not be deleted. Please try again." },
      { status: 500 },
    );
  }

  // The default must survive the delete: when the removed row carried the
  // flag, the oldest remaining resume is promoted so a non-empty list is
  // never left without the preselection the caption and ApplyModal promise.
  // Promotion failures are non-fatal — the row is already gone, so the
  // member still gets the refreshed list instead of a false error.
  if (row.is_default) {
    const { data: nextDefault, error: promoteLookupError } = await db
      .from("member_resumes")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (promoteLookupError) {
      console.error("[settings/resumes] default promote lookup error:", promoteLookupError);
    } else if (nextDefault) {
      const { error: promoteError } = await db
        .from("member_resumes")
        .update({ is_default: true })
        .eq("id", nextDefault.id)
        .eq("user_id", userId);

      if (promoteError) {
        console.error("[settings/resumes] default promote error:", promoteError);
      }
    }
  }

  // Reclaim the file now that the row is gone. Checked against every media
  // column, so an object still referenced elsewhere (e.g. a job application
  // that used the same URL) is kept. Non-fatal: the admin orphan audit
  // retries anything that fails here.
  if (row.url) {
    try {
      await deleteR2AssetIfUnreferenced(db, row.url, ALL_MEDIA_LOOKUPS);
    } catch (cleanupError) {
      console.error("[settings/resumes] R2 cleanup error:", cleanupError);
    }
  }

  return refreshed(await loadResumeList(db, userId));
}
