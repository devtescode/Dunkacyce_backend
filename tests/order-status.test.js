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

function loadController(previousStatus, writeError = null, existingOverrides = {}) {
  const call = { update: null, emits: [] };
  const existing = { _id: ORDER_ID, status: previousStatus, ...existingOverrides };
  const updated = {
    _id: ORDER_ID,
    status: previousStatus,
    userId: "665f1a2b3c4d5e6f708192a4",
  };
  const fakeOrder = {
    findById: () => ({
      lean: async () => ({ ...existing }),
    }),
    findByIdAndUpdate: async (...args) => {
      call.update = args;
      if (writeError) throw writeError;
      const $set = args[1]?.[0]?.$set || {};
      // Mirror literal $set values so the socket payload sees the evidence
      // fields the same way a real persisted document would.
      const echoed = {};
      for (const [key, value] of Object.entries($set)) {
        if (value && typeof value === "object" && "$ifNull" in value) continue;
        echoed[key] = value;
      }
      return {
        ...updated,
        ...echoed,
        status: $set.status ?? previousStatus,
        paymentStatus: "Paid",
        updatedAt: new Date(),
      };
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

  const io = {
    to: () => ({
      emit: (event, payload) => call.emits.push({ event, payload }),
    }),
  };

  return {
    controller,
    call,
    request(status, adminId) {
      return {
        params: { id: ORDER_ID },
        body: { status },
        admin: adminId === undefined ? undefined : { id: adminId },
        app: { get: (key) => (key === "io" ? io : undefined) },
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

const EVIDENCE_FIELDS = [
  "etaDeadlineAt",
  "deliveredBeforeDeadline",
  "lateByMs",
  "etaMinutesUsed",
  "readyAtUsed",
  "deliveredBy",
];

test("updateOrderStatus records delivery evidence in the Delivered pipeline", async () => {
  const readyAt = new Date("2026-01-01T10:00:00.000Z");
  const { controller, call, request } = loadController("Ready", null, {
    readyAt,
    etaMinutes: 5,
  });
  const res = makeRes();

  await controller.updateOrderStatus(request("Delivered", "665f1a2b3c4d5e6f708192a5"), res);

  assert.equal(res.statusCode, 200);
  const stage = call.update[1][0];
  const $set = stage.$set;
  assert.equal($set.status, "Delivered");
  assert.ok($set.etaDeadlineAt instanceof Date);
  assert.equal($set.etaDeadlineAt.getTime(), readyAt.getTime() + 5 * 60000);
  assert.equal(typeof $set.deliveredBeforeDeadline, "boolean");
  assert.equal(typeof $set.lateByMs, "number");
  assert.ok($set.lateByMs >= 0);
  assert.equal($set.etaMinutesUsed, 5);
  assert.ok($set.readyAtUsed instanceof Date);
  assert.equal($set.readyAtUsed.getTime(), readyAt.getTime());
  assert.equal($set.deliveredBy, "665f1a2b3c4d5e6f708192a5");
  // All evidence must be written by the same $set stage.
  assert.deepEqual(Object.keys(stage), ["$set"]);
  for (const field of EVIDENCE_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call($set, field), `must set ${field}`);
  }
});

test("updateOrderStatus does not invent a deadline without readyAt", async () => {
  const { controller, call, request } = loadController("Preparing");
  const res = makeRes();

  await controller.updateOrderStatus(request("Delivered"), res);

  assert.equal(res.statusCode, 200);
  const $set = call.update[1][0].$set;
  assert.equal($set.etaDeadlineAt, null);
  assert.equal($set.deliveredBeforeDeadline, null);
  assert.equal($set.lateByMs, 0);
  assert.equal($set.etaMinutesUsed, null);
  assert.equal($set.readyAtUsed, null);
  assert.equal($set.deliveredBy, null);
});

test("updateOrderStatus unsets all delivery evidence on reversal", async () => {
  const { controller, call, request } = loadController("Delivered");
  const res = makeRes();

  await controller.updateOrderStatus(request("Pending"), res);

  assert.equal(res.statusCode, 200);
  const pipeline = call.update[1];
  const unsetFields = pipeline
    .filter((stage) => Object.prototype.hasOwnProperty.call(stage, "$unset"))
    .map((stage) => stage.$unset);
  for (const field of ["deliveredAt", ...EVIDENCE_FIELDS]) {
    assert.ok(unsetFields.includes(field), `must unset ${field}`);
  }
  assert.ok(pipeline.every((stage) => Object.keys(stage).length === 1));
  assert.equal(call.update[2].updatePipeline, true);
});

test("updateOrderStatus broadcasts delivery evidence in the socket payload", async () => {
  const readyAt = new Date("2026-01-01T10:00:00.000Z");
  const { controller, call, request } = loadController("Ready", null, {
    readyAt,
    etaMinutes: 3,
  });
  const res = makeRes();

  await controller.updateOrderStatus(request("Delivered", "admin-42"), res);

  assert.equal(res.statusCode, 200);
  assert.ok(call.emits.length > 0, "socket emit must be attempted");
  const delivered = call.emits.filter((entry) => entry.event === "order_delivered");
  assert.equal(delivered.length, 2);
  const payload = delivered[0].payload;
  for (const field of [
    ...EVIDENCE_FIELDS,
    "updatedAt",
    "paymentStatus",
    "readyAt",
    "deliveredAt",
    "etaMinutes",
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(payload, field),
      `socket payload must include ${field}`,
    );
  }
  assert.equal(payload.deliveredBy, "admin-42");
  assert.equal(payload.etaMinutesUsed, 3);
  assert.equal(payload.etaDeadlineAt.getTime(), readyAt.getTime() + 3 * 60000);
  assert.equal(payload.paymentStatus, "Paid");
});
