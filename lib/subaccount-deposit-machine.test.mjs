import { expect, test } from "bun:test";
import {
  getDepositEffect,
  getDepositSpender,
  startDepositFlow,
  transitionDepositFlow,
} from "./subaccount-deposit-machine.ts";

const addresses = {
  baseAssetContract: "0xdC3f31B61a2128B3D1ECB8b6f6d0DE82eBd6c7Ae",
  manager: "0x1917960763BF3a0DfA10a05f0a112E828C1A934f",
  subaccountCreator: "0x5448B304AD283f24A741B54AE9b3a71C8d7DCDF2",
  token: "0x8b3C43D2b2555ca3fc4Fa1BC34544133B8576110",
};

const wallet = "0x0e7cc357a7f546a07aeb3dbe56a8ab893d4c9c9e";

function preflight(overrides = {}) {
  return {
    allowance: 0n,
    tokenBalance: 1_000_000_000n,
    tokenDecimals: 6,
    whitelistEnabled: false,
    whitelisted: null,
    ...overrides,
  };
}

test("existing account: approve then deposit, spender is the base asset contract", () => {
  let state = startDepositFlow({
    addresses,
    amountUnits: 100_000_000n,
    subaccountId: "42",
    walletAddress: wallet,
  });
  expect(state.status).toBe("preflight");
  expect(state.context.path).toBe("deposit-existing");
  expect(getDepositEffect(state).spender).toBe(addresses.baseAssetContract);

  state = transitionDepositFlow(state, {
    preflight: preflight({ whitelistEnabled: true, whitelisted: true }),
    type: "PREFLIGHT_RESOLVED",
  });
  expect(state.status).toBe("awaiting-approval");
  expect(getDepositEffect(state)).toEqual({
    amountUnits: 100_000_000n,
    kind: "request-approval",
    spender: addresses.baseAssetContract,
    token: addresses.token,
  });

  state = transitionDepositFlow(state, { txHash: "0xaaa", type: "APPROVAL_SUBMITTED" });
  expect(state.status).toBe("approving");
  expect(getDepositEffect(state)).toEqual({ kind: "wait-for-receipt", txHash: "0xaaa" });

  state = transitionDepositFlow(state, { type: "APPROVAL_CONFIRMED" });
  expect(state.status).toBe("awaiting-deposit");

  state = transitionDepositFlow(state, { txHash: "0xbbb", type: "DEPOSIT_SUBMITTED" });
  state = transitionDepositFlow(state, { type: "DEPOSIT_CONFIRMED" });
  expect(state.status).toBe("success");
  expect(state.subaccountId).toBe("42");
  expect(state.txHash).toBe("0xbbb");
});

test("sufficient allowance skips the approval step", () => {
  let state = startDepositFlow({
    addresses,
    amountUnits: 5n,
    subaccountId: "42",
    walletAddress: wallet,
  });
  state = transitionDepositFlow(state, {
    preflight: preflight({ allowance: 10n }),
    type: "PREFLIGHT_RESOLVED",
  });
  expect(state.status).toBe("awaiting-deposit");
});

test("create path: spender is the creator and confirmation must carry the new subaccount id", () => {
  let state = startDepositFlow({
    addresses,
    amountUnits: 100n,
    subaccountId: null,
    walletAddress: wallet,
  });
  expect(state.context.path).toBe("create-and-deposit");
  expect(getDepositSpender(state.context.path, addresses)).toBe(addresses.subaccountCreator);

  state = transitionDepositFlow(state, {
    preflight: preflight({ allowance: 100n }),
    type: "PREFLIGHT_RESOLVED",
  });
  expect(state.status).toBe("awaiting-deposit");
  expect(getDepositEffect(state).path).toBe("create-and-deposit");

  state = transitionDepositFlow(state, { txHash: "0xccc", type: "DEPOSIT_SUBMITTED" });
  state = transitionDepositFlow(state, { subaccountId: "77", type: "DEPOSIT_CONFIRMED" });
  expect(state.status).toBe("success");
  expect(state.subaccountId).toBe("77");
});

test("create path fails when confirmation lacks the created subaccount id", () => {
  let state = startDepositFlow({
    addresses,
    amountUnits: 100n,
    subaccountId: null,
    walletAddress: wallet,
  });
  state = transitionDepositFlow(state, {
    preflight: preflight({ allowance: 100n }),
    type: "PREFLIGHT_RESOLVED",
  });
  state = transitionDepositFlow(state, { txHash: "0xccc", type: "DEPOSIT_SUBMITTED" });
  state = transitionDepositFlow(state, { type: "DEPOSIT_CONFIRMED" });
  expect(state.status).toBe("failed");
  expect(state.step).toBe("deposit");
});

test("whitelist enabled blocks the create path and non-whitelisted accounts", () => {
  let createState = startDepositFlow({
    addresses,
    amountUnits: 100n,
    subaccountId: null,
    walletAddress: wallet,
  });
  createState = transitionDepositFlow(createState, {
    preflight: preflight({ whitelistEnabled: true }),
    type: "PREFLIGHT_RESOLVED",
  });
  expect(createState.status).toBe("blocked");
  expect(createState.reason).toBe("not-whitelisted");

  let existingState = startDepositFlow({
    addresses,
    amountUnits: 100n,
    subaccountId: "42",
    walletAddress: wallet,
  });
  existingState = transitionDepositFlow(existingState, {
    preflight: preflight({ whitelistEnabled: true, whitelisted: false }),
    type: "PREFLIGHT_RESOLVED",
  });
  expect(existingState.status).toBe("blocked");
  expect(existingState.reason).toBe("not-whitelisted");
});

test("blocks zero amounts and insufficient balance", () => {
  const zeroState = startDepositFlow({
    addresses,
    amountUnits: 0n,
    subaccountId: "42",
    walletAddress: wallet,
  });
  expect(zeroState.status).toBe("blocked");
  expect(zeroState.reason).toBe("zero-amount");

  let poorState = startDepositFlow({
    addresses,
    amountUnits: 100n,
    subaccountId: "42",
    walletAddress: wallet,
  });
  poorState = transitionDepositFlow(poorState, {
    preflight: preflight({ tokenBalance: 99n }),
    type: "PREFLIGHT_RESOLVED",
  });
  expect(poorState.status).toBe("blocked");
  expect(poorState.reason).toBe("insufficient-balance");
});

test("errors record the failing step and retry resumes from it", () => {
  let state = startDepositFlow({
    addresses,
    amountUnits: 100n,
    subaccountId: "42",
    walletAddress: wallet,
  });
  state = transitionDepositFlow(state, { preflight: preflight(), type: "PREFLIGHT_RESOLVED" });
  expect(state.status).toBe("awaiting-approval");

  state = transitionDepositFlow(state, { error: "user rejected", type: "ERRORED" });
  expect(state.status).toBe("failed");
  expect(state.step).toBe("approval");

  state = transitionDepositFlow(state, { type: "RETRY" });
  expect(state.status).toBe("awaiting-approval");

  state = transitionDepositFlow(state, { txHash: "0xaaa", type: "APPROVAL_SUBMITTED" });
  state = transitionDepositFlow(state, { type: "APPROVAL_CONFIRMED" });
  state = transitionDepositFlow(state, { error: "tx reverted", type: "ERRORED" });
  expect(state.step).toBe("deposit");

  state = transitionDepositFlow(state, { type: "RETRY" });
  expect(state.status).toBe("awaiting-deposit");
});

test("retry after a preflight failure re-runs preflight with cleared reads", () => {
  let state = startDepositFlow({
    addresses,
    amountUnits: 100n,
    subaccountId: "42",
    walletAddress: wallet,
  });
  state = transitionDepositFlow(state, { error: "rpc timeout", type: "ERRORED" });
  expect(state.status).toBe("failed");
  expect(state.step).toBe("preflight");

  state = transitionDepositFlow(state, { type: "RETRY" });
  expect(state.status).toBe("preflight");
  expect(state.context.preflight).toBe(null);
});

test("irrelevant events do not change state", () => {
  const state = startDepositFlow({
    addresses,
    amountUnits: 100n,
    subaccountId: "42",
    walletAddress: wallet,
  });
  expect(transitionDepositFlow(state, { type: "APPROVAL_CONFIRMED" })).toBe(state);
  expect(transitionDepositFlow(state, { txHash: "0xaaa", type: "DEPOSIT_SUBMITTED" })).toBe(state);
});
