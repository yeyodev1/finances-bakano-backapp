import mongoose, { Document, Schema } from "mongoose";
import { EMAIL_TYPES, EmailType } from "../types/finance.types";

export interface IEmailLog extends Document {
  _id: mongoose.Types.ObjectId;
  type: EmailType;
  to: string[];
  cc: string[];
  subject: string;
  status: "sent" | "failed";
  providerId?: string;
  error?: string;
  relatedModel?: string;
  relatedId?: string;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const emailLogSchema = new Schema<IEmailLog>(
  {
    type: { type: String, enum: EMAIL_TYPES, required: true, index: true },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    subject: { type: String, required: true },
    status: { type: String, enum: ["sent", "failed"], default: "sent", index: true },
    providerId: { type: String },
    error: { type: String },
    relatedModel: { type: String },
    relatedId: { type: String, index: true },
    sentAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, versionKey: false }
);

export const EmailLog = mongoose.model<IEmailLog>("EmailLog", emailLogSchema);
