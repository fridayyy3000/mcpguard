import { randomUUID } from "node:crypto";

import type { GetCustomerRecordInput, TriggerRefundInput } from "./schemas.js";

export interface CustomerRecord {
  customer_id: string;
  name: string;
  account_status: "active" | "restricted";
  tier: "standard" | "premium";
}

export interface RefundReceipt {
  refund_id: string;
  customer_id: string;
  amount: number;
  reason: string;
  status: "accepted";
}

const CUSTOMERS = new Map<string, CustomerRecord>([
  [
    "CUST-12345",
    {
      customer_id: "CUST-12345",
      name: "Ada Lovelace",
      account_status: "active",
      tier: "premium",
    },
  ],
  [
    "CUST-A1B2C",
    {
      customer_id: "CUST-A1B2C",
      name: "Grace Hopper",
      account_status: "active",
      tier: "standard",
    },
  ],
]);

export function getCustomerRecord({
  customer_id,
}: GetCustomerRecordInput): CustomerRecord | undefined {
  return CUSTOMERS.get(customer_id);
}

export function triggerRefund({
  customer_id,
  amount,
  reason,
}: TriggerRefundInput): RefundReceipt {
  return {
    refund_id: `REF-${randomUUID()}`,
    customer_id,
    amount,
    reason,
    status: "accepted",
  };
}
