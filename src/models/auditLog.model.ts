import mongoose, { Document, Schema } from "mongoose";

export interface IAuditLog extends Document {
  _id: mongoose.Types.ObjectId;
  action: string;
  entity: string;
  entityId?: string;
  userId?: mongoose.Types.ObjectId;
  userName?: string;
  meta?: Record<string, unknown>;
  level: "info" | "warn" | "error";
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    userName: { type: String },
    meta: { type: Schema.Types.Mixed },
    level: { type: String, enum: ["info", "warn", "error"], default: "info" },
  },
  { timestamps: true, versionKey: false }
);

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
