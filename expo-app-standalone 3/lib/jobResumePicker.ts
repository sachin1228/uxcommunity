import * as DocumentPicker from 'expo-document-picker';
import {
  RESUME_EXTENSIONS,
  RESUME_MAX_BYTES,
  type ResumeUpload,
} from './jobs';

/**
 * Picks one resume file, with the two client-side checks every resume surface
 * shares (size cap, extension allow-list). The server re-validates the real
 * bytes, so this only saves the common mistakes a round trip.
 *
 * Returns null when the picker was dismissed; throws with a message the screen
 * can show when the file cannot be attached.
 */
export async function pickResumeFile(): Promise<ResumeUpload | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // The Android picker's MIME filtering is unreliable for the Word types;
    // the extension check below is the allow-list, and the API checks magic
    // bytes regardless of what the picker declared.
    type: '*/*',
    multiple: false,
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const name = asset.name || 'resume';
  const lower = name.toLowerCase();

  if (!RESUME_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    throw new Error('Attach a PDF, DOC, DOCX or RTF resume.');
  }
  if (asset.size != null && asset.size > RESUME_MAX_BYTES) {
    throw new Error('Resume exceeds the 5 MB limit.');
  }

  return {
    uri: asset.uri,
    name,
    mimeType: asset.mimeType ?? mimeFromName(lower),
    size: asset.size ?? null,
  };
}

function mimeFromName(name: string): string {
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (name.endsWith('.doc')) return 'application/msword';
  if (name.endsWith('.rtf')) return 'application/rtf';
  return 'application/octet-stream';
}
