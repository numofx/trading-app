import { expect, test } from "bun:test";
import { readAtOrAfterBlock } from "./read-at-block.ts";

/** Records every call so each test can say exactly what reached the RPC. */
function fakeChain(heads) {
  const calls = { blockNumbers: 0, reads: [], sleeps: 0 };
  let index = 0;

  return {
    calls,
    getBlockNumber: () => {
      calls.blockNumbers += 1;
      const head = heads[Math.min(index, heads.length - 1)];
      index += 1;
      return Promise.resolve(head);
    },
    sleep: () => {
      calls.sleeps += 1;
      return Promise.resolve();
    },
  };
}

test("without a minimum block it is one plain read of latest", async () => {
  const chain = fakeChain([100n]);

  const result = await readAtOrAfterBlock({
    getBlockNumber: chain.getBlockNumber,
    minBlock: null,
    read: (blockNumber) => {
      chain.calls.reads.push(blockNumber);
      return Promise.resolve("balance");
    },
    sleep: chain.sleep,
  });

  expect(result).toBe("balance");
  expect(chain.calls).toEqual({ blockNumbers: 0, reads: [undefined], sleeps: 0 });
});

test("a head already past the receipt reads pinned to that head", async () => {
  const chain = fakeChain([51_263_590n]);

  await readAtOrAfterBlock({
    getBlockNumber: chain.getBlockNumber,
    minBlock: 51_263_588n,
    read: async (blockNumber) => chain.calls.reads.push(blockNumber),
    sleep: chain.sleep,
  });

  expect(chain.calls.reads).toEqual([51_263_590n]);
  expect(chain.calls.sleeps).toBe(0);
});

/** The #19 case: the node answering is a block behind the deposit's receipt. */
test("a lagging head is waited out rather than read", async () => {
  const chain = fakeChain([99n, 99n, 100n]);

  await readAtOrAfterBlock({
    getBlockNumber: chain.getBlockNumber,
    minBlock: 100n,
    read: async (blockNumber) => chain.calls.reads.push(blockNumber),
    sleep: chain.sleep,
  });

  expect(chain.calls.reads).toEqual([100n]);
  expect(chain.calls.sleeps).toBe(2);
});

/** Load-balanced: the block-number call and the read can hit different nodes. */
test("a read rejected by a node without the pinned block is retried", async () => {
  const chain = fakeChain([100n, 101n]);
  let failures = 1;

  const result = await readAtOrAfterBlock({
    getBlockNumber: chain.getBlockNumber,
    minBlock: 100n,
    read: (blockNumber) => {
      chain.calls.reads.push(blockNumber);
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(new Error("header not found"));
      }
      return Promise.resolve("fresh");
    },
    sleep: chain.sleep,
  });

  expect(result).toBe("fresh");
  expect(chain.calls.reads).toEqual([100n, 101n]);
});

/** A head that never arrives must surface, not hang or quietly return the stale figure. */
test("it gives up after the attempts and never reads behind the receipt", async () => {
  const chain = fakeChain([99n]);

  await expect(
    readAtOrAfterBlock({
      attempts: 3,
      getBlockNumber: chain.getBlockNumber,
      minBlock: 100n,
      read: async (blockNumber) => chain.calls.reads.push(blockNumber),
      sleep: chain.sleep,
    })
  ).rejects.toThrow("RPC head 99 is behind block 100");

  expect(chain.calls.reads).toEqual([]);
  expect(chain.calls.blockNumbers).toBe(3);
  expect(chain.calls.sleeps).toBe(2);
});
