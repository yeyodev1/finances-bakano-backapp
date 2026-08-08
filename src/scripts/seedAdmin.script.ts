import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { env } from "../config/env";
import { User } from "../models";

async function run() {
  await dbConnect();

  const email = env.seedAdmin.email.toLowerCase().trim();
  const existing = await User.findOne({ email });

  if (existing) {
    existing.role = "superadmin";
    existing.isActive = true;
    existing.receivesNotifications = true;
    if (!existing.name) existing.name = env.seedAdmin.name;
    await existing.save();
    console.log(`[seedAdmin] Superadmin existente actualizado: ${email}`);
  } else {
    await User.create({
      name: env.seedAdmin.name,
      email,
      password: env.seedAdmin.password,
      role: "superadmin",
      isActive: true,
      receivesNotifications: true,
    });
    console.log(`[seedAdmin] Superadmin creado: ${email}`);
  }

  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[seedAdmin] Error:", error);
  await mongoose.connection.close().catch(() => undefined);
  process.exit(1);
});
