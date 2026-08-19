import mongoose, { Document, Schema } from "mongoose";

export interface INotificationToggles {
  paymentRegistered: boolean;
  /** Comprobantes de transferencia subidos por clientes desde el portal. */
  paymentSubmission: boolean;
  reminderBefore: boolean;
  overdue: boolean;
  deactivation: boolean;
  monthlySummary: boolean;
}

export interface INotificationSetting extends Document {
  _id: mongoose.Types.ObjectId;
  /** Documento único: siempre key = "global". */
  key: string;

  fromEmail: string;
  replyTo: string;
  /** Destinatarios principales configurables desde el dashboard. */
  recipients: string[];
  /** Siempre se añade a todos los envíos. */
  alwaysTo: string[];
  ccEmails: string[];

  toggles: INotificationToggles;

  /** Días antes del cobro para el recordatorio. */
  reminderDaysBefore: number;
  /** Días de gracia tras el vencimiento antes de desactivar el workspace. */
  graceDays: number;
  /** Aviso previo a la desactivación (días antes de cumplirse la gracia). */
  warnBeforeDeactivationDays: number;
  autoDeactivateEnabled: boolean;
  /** Hora local (0-23) a la que corre el job diario. */
  sendHour: number;

  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const togglesSchema = new Schema<INotificationToggles>(
  {
    paymentRegistered: { type: Boolean, default: true },
    paymentSubmission: { type: Boolean, default: true },
    reminderBefore: { type: Boolean, default: true },
    overdue: { type: Boolean, default: true },
    deactivation: { type: Boolean, default: true },
    monthlySummary: { type: Boolean, default: true },
  },
  { _id: false }
);

const notificationSettingSchema = new Schema<INotificationSetting>(
  {
    key: { type: String, default: "global", unique: true, index: true },

    fromEmail: { type: String, default: "Bakano Finanzas <financiero@bakano.ec>" },
    replyTo: { type: String, default: "financiero@bakano.ec" },
    recipients: { type: [String], default: ["financiero@bakano.ec"] },
    alwaysTo: { type: [String], default: ["dreyes@bakano.ec"] },
    ccEmails: { type: [String], default: [] },

    toggles: { type: togglesSchema, default: () => ({}) },

    reminderDaysBefore: { type: Number, default: 3, min: 0, max: 30 },
    graceDays: { type: Number, default: 5, min: 0, max: 90 },
    warnBeforeDeactivationDays: { type: Number, default: 2, min: 0, max: 30 },
    autoDeactivateEnabled: { type: Boolean, default: true },
    sendHour: { type: Number, default: 8, min: 0, max: 23 },

    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, versionKey: false }
);

export const NotificationSetting = mongoose.model<INotificationSetting>(
  "NotificationSetting",
  notificationSettingSchema
);
