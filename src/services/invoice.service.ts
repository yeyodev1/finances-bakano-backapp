import { invoiceDeferralService } from "./invoice.deferral.service";
import { invoiceGenerationService } from "./invoice.generation.service";
import { invoiceQueryService } from "./invoice.query.service";

export type { GenerateOptions, BackfillOptions } from "./invoice.generation.service";
export type { InvoiceListQuery } from "./invoice.query.service";
export type { DeferInvoiceInput, CreateAdvanceInvoiceInput } from "./invoice.deferral.service";

export const invoiceService = {
  ...invoiceQueryService,
  ...invoiceGenerationService,
  ...invoiceDeferralService,
};

export { invoiceGenerationService, invoiceQueryService, invoiceDeferralService };
