import { z } from "zod";

/**
 * The brief says CUST-XXXXX but does not define whether X means a digit or any
 * character. We accept exactly five uppercase ASCII letters or digits and
 * document that assumption in the README.
 */
export const customerIdSchema = z
  .string()
  .regex(
    /^CUST-[A-Z0-9]{5}$/,
    "customer_id must match CUST-XXXXX using five uppercase letters or digits",
  );

export const getCustomerRecordInputSchema = z
  .object({
    customer_id: customerIdSchema,
  })
  .strict();

export const triggerRefundInputSchema = z
  .object({
    customer_id: customerIdSchema,
    amount: z
      .number()
      .finite("amount must be finite")
      .positive("amount must be greater than zero"),
    reason: z
      .string()
      .trim()
      .min(10, "reason must contain at least 10 non-whitespace characters"),
  })
  .strict();

export type GetCustomerRecordInput = z.infer<
  typeof getCustomerRecordInputSchema
>;

export type TriggerRefundInput = z.infer<typeof triggerRefundInputSchema>;
