import multer, { FileFilterCallback } from "multer";
import { Request } from "express";

const storage = multer.memoryStorage();

function buildFilter(allowed: RegExp, label: string) {
  return (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (allowed.test(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Tipo de archivo no permitido. Se aceptan: ${label}`));
  };
}

export const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: buildFilter(/^image\//, "imágenes"),
});

export const uploadDocument = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: buildFilter(/^(image\/|application\/pdf$)/, "imágenes y PDF"),
});
