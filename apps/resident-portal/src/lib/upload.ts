import { uploadFile } from 'zitejs/upload';

export type UploadedFile = { url: string; name: string; size: number; type: string };

const MAX_BYTES = 20 * 1024 * 1024;

/** Upload a photo or document someone picked, and describe it the way records store files. */
export async function uploadPortalFile(file: File): Promise<UploadedFile> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 20 MB`);
  const { fileUrl } = await uploadFile({ data: file, filename: file.name });
  if (!fileUrl) throw new Error('The upload service did not return a link');
  return { url: fileUrl, name: file.name, size: file.size, type: file.type || '' };
}
