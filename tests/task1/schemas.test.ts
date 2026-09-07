import { describe, expect, it } from "vitest";

import {
  getCustomerRecordInputSchema,
  triggerRefundInputSchema,
} from "../../src/task1/schemas.js";

describe("Task 1 input schemas", () => {
  it.each(["CUST-12345", "CUST-A1B2C", "CUST-ABCDE"])(
    "accepts a documented customer ID: %s",
    (customerId) => {
      expect(
        getCustomerRecordInputSchema.safeParse({ customer_id: customerId })
          .success,
      ).toBe(true);
    },
  );

  it.each([
    "CUST-1234",
    "CUST-123456",
    "cust-12345",
    "CUSTOMER-12345",
    "CUST-12_45",
    " CUST-12345",
    "CUST-12345 ",
  ])("rejects a malformed customer ID: %s", (customerId) => {
    expect(
      getCustomerRecordInputSchema.safeParse({ customer_id: customerId })
        .success,
    ).toBe(false);
  });

  it("rejects missing and unexpected fields", () => {
    expect(getCustomerRecordInputSchema.safeParse({}).success).toBe(false);
    expect(
      getCustomerRecordInputSchema.safeParse({
        customer_id: "CUST-12345",
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it.each([0, -1, -0.01, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects a non-positive or non-finite refund amount: %s",
    (amount) => {
      expect(
        triggerRefundInputSchema.safeParse({
          customer_id: "CUST-12345",
          amount,
          reason: "Duplicate charge",
        }).success,
      ).toBe(false);
    },
  );

  it("rejects numeric strings because coercion is disabled", () => {
    expect(
      triggerRefundInputSchema.safeParse({
        customer_id: "CUST-12345",
        amount: "12.50",
        reason: "Duplicate charge",
      }).success,
    ).toBe(false);
  });

  it.each(["too short", "          ", " 123456789 "])(
    "rejects a reason with fewer than 10 characters after trimming: %j",
    (reason) => {
      expect(
        triggerRefundInputSchema.safeParse({
          customer_id: "CUST-12345",
          amount: 12.5,
          reason,
        }).success,
      ).toBe(false);
    },
  );

  it("accepts valid refund arguments and trims the reason", () => {
    const result = triggerRefundInputSchema.parse({
      customer_id: "CUST-12345",
      amount: 12.5,
      reason: "  Duplicate charge  ",
    });

    expect(result.reason).toBe("Duplicate charge");
  });
});
