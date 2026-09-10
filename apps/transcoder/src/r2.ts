/**
 * R2 client for the transcoder (S3-compatible API via @aws-sdk/client-s3).
 *
 * The worker downloads the original, uploads the canonical processed MP4 and
 * the poster to the SAME media-ID derived keys the web app uses — key layout
 * lives in `@uxcommunity/shared` (videoKeys) so both sides can never drift.
 */

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { videoKeys } from "@uxcommunity/shared";
import type { TranscoderEnv } from "./env";

export interface R2Store {
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  copyObject(sourceKey: string, destKey: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
  publicUrl(key: string): string;
  keys: typeof videoKeys;
}

export function createR2Store(env: TranscoderEnv): R2Store {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2AccessKeyId,
      secretAccessKey: env.r2SecretAccessKey,
    },
  });

  return {
    keys: videoKeys,
    publicUrl: (key) => `${env.r2PublicUrl}/${key}`,

    async getObject(key: string): Promise<Buffer> {
      const result = await client.send(new GetObjectCommand({ Bucket: env.r2BucketName, Key: key }));
      if (!result.Body) throw new Error(`empty R2 object: ${key}`);
      return Buffer.from(await result.Body.transformToByteArray());
    },

    async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: env.r2BucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async copyObject(sourceKey: string, destKey: string): Promise<void> {
      await client.send(
        new CopyObjectCommand({
          Bucket: env.r2BucketName,
          CopySource: `${env.r2BucketName}/${sourceKey}`,
          Key: destKey,
        }),
      );
    },

    async objectExists(key: string): Promise<boolean> {
      try {
        await client.send(new HeadObjectCommand({ Bucket: env.r2BucketName, Key: key }));
        return true;
      } catch {
        return false;
      }
    },

    async deleteObject(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: env.r2BucketName, Key: key }));
    },
  };
}