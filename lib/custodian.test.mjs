import { expect, test } from "bun:test";
import { getAddress, hashDomain, hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildCustodianExit,
  buildCustodianTake,
  buildCustodianWithdraw,
  buildSetTradingKey,
  buildUsdcPermitDeposit,
  interpretCustodianResponse,
  loadTradingKey,
  newTradingKey,
  saveTradingKey,
  splitSignature,
} from "./custodian.ts";

const CNGN_BOOK = "0x5a35f149005Ce74b874F7Cf07CC2618BFA4F8Bd4";
const CASH = "0xA74E49b4Ed7cb176bc02ef4D8a1A3240C9aD4272";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NOW = 1_795_100_000;
const wallet = privateKeyToAccount(`0x${"11".repeat(32)}`);

function oneContract() {
  return buildCustodianTake({
    accountId: "70",
    amountScale: 10n ** 15n,
    book: CNGN_BOOK,
    contractSize: 1_000_000n,
    isBuy: true,
    limitPrice: "0.0007",
    marketId: 1,
    nowSeconds: NOW,
    reduceOnly: false,
    takerFeeBps: 15,
    units: 1000,
  });
}

// `cast call 0xD8EB…dfd6 "domainSeparator()"` and `takeDigest((70,<cNGN book>,1,true,1e18,7e14,1e18,1.4e18,
// 1795100090,255,false,7))` on Base, 2026-11-19: what the deployed custodian itself computes.
const DEPLOYED_DOMAIN_SEPARATOR =
  "0xa443af81af32cdd3bc53a97745c926803f51f206d587c0fec6717774c5acdb9f";
const DEPLOYED_TAKE_DIGEST = "0x64d38bb4013ccfd9e02507aa9033305e7387c38641f858c1a8aa66703ba7283a";

test("the take the app signs hashes to the digest the deployed custodian checks", () => {
  const take = oneContract();
  expect(
    hashDomain({
      domain: take.typedData.domain,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    })
  ).toBe(DEPLOYED_DOMAIN_SEPARATOR);
  const typedData = { ...take.typedData, message: { ...take.message, nonce: 7n } };
  expect(hashTypedData(typedData)).toBe(DEPLOYED_TAKE_DIGEST);
});

test("a take is all or nothing at the limit, its fee bounded at fee + 5 bps of the limit notional", () => {
  const { message } = oneContract();
  expect(message.amount).toBe(10n ** 18n);
  expect(message.minFill).toBe(message.amount);
  expect(message.maxFee).toBe(1_400_000_000_000_000_000n);
  expect(message.deadline).toBe(BigInt(NOW + 90));
  expect(() => buildCustodianTake({ ...oneContractArgs(), units: 0 })).toThrow();
  expect(() => buildCustodianTake({ ...oneContractArgs(), accountId: "0" })).toThrow();
  expect(() => buildCustodianTake({ ...oneContractArgs(), limitPrice: "0" })).toThrow();
});

function oneContractArgs() {
  return {
    accountId: "70",
    amountScale: 10n ** 15n,
    book: CNGN_BOOK,
    contractSize: 1_000_000n,
    isBuy: true,
    limitPrice: "0.0007",
    marketId: 1,
    nowSeconds: NOW,
    reduceOnly: false,
    takerFeeBps: 15,
    units: 1000,
  };
}

test("the relayed body is the venue's shape, and the signature recovers to the signer", async () => {
  const take = oneContract();
  const key = privateKeyToAccount(newTradingKey().privateKey);
  const signature = await key.signTypedData(take.typedData);
  expect(await recoverTypedDataAddress({ ...take.typedData, signature })).toBe(key.address);
  const body = take.body(signature);
  expect(body.call).toBe("take");
  expect(body.take.account_id).toBe("70");
  expect(body.take.max_levels).toBe(255);
  expect(body.take.reduce_only).toBe(false);
  expect(body.take.book).toBe(getAddress(CNGN_BOOK));
});

test("wallet actions: withdraw, exit and the key change carry the account and a short deadline", async () => {
  const w = buildCustodianWithdraw({
    accountId: "70",
    amount: 5_000_000n,
    asset: CASH,
    nowSeconds: NOW,
  });
  expect(w.typedData.primaryType).toBe("Withdraw");
  expect(w.body("0x").call).toBe("withdraw_for");
  expect(w.typedData.message.deadline).toBe(BigInt(NOW + 600));
  const e = buildCustodianExit({ accountId: "70", nowSeconds: NOW });
  expect(e.body("0x").call).toBe("exit_for");
  const k = buildSetTradingKey({ key: wallet.address, nowSeconds: NOW, wallet: wallet.address });
  expect(k.message.validUntil).toBe(BigInt(NOW + 7 * 86_400));
  const sig = await wallet.signTypedData(k.typedData);
  expect(await recoverTypedDataAddress({ ...k.typedData, signature: sig })).toBe(wallet.address);
  expect(() => buildCustodianWithdraw({ accountId: "70", amount: 0n, asset: CASH })).toThrow();
});

test("a USDC permit deposit splits the signature into v, r, s for depositWithPermit", async () => {
  const d = buildUsdcPermitDeposit({
    accountId: "70",
    amount: 100_000_000n,
    cashAsset: CASH,
    nowSeconds: NOW,
    permitNonce: 3n,
    usdc: USDC,
    wallet: wallet.address,
  });
  expect(d.typedData.domain.name).toBe("USD Coin");
  expect(d.typedData.message.spender).toBe(
    getAddress("0xD8EBF2216Fd4ECA79272E76ad22131592EA0dfd6")
  );
  const signature = await wallet.signTypedData(d.typedData);
  const body = d.body(signature);
  expect(body.call).toBe("deposit_with_permit");
  expect([27, 28]).toContain(body.v);
  expect(body.r).toBe(splitSignature(signature).r);
});

test("a trading key is kept per wallet and dropped when it lapses or does not match", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const key = newTradingKey();
  saveTradingKey(wallet.address, { ...key, validUntil: NOW + 3600 }, storage);
  expect(loadTradingKey(wallet.address, storage, NOW)?.address).toBe(key.address);
  expect(loadTradingKey(wallet.address, storage, NOW + 3600 - 30)).toBeNull();
  saveTradingKey(
    wallet.address,
    { ...key, address: wallet.address, validUntil: NOW + 3600 },
    storage
  );
  expect(loadTradingKey(wallet.address, storage, NOW)).toBeNull();
});

test("the venue's answers read as the trader needs them", () => {
  const tx = `0x${"ab".repeat(32)}`;
  expect(
    interpretCustodianResponse(200, {
      account_id: "77",
      block_number: "1",
      receipt_status: "success",
      tx_hash: tx,
    })
  ).toEqual({ accountId: "77", blockNumber: 1n, kind: "done", txHash: tx });
  expect(interpretCustodianResponse(422, { revert: "BC_BadSignature" }).reason).toContain(
    "trading key"
  );
  expect(interpretCustodianResponse(409, { error: "cash_floor: ..." }).kind).toBe("rejected");
  expect(interpretCustodianResponse(502, {}).kind).toBe("unknown");
});
