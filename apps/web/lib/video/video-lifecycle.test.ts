import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { deleteVideoMedia, evaluateFinalizeState, resolveVideoAttachments, sniffVideoContainer, sweepAbandonedVideoMedia, videoKeys, type VideoMediaRow } from "./video-server.ts";

function row(overrides: Partial<VideoMediaRow> = {}): VideoMediaRow {
  const mediaId = overrides.id ?? "11111111-1111-1111-1111-111111111111";
  return {
    id: mediaId,
    user_id: "user-1",
    community_id: "community-1",
    status: "uploaded",
    strategy: "transcode",
    original_key: videoKeys.original(mediaId),
    processed_key: null,
    poster_key: null,
    original_url: `https://media.example.com/${videoKeys.original(mediaId)}`,
    processed_url: null,
    poster_url: null,
    width: 1920,
    height: 1080,
    fps: 30,
    duration_ms: 10000,
    video_codec: "h264",
    audio_codec: "aac",
    original_size: 7_500_000,
    processed_size: null,
    attempts: 0,
    processing_ms: null,
    error_code: null,
    error_message: null,
    ...overrides,
  };
}

/** Minimal fluent fake for the supabase-js surface these helpers use. */
class FakeDb {
  rows: VideoMediaRow[] = [];
  deletedRows: Array<{ id: string; patch: Record<string, unknown> }> = [];

  constructor(rows: VideoMediaRow[] = []) {
    this.rows = rows;
  }

  from(_table: string) {
    return this;
  }

  select(_columns = "*") {
    return this;
  }

  eq(column: string, value: unknown) {
    if (column === "id" && typeof value === "string") {
      this._scoped = this.rows.filter((r) => r.id === value);
    }
    return this;
  }

  in(column: string, values: unknown[]) {
    if (column === "id") {
      this._scoped = this.rows.filter((r) => (values as string[]).includes(r.id));
    }
    return this;
  }

  lt(_column: string, _value: unknown) {
    return this;
  }

  limit(_n: number) {
    return this;
  }

  contains(_column: string, _value: unknown) {
    return this;
  }

  not(_column: string, _op: string, _value: unknown) {
    return this;
  }

  private _scoped: VideoMediaRow[] | null = null;

  /** Awaiting a query chain resolves like supabase-js: `{ data, error }`. */
  then<TResult1 = { data: VideoMediaRow[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: VideoMediaRow[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this._scoped ?? this.rows, error: null }).then(onfulfilled, onrejected);
  }

  async maybeSingle() {
    return { data: (this._scoped ?? this.rows)[0] ?? null, error: null };
  }

  update(patch: Record<string, unknown>) {
    const target = (this._scoped ?? this.rows)[0];
    if (target) this.deletedRows.push({ id: target.id, patch });
    return {
      eq: async (column: string, value: unknown) => {
        if (column === "id" && typeof value === "string") {
          this.rows = this.rows.map((r) =>
            r.id === value ? ({ ...r, ...patch } as VideoMediaRow) : r,
          );
        }
        return { error: null };
      },
    };
  }
}

// ── Container sniffing ───────────────────────────────────────────────────────

test("sniffVideoContainer identifies MP4, MOV, WebM from bytes (never the MIME type)", () => {
  const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const mov = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sniffVideoContainer(mp4), "mp4");
  assert.equal(sniffVideoContainer(mov), "mov");
  assert.equal(sniffVideoContainer(webm), "webm");
  assert.equal(sniffVideoContainer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), null);
  assert.equal(sniffVideoContainer(new Uint8Array(4)), null);
});

// ── Finalize state evaluation (idempotency + delete-during-processing) ──────

test("duplicate processing request: ready rows short-circuit with the existing canonical URL", () => {
  const ready = row({
    status: "ready",
    processed_key: videoKeys.processed(row().id),
    processed_url: "https://media.example.com/media/videos/processed/x.mp4",
    poster_url: "https://media.example.com/media/videos/posters/x.jpg",
    processed_size: 4_000_000,
  });
  const evaluation = evaluateFinalizeState(ready, { hasAnyPosts: true, stillReferenced: true });
  assert.equal(evaluation.kind, "return-ready");
  if (evaluation.kind === "return-ready") {
    assert.equal(evaluation.attachment.url, "https://media.example.com/media/videos/processed/x.mp4");
    assert.equal(evaluation.attachment.status, "ready");
    // A duplicate request never re-encodes — nothing in the outcome implies work.
  }
});

test("deleted rows always discard (post deleted / cancelled while processing)", () => {
  const evaluation = evaluateFinalizeState(row({ status: "deleted" }), { hasAnyPosts: false, stillReferenced: false });
  assert.equal(evaluation.kind, "discard-deleted");
});

test("post deleted DURING processing: posts exist but none references the media → discard", () => {
  const evaluation = evaluateFinalizeState(row(), { hasAnyPosts: true, stillReferenced: false });
  assert.equal(evaluation.kind, "discard-removed");
});

test("still composing (no posts yet) → proceed even though nothing references the media yet", () => {
  const evaluation = evaluateFinalizeState(row(), { hasAnyPosts: false, stillReferenced: false });
  assert.equal(evaluation.kind, "proceed");
});

test("retry after failure: failed rows proceed", () => {
  const evaluation = evaluateFinalizeState(row({ status: "failed" }), { hasAnyPosts: false, stillReferenced: false });
  assert.equal(evaluation.kind, "proceed");
});

test("crashed mid-encode rows (processing) proceed on retry", () => {
  const evaluation = evaluateFinalizeState(row({ status: "processing" }), { hasAnyPosts: false, stillReferenced: false });
  assert.equal(evaluation.kind, "proceed");
});

// ── Deletion + R2 cleanup ────────────────────────────────────────────────────

test("deleteVideoMedia removes every R2 object and tombstones the row (URLs nulled, keys kept)", async () => {
  const mediaId = row().id;
  const db = new FakeDb([
    row({
      status: "ready",
      processed_key: videoKeys.processed(mediaId),
      poster_key: videoKeys.poster(mediaId),
      processed_url: `https://media.example.com/${videoKeys.processed(mediaId)}`,
      poster_url: `https://media.example.com/${videoKeys.poster(mediaId)}`,
      processed_size: 4_000_000,
    }),
  ]);
  const deletedKeys: string[] = [];
  const ok = await deleteVideoMedia(db as never, mediaId, async (key) => { deletedKeys.push(key); });

  assert.equal(ok, true);
  assert.deepEqual(deletedKeys.sort(), [
    videoKeys.original(mediaId),
    videoKeys.poster(mediaId),
    videoKeys.processed(mediaId),
  ].sort());
  assert.equal(db.deletedRows.length, 1);
  assert.equal(db.deletedRows[0]!.patch.status, "deleted");
  assert.equal(db.deletedRows[0]!.patch.original_url, null);
  assert.equal(db.deletedRows[0]!.patch.processed_url, null);
  assert.equal(db.deletedRows[0]!.patch.poster_url, null);
});

test("deleteVideoMedia is idempotent for unknown media (no-op, no throw)", async () => {
  const db = new FakeDb([]);
  assert.equal(await deleteVideoMedia(db as never, row().id, async () => { throw new Error("must not be called"); }), false);
});

test("a failed R2 delete does not block tombstoning (orphan scan catches leftovers)", async () => {
  const mediaId = row().id;
  const db = new FakeDb([row()]);
  const ok = await deleteVideoMedia(db as never, mediaId, async () => { throw new Error("r2 down"); });
  assert.equal(ok, true);
  assert.equal(db.deletedRows[0]!.patch.status, "deleted");
});

// ── Abandoned-upload sweep ───────────────────────────────────────────────────

test("sweepAbandonedVideoMedia tombstones stale non-ready rows only", async () => {
  const db = new FakeDb([
    row({ id: "11111111-1111-1111-1111-111111111111", status: "uploaded" }),
    row({ id: "22222222-2222-2222-2222-222222222222", status: "processing" }),
  ]);
  // Both rows are stale; the sweep is age-based (cutoff in the query).
  const result = await sweepAbandonedVideoMedia(db as never, { olderThanMs: 1000 });
  assert.equal(result.swept.length, 2);
  assert.equal(db.deletedRows.length, 2);
  assert.ok(db.deletedRows.every((r) => r.patch.status === "deleted"));
});

// ── Attachment resolution (post create/edit) ────────────────────────────────

test("resolveVideoAttachments fills ready URLs/poster from the DB, never the client", async () => {
  const mediaId = row().id;
  const db = new FakeDb([
    row({
      status: "ready",
      processed_key: videoKeys.processed(mediaId),
      processed_url: "https://media.example.com/media/videos/processed/canonical.mp4",
      poster_url: "https://media.example.com/media/videos/posters/canonical.jpg",
      processed_size: 3_000_000,
    }),
  ]);
  const result = await resolveVideoAttachments(
    db as never,
    "user-1",
    "community-1",
    [{ name: "clip.mp4", url: "https://evil.example.com/fake.mp4", type: "video/mp4", size: 999, mediaId }],
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    const attachment = result.attachments[0] as Record<string, unknown>;
    assert.equal(attachment.url, "https://media.example.com/media/videos/processed/canonical.mp4");
    assert.equal(attachment.poster, "https://media.example.com/media/videos/posters/canonical.jpg");
    assert.equal(attachment.size, 3_000_000);
    assert.equal(attachment.status, "ready");
  }
});

test("resolveVideoAttachments keeps processing videos with a placeholder URL", async () => {
  const mediaId = row().id;
  const db = new FakeDb([row({ status: "uploaded" })]);
  const result = await resolveVideoAttachments(
    db as never,
    "user-1",
    "community-1",
    [{ name: "clip.mp4", url: "", type: "video/mp4", size: 0, mediaId, status: "uploaded" }],
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    const attachment = result.attachments[0] as Record<string, unknown>;
    assert.equal(attachment.url, "");
    assert.equal(attachment.status, "uploaded");
  }
});

test("resolveVideoAttachments rejects media that does not belong to the user or community", async () => {
  const mediaId = row().id;
  const db = new FakeDb([row()]);
  const foreign = await resolveVideoAttachments(
    db as never,
    "user-OTHER",
    "community-1",
    [{ name: "clip.mp4", url: "", type: "video/mp4", size: 0, mediaId }],
  );
  assert.deepEqual(foreign, { ok: false, error: "One of your videos is no longer available. Remove it and try again." });
  const wrongCommunity = await resolveVideoAttachments(
    db as never,
    "user-1",
    "community-OTHER",
    [{ name: "clip.mp4", url: "", type: "video/mp4", size: 0, mediaId }],
  );
  assert.equal(wrongCommunity.ok, false);
  const deletedDb = new FakeDb([row({ status: "deleted" })]);
  const deleted = await resolveVideoAttachments(
    deletedDb as never,
    "user-1",
    "community-1",
    [{ name: "clip.mp4", url: "", type: "video/mp4", size: 0, mediaId }],
  );
  assert.equal(deleted.ok, false);
});