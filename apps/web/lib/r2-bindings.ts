import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteObjectsCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import type { R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";

export interface MediaBindings {
  MEDIA_R2_BUCKET: R2Bucket;
  PRIVATE_R2_BUCKET: R2Bucket;
}

/** Keep the application's S3 command contract while staging uses scoped bindings. */
export function useR2Bindings(client: S3Client, bindings: MediaBindings): S3Client {
  const bucketFor = (name: unknown) => {
    if (name === "uxcommunity-staging-media") return bindings.MEDIA_R2_BUCKET;
    if (name === "uxcommunity-staging-private") return bindings.PRIVATE_R2_BUCKET;
    throw new Error("Unbound storage bucket refused");
  };
  const missing = () => { throw Object.assign(new Error("Object not found"), { $metadata: { httpStatusCode: 404 } }); };
  const execute = async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      const input = command.input;
      await bucketFor(input.Bucket).put(input.Key!, input.Body as Parameters<R2Bucket["put"]>[1], {
        httpMetadata: { contentType: input.ContentType, cacheControl: input.CacheControl },
      });
      return {};
    }
    if (command instanceof CopyObjectCommand) {
      const input = command.input;
      const [sourceBucket, ...parts] = decodeURIComponent(input.CopySource ?? "").replace(/^\//, "").split("/");
      if (sourceBucket !== input.Bucket) throw new Error("Cross-bucket copy refused");
      const bucket = bucketFor(input.Bucket);
      const source = await bucket.get(parts.join("/"));
      if (!source) return missing();
      await bucket.put(input.Key!, source.body, { httpMetadata: { contentType: input.ContentType, cacheControl: input.CacheControl } });
      return {};
    }
    if (command instanceof GetObjectCommand || command instanceof HeadObjectCommand) {
      const input = command.input;
      const bucket = bucketFor(input.Bucket);
      const object = command instanceof HeadObjectCommand ? await bucket.head(input.Key!) : await bucket.get(input.Key!);
      if (!object) return missing();
      return { ContentLength: object.size, ContentType: object.httpMetadata?.contentType, ETag: object.httpEtag,
        ...(command instanceof GetObjectCommand ? { Body: {
          transformToByteArray: async () => new Uint8Array(await (object as R2ObjectBody).arrayBuffer()),
          transformToString: async () => new TextDecoder().decode(await (object as R2ObjectBody).arrayBuffer()),
          transformToWebStream: () => (object as R2ObjectBody).body,
        } } : {}),
      };
    }
    if (command instanceof ListObjectsV2Command) {
      const input = command.input;
      const result = await bucketFor(input.Bucket).list({ prefix: input.Prefix, cursor: input.ContinuationToken, startAfter: input.StartAfter, limit: input.MaxKeys ?? 1000 });
      return { Contents: result.objects.map(o => ({ Key: o.key, Size: o.size, LastModified: o.uploaded, ETag: o.httpEtag })), IsTruncated: result.truncated, NextContinuationToken: result.truncated ? result.cursor : undefined };
    }
    if (command instanceof DeleteObjectCommand) {
      await bucketFor(command.input.Bucket).delete(command.input.Key!); return {};
    }
    if (command instanceof DeleteObjectsCommand) {
      const keys = (command.input.Delete?.Objects ?? []).map(o => o.Key!);
      await bucketFor(command.input.Bucket).delete(keys);
      return { Deleted: keys.map(Key => ({ Key })), Errors: [] };
    }
    throw new Error("Unsupported storage command");
  };
  // Presigning uses the untouched S3 middleware stack; only sending is local to bindings.
  client.send = execute as S3Client["send"];
  return client;
}
