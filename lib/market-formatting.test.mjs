import { expect, test } from "bun:test";
import { groupTypedDigits } from "./market-formatting.ts";

test("a typed figure is grouped in its whole part, its fraction left as typed", () => {
  expect(groupTypedDigits("1384")).toBe("1,384");
  expect(groupTypedDigits("1234567.50")).toBe("1,234,567.50");
  expect(groupTypedDigits("12.")).toBe("12.");
  expect(groupTypedDigits("1,384")).toBe("1,384");
  expect(groupTypedDigits("")).toBe("");
});
