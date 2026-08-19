import { UploadApiResponse } from "cloudinary";
import cloudinary from "../config/cloudinary";
import { CustomError } from "../errors/customError.error";

export interface UploadResult {
  url: string;
  publicId: string;
}

function isConfigured(): boolean {
  const config = cloudinary.config();
  return Boolean(config.cloud_name && config.api_key && config.api_secret);
}

function ensureConfigured() {
  if (!isConfigured()) {
    throw new CustomError("Cloudinary no está configurado en el servidor", 500);
  }
}

function uploadBuffer(buffer: Buffer, folder: string, publicId?: string): Promise<UploadResult> {
  ensureConfigured();

  return new Promise<UploadResult>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        overwrite: true,
        // "auto" para que los PDF de comprobantes no fallen: con "image" fijo
        // Cloudinary rechaza cualquier documento.
        resource_type: "auto",
      },
      (error, result?: UploadApiResponse) => {
        if (error || !result) {
          reject(new CustomError("No se pudo subir el archivo a Cloudinary", 502, error));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );

    stream.end(buffer);
  });
}

async function uploadFromUrl(url: string, folder: string, publicId?: string): Promise<UploadResult> {
  ensureConfigured();

  try {
    const result = await cloudinary.uploader.upload(url, {
      folder,
      public_id: publicId,
      overwrite: true,
      resource_type: "image",
    });
    return { url: result.secure_url, publicId: result.public_id };
  } catch (error) {
    throw new CustomError("No se pudo subir la imagen desde la URL indicada", 502, error);
  }
}

async function destroy(publicId: string): Promise<boolean> {
  if (!publicId || !isConfigured()) return false;

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result?.result === "ok";
  } catch {
    return false;
  }
}

export const cloudinaryService = {
  isConfigured,
  uploadBuffer,
  uploadFromUrl,
  destroy,
};
