const test = require("node:test");
const assert = require("node:assert/strict");

const ORDER_MODEL_PATH = require.resolve("../Models/models/order.model");
const CONTROLLER_PATH = require.resolve("../Controllers/order.controllers");
const ORDER_ID = "665f1a2b3c4d5e6f708192a3";

function makeRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function loadController(previousStatus, writeError = null) {
  const call = { update: null };
  const updated = {
    _id: ORDER_ID,
    status: previousStatus,
    userId: "665f1a2b3c4d5e6f708192a4",
  };
  const fakeOrder = {
    findById: () => ({
      lean: async () => ({ _id: ORDER_ID, status: previousStatus }),
    }),
    findByIdAndUpdate: async (...args) => {
      call.update = args;
      if (writeError) throw writeError;
      return { ...updated, status: args[1]?.[0]?.$set?.status ?? previousStatus };
    },
  };

  require.cache[ORDER_MODEL_PATH] = {
    id: ORDER_MODEL_PATH,
    filename: ORDER_MODEL_PATH,
    loaded: true,
    exports: fakeOrder,
  };
  delete require.cache[CONTROLLER_PATH];
  const controller = require(CONTROLLER_PATH);

  return {
    controller,
    call,
    request(status) {
      return {
        params: { id: ORDER_ID },
        body: { status },
        app: { get: () => undefined },
      };
    },
  };
}

test("updateOrderStatus enables updatePipeline for aggregation-style updates", async () => {
  const { controller, call, request } = loadController("Preparing");
  const res = makeRes();

  await controller.updateOrderStatus(request("Ready"), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(call.update, "order update must be attempted");
  assert.equal(call.update[0], ORDER_ID);
  assert.ok(Array.isArray(call.update[1]), "must pass an aggregation pipeline");
  assert.equal(call.update[2].updatePipeline, true);
  assert.equal(call.update[2].new, true);
  assert.equal(call.update[1][0].$set.status, "Ready");
  assert.equal(call.update[1][0].$set.readyAt.$ifNull[0], "$readyAt");
  assert.ok(call.update[1][0].$set.readyAt.$ifNull[1] instanceof Date);
  assert.deepEqual(Object.keys(call.update[1][0]), ["$set"]);
});

test("updateOrderStatus sets deliveredAt and clears stale evidence on reversal", async () => {
  const delivered = loadController("Ready");
  const deliveredRes = makeRes();
  await delivered.controller.updateOrderStatus(delivered.request("Delivered"), deliveredRes);
  assert.equal(deliveredRes.statusCode, 200);
  assert.deepEqual(delivered.call.update[1][0].$set.deliveredAt, {
    $ifNull: ["$deliveredAt", delivered.call.update[1][0].$set.deliveredAt.$ifNull[1]],
  });

  const reversal = loadController("Delivered");
  const reversalRes = makeRes();
  await reversal.controller.updateOrderStatus(reversal.request("Pending"), reversalRes);
  assert.equal(reversalRes.statusCode, 200);
  const pipeline = reversal.call.update[1];
  assert.equal(pipeline[0].$set.status, "Pending");
  assert.ok(pipeline.some((stage) => stage.$unset === "deliveredAt"));
  assert.ok(pipeline.some((stage) => stage.$unset === "readyAt"));
  assert.ok(pipeline.every((stage) => Object.keys(stage).length === 1));
  assert.equal(reversal.call.update[2].updatePipeline, true);

  const reopen = loadController("Delivered");
  const reopenRes = makeRes();
  await reopen.controller.updateOrderStatus(reopen.request("Ready"), reopenRes);
  assert.equal(reopenRes.statusCode, 200);
  const reopenPipeline = reopen.call.update[1];
  assert.ok(reopenPipeline[0].$set.readyAt instanceof Date);
  assert.ok(!reopenPipeline.some((stage) => stage.$unset === "readyAt"));
  assert.ok(reopenPipeline.some((stage) => stage.$unset === "deliveredAt"));
});

test("updateOrderStatus converts write failures into a safe 500", async () => {
  const { controller, request } = loadController("Pending", new Error("Mongoose write failed"));
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const res = makeRes();
    await controller.updateOrderStatus(request("Ready"), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "We couldn't update the order status right now. Please try again.");
    assert.ok(!JSON.stringify(res.body).includes("Mongoose"));
  } finally {
    console.error = originalConsoleError;
  }
});
