import mongoose, { Document, Schema } from "mongoose";

/**
 * Categoría de cliente (restaurante, gimnasio, tienda…).
 *
 * Es una colección y no un enum a propósito: el rubro de los clientes cambia
 * con el negocio, y con una lista fija habría que tocar código y desplegar cada
 * vez que entra un tipo nuevo.
 */
export interface IClientCategory extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  /** Clave estable en minúsculas: evita duplicados por tildes o mayúsculas. */
  slug: string;
  color?: string;
  icon?: string;
  description?: string;
  isActive: boolean;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** Normaliza para comparar: sin tildes, sin espacios de sobra, en minúsculas. */
export function toSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const clientCategorySchema = new Schema<IClientCategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    color: { type: String, trim: true },
    icon: { type: String, trim: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, versionKey: false }
);

export const ClientCategory = mongoose.model<IClientCategory>(
  "ClientCategory",
  clientCategorySchema
);
