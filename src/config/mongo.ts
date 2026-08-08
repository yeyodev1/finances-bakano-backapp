import mongoose from "mongoose";

/**
 * En serverless (Vercel) cada invocación reutiliza el proceso, así que la
 * conexión se cachea en el ámbito global para no abrir una por request.
 */
const globalForMongo = global as unknown as {
  _mongoConn?: Promise<typeof mongoose> | null;
};

export async function dbConnect() {
  const DB_URI = process.env.DB_URI;

  if (!DB_URI) {
    throw new Error("DB_URI is not defined in environment variables");
  }

  if (mongoose.connection.readyState === 1) return mongoose;
  if (globalForMongo._mongoConn) return globalForMongo._mongoConn;

  globalForMongo._mongoConn = mongoose
    .connect(DB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 10000,
    })
    .then((conn) => {
      console.log("Connected to MongoDB");
      return conn;
    })
    .catch((error) => {
      globalForMongo._mongoConn = null;
      console.error("MongoDB connection error:", error);
      throw error;
    });

  return globalForMongo._mongoConn;
}
