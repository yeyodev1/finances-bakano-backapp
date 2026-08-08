import mongoose, { Document, Schema } from "mongoose";

export interface IAppSetting extends Document {
  _id: mongoose.Types.ObjectId;
  key: string;
  appName: string;
  logoUrl: string;
  logoPublicId?: string;
  iconUrl: string;
  brandColors: Record<string, string>;
  currency: string;
  timezone: string;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const appSettingSchema = new Schema<IAppSetting>(
  {
    key: { type: String, default: "global", unique: true, index: true },
    appName: { type: String, default: "Bakano Finanzas" },
    logoUrl: { type: String, default: "" },
    logoPublicId: { type: String },
    iconUrl: { type: String, default: "" },
    brandColors: { type: Schema.Types.Mixed, default: {} },
    currency: { type: String, default: "USD" },
    timezone: { type: String, default: "America/Guayaquil" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, versionKey: false }
);

export const AppSetting = mongoose.model<IAppSetting>("AppSetting", appSettingSchema);
