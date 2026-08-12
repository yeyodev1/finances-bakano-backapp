import { Types } from "mongoose";
import { Client, ClientCategory, IClientCategory } from "../models";
import { toSlug } from "../models/clientCategory.model";
import { CustomError } from "../errors/customError.error";
import { JwtPayload } from "../types/AuthRequest";

export interface CategoryInput {
  name: string;
  color?: string;
  icon?: string;
  description?: string;
  isActive?: boolean;
}

/** Listado con cuántos clientes tiene cada categoría. */
async function list(includeInactive = false) {
  const filter = includeInactive ? {} : { isActive: true };
  const categories = await ClientCategory.find(filter).sort({ name: 1 }).lean();

  const counts = await Client.aggregate<{ _id: Types.ObjectId | null; n: number }>([
    { $match: { isArchived: { $ne: true }, categoryId: { $ne: null } } },
    { $group: { _id: "$categoryId", n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));

  return categories.map((c) => ({ ...c, clientCount: byId.get(String(c._id)) ?? 0 }));
}

async function create(input: CategoryInput, user?: JwtPayload): Promise<IClientCategory> {
  const name = String(input.name || "").trim();
  if (name.length < 2) throw new CustomError("El nombre de la categoría es muy corto.", 400);

  const slug = toSlug(name);
  if (!slug) throw new CustomError("El nombre de la categoría no es válido.", 400);

  const exists = await ClientCategory.findOne({ slug });
  if (exists) throw new CustomError(`Ya existe la categoría "${exists.name}".`, 409);

  return ClientCategory.create({
    name,
    slug,
    color: input.color?.trim(),
    icon: input.icon?.trim(),
    description: input.description?.trim(),
    isActive: input.isActive ?? true,
    createdBy: user?._id ? new Types.ObjectId(user._id) : undefined,
  });
}

async function update(id: string, input: Partial<CategoryInput>) {
  const category = await ClientCategory.findById(id);
  if (!category) throw new CustomError("Categoría no encontrada", 404);

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (name.length < 2) throw new CustomError("El nombre de la categoría es muy corto.", 400);
    const slug = toSlug(name);
    const clash = await ClientCategory.findOne({ slug, _id: { $ne: category._id } });
    if (clash) throw new CustomError(`Ya existe la categoría "${clash.name}".`, 409);
    category.name = name;
    category.slug = slug;
  }

  if (input.color !== undefined) category.color = input.color?.trim();
  if (input.icon !== undefined) category.icon = input.icon?.trim();
  if (input.description !== undefined) category.description = input.description?.trim();
  if (input.isActive !== undefined) category.isActive = input.isActive;

  await category.save();
  return category;
}

/**
 * Borrar una categoría en uso dejaría clientes apuntando a algo inexistente.
 * Se exige desvincularlos antes, y el mensaje dice cuántos son.
 */
async function remove(id: string) {
  const category = await ClientCategory.findById(id);
  if (!category) throw new CustomError("Categoría no encontrada", 404);

  const inUse = await Client.countDocuments({ categoryId: category._id });
  if (inUse > 0) {
    throw new CustomError(
      `No puedes borrarla: ${inUse} cliente(s) la tienen asignada. Cámbiales la categoría primero, o desactívala para que deje de ofrecerse sin perder el historial.`,
      409
    );
  }

  await category.deleteOne();
  return { message: "Categoría eliminada" };
}

export const clientCategoryService = { list, create, update, remove };
