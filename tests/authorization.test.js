"use strict";

const { test, beforeEach, afterEach, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

process.env.ADMIN_JWT_SECRET = "test-secret";

// ---------------------------------------------------------------------------
// In-memory Admin model. Injected into require.cache BEFORE loading the code
// under test so no mongoose connection / real database is ever involved.
// ---------------------------------------------------------------------------

const FAKE_HASH_PREFIX = "fake-hash:";
const originalBcryptCompare = bcrypt.compare;
bcrypt.compare = async (plain, hash) =>
  typeof hash === "string" && hash === FAKE_HASH_PREFIX + String(plain);

const originalActivationKey = process.env.SUPER_ADMIN_ACTIVATION_KEY;
const originalBootstrapKey = process.env.ADMIN_BOOTSTRAP_KEY;
const originalJwtSecret = process.env.ADMIN_JWT_SECRET;

let idCounter = 0;
let timeCounter = 0;
const newId = () => (++idCounter).toString(16).padStart(24, "0");
const newDate = () => new Date(Date.UTC(2026, 0, 1) + ++timeCounter * 1000);

class FakeAdminDoc {
  constructor(data) {
    Object.assign(this, data);
  }
  toObject() {
    return { ...this };
  }
  toJSON() {
    const payload = this.toObject();
    delete payload.password;
    return payload;
  }
}

const toPlain = (doc) => {
  if (!doc) return doc;
  if (typeof doc.toObject === "function") return doc.toObject();
  return { ...doc };
};

const matchesValue = (actual, expected) => {
  if (expected instanceof RegExp) return expected.test(String(actual ?? ""));

  if (expected && typeof expected === "object") {
    if ("$regex" in expected) {
      const regex =
        expected.$regex instanceof RegExp
          ? expected.$regex
          : new RegExp(String(expected.$regex), expected.$options || "");
      return regex.test(String(actual ?? ""));
    }
    if ("$ne" in expected) {
      return !(
        actual === expected.$ne || String(actual) === String(expected.$ne)
      );
    }
    if ("$in" in expected) {
      return expected.$in.some(
        (candidate) => String(candidate) === String(actual)
      );
    }
    if ("$exists" in expected) {
      return (actual !== undefined) === expected.$exists;
    }
    if ("$eq" in expected) return matchesValue(actual, expected.$eq);
    if ("$gte" in expected && !(Number(actual) >= Number(expected.$gte))) {
      return false;
    }
    if ("$gt" in expected && !(Number(actual) > Number(expected.$gt))) {
      return false;
    }
    if ("$lte" in expected && !(Number(actual) <= Number(expected.$lte))) {
      return false;
    }
    if ("$lt" in expected && !(Number(actual) < Number(expected.$lt))) {
      return false;
    }
    return true;
  }

  return actual === expected || String(actual) === String(expected);
};

const matchesDoc = (doc, filter = {}) => {
  if (!filter) return true;

  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") {
      return (
        Array.isArray(condition) &&
        condition.some((subFilter) => matchesDoc(doc, subFilter))
      );
    }
    if (key === "$and") {
      return (
        Array.isArray(condition) &&
        condition.every((subFilter) => matchesDoc(doc, subFilter))
      );
    }
    if (key === "$nor") {
      return (
        Array.isArray(condition) &&
        !condition.some((subFilter) => matchesDoc(doc, subFilter))
      );
    }
    return matchesValue(doc[key], condition);
  });
};

const applyUpdate = (doc, update = {}) => {
  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set)) doc[key] = value;
  }
  if (update.$inc) {
    for (const [key, amount] of Object.entries(update.$inc)) {
      doc[key] = (Number(doc[key]) || 0) + Number(amount);
    }
  }
};

// Minimal thenable query supporting find(...).sort().skip().limit().lean()
class FakeQuery {
  constructor(getDocs, { single = false } = {}) {
    this.getDocs = getDocs;
    this._single = single;
    this._sort = null;
    this._skip = 0;
    this._limit = Number.POSITIVE_INFINITY;
    this._lean = false;
  }
  sort(spec) {
    this._sort = spec;
    return this;
  }
  skip(count) {
    this._skip = count;
    return this;
  }
  limit(count) {
    this._limit = count;
    return this;
  }
  lean() {
    this._lean = true;
    return this;
  }
  async _resolve() {
    let docs = (await this.getDocs()).slice();
    if (this._sort && this._sort.createdAt === -1) {
      docs.sort(
        (a, b) =>
          (b.createdAt ? b.createdAt.getTime() : 0) -
          (a.createdAt ? a.createdAt.getTime() : 0)
      );
    }
    docs = docs.slice(this._skip, this._skip + this._limit);
    const mapped = docs.map((doc) => (this._lean ? toPlain(doc) : doc));
    return this._single ? mapped[0] || null : mapped;
  }
  then(onFulfilled, onRejected) {
    return this._resolve().then(onFulfilled, onRejected);
  }
  catch(onRejected) {
    return this._resolve().catch(onRejected);
  }
  finally(onFinally) {
    return this._resolve().finally(onFinally);
  }
}

const store = new Map();

const FakeAdmin = {
  __forceSuperAdminDuplicateKey: false,
  __schemaReadyCalls: 0,

  __reset() {
    store.clear();
    this.__forceSuperAdminDuplicateKey = false;
    this.__schemaReadyCalls = 0;
  },
  __all() {
    return [...store.values()].map(toPlain);
  },
  __get(id) {
    return store.get(String(id)) || null;
  },
  __put(data = {}) {
    const id = data._id || newId();
    const createdAt = data.createdAt || newDate();
    const doc = new FakeAdminDoc({
      _id: id,
      email: data.email,
      username: data.username,
      password: data.password,
      role: data.role ?? "admin",
      status: data.status ?? "active",
      isActive: data.isActive ?? true,
      tokenVersion: data.tokenVersion ?? 0,
      blockedAt: data.blockedAt ?? null,
      blockedBy: data.blockedBy ?? null,
      blockedReason: data.blockedReason ?? "",
      deactivatedAt: data.deactivatedAt ?? null,
      deactivatedBy: data.deactivatedBy ?? null,
      statusUpdatedAt: data.statusUpdatedAt ?? null,
      statusUpdatedBy: data.statusUpdatedBy ?? null,
      createdAt,
      updatedAt: data.updatedAt || createdAt,
    });
    store.set(id, doc);
    return doc;
  },
  __emailTaken(email) {
    if (typeof email !== "string") return false;
    const normalized = email.trim().toLowerCase();
    return [...store.values()].some(
      (doc) => String(doc.email).toLowerCase() === normalized
    );
  },

  async init() {
    return undefined;
  },
  async ensureAdminSchemaReady() {
    this.__schemaReadyCalls += 1;
    await this.init();
  },
  async countDocuments(filter = {}) {
    return [...store.values()].filter((doc) => matchesDoc(doc, filter)).length;
  },
  findById(id) {
    return new FakeQuery(
      async () => {
        const doc = store.get(String(id));
        return doc ? [doc] : [];
      },
      { single: true }
    );
  },
  find(filter = {}) {
    return new FakeQuery(async () =>
      [...store.values()].filter((doc) => matchesDoc(doc, filter))
    );
  },
  async findOne(filter = {}) {
    return [...store.values()].find((doc) => matchesDoc(doc, filter)) || null;
  },
  async create(data = {}) {
    if (this.__emailTaken(data.email)) {
      const err = new Error("E11000 duplicate email");
      err.code = 11000;
      throw err;
    }
    const password = data.password
      ? FAKE_HASH_PREFIX + String(data.password)
      : data.password;
    return this.__put({ ...data, password });
  },
  async findOneAndUpdate(filter = {}, update = {}, options = {}) {
    if (this.__forceSuperAdminDuplicateKey) {
      const err = new Error("E11000 duplicate superadmin role");
      err.code = 11000;
      throw err;
    }
    const doc = [...store.values()].find((candidate) =>
      matchesDoc(candidate, filter)
    );
    if (!doc) return null;
    applyUpdate(doc, update);
    doc.updatedAt = newDate();
    return options.new === false ? new FakeAdminDoc(toPlain(doc)) : doc;
  },
  async findByIdAndUpdate(id, update = {}, options = {}) {
    const doc = store.get(String(id));
    if (!doc) return null;
    const previous = toPlain(doc);
    applyUpdate(doc, update);
    doc.updatedAt = newDate();
    return options.new === false ? new FakeAdminDoc(previous) : doc;
  },
  async findByIdAndDelete(id) {
    const key = String(id);
    const doc = store.get(key);
    if (doc) store.delete(key);
    return doc || null;
  },
};

const modelPath = require.resolve("../Models/admin.model");
require.cache[modelPath] = {
  id: modelPath,
  filename: modelPath,
  loaded: true,
  exports: FakeAdmin,
  children: [],
  paths: [],
};

const { verifyAdmin, verifySuperAdmin } = require("../middleware/adminAuth");
const superadmin = require("../Controllers/superadmin.controllers");
const admin = require("../Controllers/admin.controllers");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeRes = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
  send(payload) {
    this.body = payload;
    return this;
  },
});

const makeReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  admin: undefined,
  adminDoc: undefined,
  ...overrides,
});

const contextFor = (doc, overrides = {}) => ({
  admin: {
    id: String(doc._id),
    _id: doc._id,
    email: doc.email,
    username: doc.username,
    role: doc.role,
    status: doc.status,
    tokenVersion: doc.tokenVersion,
  },
  adminDoc: doc,
  ...overrides,
});

const bearerReq = (token) =>
  makeReq({ headers: { authorization: `Bearer ${token}` } });

const tokenFor = (doc, overrides = {}) =>
  jwt.sign(
    {
      id: String(doc._id),
      role: doc.role,
      email: doc.email,
      version: doc.tokenVersion ?? 0,
      ...overrides,
    },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: "1h" }
  );

const runMiddleware = async (middleware, req) => {
  const res = makeRes();
  let nextCount = 0;
  let nextError;
  await middleware(req, res, (err) => {
    nextCount += 1;
    nextError = err;
  });
  return { res, nextCount, nextError };
};

const containsPasswordKey = (value) => {
  if (Array.isArray(value)) return value.some(containsPasswordKey);
  if (value && typeof value === "object") {
    return (
      Object.keys(value).some((key) => key.toLowerCase().includes("password")) ||
      Object.values(value).some(containsPasswordKey)
    );
  }
  return false;
};

const serializable = (value) => JSON.parse(JSON.stringify(value));

const createAdminDoc = (overrides = {}) =>
  FakeAdmin.create({
    email: "admin@test.dev",
    username: "admin",
    password: "Password123!",
    role: "admin",
    ...overrides,
  });

beforeEach(() => {
  FakeAdmin.__reset();
  delete process.env.SUPER_ADMIN_ACTIVATION_KEY;
  delete process.env.ADMIN_BOOTSTRAP_KEY;
  process.env.ADMIN_JWT_SECRET = "test-secret";
});

afterEach(() => {
  if (originalActivationKey === undefined) {
    delete process.env.SUPER_ADMIN_ACTIVATION_KEY;
  } else {
    process.env.SUPER_ADMIN_ACTIVATION_KEY = originalActivationKey;
  }
  if (originalBootstrapKey === undefined) {
    delete process.env.ADMIN_BOOTSTRAP_KEY;
  } else {
    process.env.ADMIN_BOOTSTRAP_KEY = originalBootstrapKey;
  }
});

after(() => {
  bcrypt.compare = originalBcryptCompare;
  if (originalJwtSecret === undefined) {
    delete process.env.ADMIN_JWT_SECRET;
  } else {
    process.env.ADMIN_JWT_SECRET = originalJwtSecret;
  }
});

// ---------------------------------------------------------------------------
// 1. verifyAdmin
// ---------------------------------------------------------------------------

test("verifyAdmin uses DB role/status/version and rejects blocked, inactive, stale, missing and invalid sessions", async () => {
  const regular = await createAdminDoc();

  // A forged token role must NOT grant superadmin; DB role wins.
  let req = bearerReq(tokenFor(regular, { role: "superadmin" }));
  let result = await runMiddleware(verifyAdmin, req);
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.nextCount, 1);
  assert.equal(result.nextError, undefined);
  assert.equal(req.admin.id, String(regular._id));
  assert.equal(req.admin.role, "admin");
  assert.equal(req.admin.status, "active");
  assert.equal(req.admin.tokenVersion, 0);
  assert.equal(req.adminDoc._id, regular._id);

  const boss = await createAdminDoc({
    email: "boss@test.dev",
    username: "boss",
    role: "superadmin",
    tokenVersion: 5,
  });
  req = bearerReq(tokenFor(boss, { role: "admin" }));
  result = await runMiddleware(verifyAdmin, req);
  assert.equal(result.nextCount, 1);
  assert.equal(req.admin.role, "superadmin");
  assert.equal(req.admin.tokenVersion, 5);

  await FakeAdmin.findByIdAndUpdate(regular._id, {
    $set: { status: "blocked", isActive: false },
  });
  result = await runMiddleware(verifyAdmin, bearerReq(tokenFor(regular)));
  assert.equal(result.res.statusCode, 401);
  assert.match(result.res.body.message, /blocked/);
  assert.equal(result.nextCount, 0);

  await FakeAdmin.findByIdAndUpdate(regular._id, {
    $set: { status: "active", isActive: false },
  });
  result = await runMiddleware(verifyAdmin, bearerReq(tokenFor(regular)));
  assert.equal(result.res.statusCode, 401);
  assert.match(result.res.body.message, /inactive/);

  await FakeAdmin.findByIdAndUpdate(regular._id, {
    $set: { status: "inactive", isActive: true },
  });
  result = await runMiddleware(verifyAdmin, bearerReq(tokenFor(regular)));
  assert.equal(result.res.statusCode, 401);
  assert.match(result.res.body.message, /inactive/);

  await FakeAdmin.findByIdAndUpdate(regular._id, {
    $set: { status: "active", isActive: true },
  });
  result = await runMiddleware(
    verifyAdmin,
    bearerReq(tokenFor(regular, { version: 99 }))
  );
  assert.equal(result.res.statusCode, 401);
  assert.match(result.res.body.message, /Session revoked/);
  assert.equal(result.nextCount, 0);

  result = await runMiddleware(
    verifyAdmin,
    bearerReq(jwt.sign({ id: "f".repeat(24) }, "test-secret"))
  );
  assert.equal(result.res.statusCode, 401);
  assert.match(result.res.body.message, /no longer exists/);

  result = await runMiddleware(verifyAdmin, bearerReq("not-a-real-jwt"));
  assert.equal(result.res.statusCode, 401);
  assert.match(result.res.body.message, /Invalid or expired token/);

  result = await runMiddleware(verifyAdmin, makeReq());
  assert.equal(result.res.statusCode, 401);
  assert.match(result.res.body.message, /No token provided/);

  await FakeAdmin.findByIdAndUpdate(regular._id, {
    $set: { role: "user" },
  });
  result = await runMiddleware(verifyAdmin, bearerReq(tokenFor(regular)));
  assert.equal(result.res.statusCode, 403);
  assert.match(result.res.body.message, /Admin access required/);
});

// ---------------------------------------------------------------------------
// 2. verifySuperAdmin
// ---------------------------------------------------------------------------

test("verifySuperAdmin returns 403 for regular admins and calls next for a DB superadmin", async () => {
  const regular = await createAdminDoc();
  let result = await runMiddleware(
    verifySuperAdmin,
    bearerReq(tokenFor(regular, { role: "superadmin" }))
  );
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.res.body.code, "SUPER_ADMIN_REQUIRED");
  assert.equal(result.nextCount, 0);

  const boss = await createAdminDoc({
    email: "boss@test.dev",
    username: "boss",
    role: "superadmin",
  });
  const req = bearerReq(tokenFor(boss, { role: "admin" }));
  result = await runMiddleware(verifySuperAdmin, req);
  assert.equal(result.nextCount, 1);
  assert.equal(result.res.statusCode, 200);
  assert.equal(req.admin.role, "superadmin");

  await FakeAdmin.findByIdAndUpdate(boss._id, {
    $set: { status: "blocked" },
  });
  result = await runMiddleware(verifySuperAdmin, bearerReq(tokenFor(boss)));
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCount, 0);
});

// ---------------------------------------------------------------------------
// 3. activateSuperAdmin
// ---------------------------------------------------------------------------

test("activateSuperAdmin validates config/key/uniqueness, promotes to superadmin and does not change tokenVersion", async () => {
  const actor = await createAdminDoc({ tokenVersion: 2 });
  const activationReq = (overrides = {}) =>
    makeReq({ ...contextFor(actor), body: {}, ...overrides });

  let res = makeRes();
  await superadmin.activateSuperAdmin(activationReq(), res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.message, /not configured/);

  process.env.SUPER_ADMIN_ACTIVATION_KEY = "activation-key";

  res = makeRes();
  await superadmin.activateSuperAdmin(activationReq(), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /required/);

  res = makeRes();
  await superadmin.activateSuperAdmin(
    activationReq({ body: { activationKey: "wrong-key" } }),
    res
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "INVALID_ACTIVATION_KEY");
  assert.equal(FakeAdmin.__get(actor._id).role, "admin");

  res = makeRes();
  await superadmin.activateSuperAdmin(
    activationReq({ body: { activationKey: "activation-key" } }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.body.message, /activated/);
  assert.equal(res.body.admin.role, "superadmin");
  assert.equal(res.body.admin.status, "active");
  assert.equal(FakeAdmin.__get(actor._id).role, "superadmin");
  assert.equal(
    FakeAdmin.__get(actor._id).tokenVersion,
    2,
    "activation must NOT change tokenVersion"
  );
  assert.equal(res.body.tokenVersion, 2);
  assert.ok(FakeAdmin.__schemaReadyCalls >= 1);

  // A second activation is rejected even for the now-superadmin row.
  res = makeRes();
  await superadmin.activateSuperAdmin(
    activationReq({ body: { activationKey: "activation-key" } }),
    res
  );
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /already been activated/);

  // Simulate the unique partial index race: findOneAndUpdate throws E11000.
  FakeAdmin.__reset();
  const fresh = await createAdminDoc({ tokenVersion: 7 });
  FakeAdmin.__forceSuperAdminDuplicateKey = true;
  res = makeRes();
  await superadmin.activateSuperAdmin(
    makeReq({
      ...contextFor(fresh),
      body: { activationKey: "activation-key" },
    }),
    res
  );
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /already been activated/);
  assert.equal(FakeAdmin.__get(fresh._id).role, "admin");
});

// ---------------------------------------------------------------------------
// 4. createAdmin
// ---------------------------------------------------------------------------

test("createAdmin forces role admin and active status, rejects duplicate email and short passwords", async () => {
  let res = makeRes();
  await superadmin.createAdmin(
    makeReq({
      body: {
        username: "new-admin",
        email: "New@Test.dev",
        password: "Password123!",
        role: "superadmin",
        status: "blocked",
        isActive: false,
        tokenVersion: 99,
      },
    }),
    res
  );
  assert.equal(res.statusCode, 201);
  const created = FakeAdmin.__all().find(
    (doc) => doc.email.toLowerCase() === "new@test.dev"
  );
  assert.ok(created);
  assert.equal(created.role, "admin");
  assert.equal(created.status, "active");
  assert.equal(created.isActive, true);
  assert.equal(res.body.admin.role, "admin");
  assert.equal(containsPasswordKey(serializable(res.body)), false);

  res = makeRes();
  await superadmin.createAdmin(
    makeReq({
      body: {
        username: "duplicate",
        email: "new@test.dev",
        password: "Password123!",
      },
    }),
    res
  );
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /already exists/);

  res = makeRes();
  await superadmin.createAdmin(
    makeReq({
      body: {
        username: "short",
        email: "short@test.dev",
        password: "1234567",
      },
    }),
    res
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /at least 8/);
  assert.equal(FakeAdmin.__all().length, 1);
});

// ---------------------------------------------------------------------------
// 5. status changes, block/unblock and delete
// ---------------------------------------------------------------------------

test("setAdminStatus/blockAdmin/unblockAdmin/deleteAdmin reject self and superadmin rows, validate ids and revoke sessions", async () => {
  const actor = await createAdminDoc({
    email: "root@test.dev",
    username: "root",
    role: "superadmin",
  });
  const target = await createAdminDoc({
    email: "target@test.dev",
    username: "target",
  });
  const otherSuper = await createAdminDoc({
    email: "other-super@test.dev",
    username: "other-super",
    role: "superadmin",
  });

  const req = (overrides = {}) =>
    makeReq({ ...contextFor(actor), body: {}, ...overrides });

  for (const handler of [
    superadmin.setAdminStatus,
    superadmin.blockAdmin,
    superadmin.unblockAdmin,
    superadmin.deleteAdmin,
  ]) {
    const res = makeRes();
    await handler(req({ params: { id: "not-an-object-id" } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Invalid admin id/);
  }

  for (const handler of [
    superadmin.setAdminStatus,
    superadmin.blockAdmin,
    superadmin.unblockAdmin,
    superadmin.deleteAdmin,
  ]) {
    const res = makeRes();
    await handler(
      req({ params: { id: String(actor._id) }, body: { status: "inactive" } }),
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /own account/);
  }

  for (const handler of [
    superadmin.setAdminStatus,
    superadmin.blockAdmin,
    superadmin.unblockAdmin,
    superadmin.deleteAdmin,
  ]) {
    const res = makeRes();
    await handler(req({ params: { id: String(otherSuper._id) } }), res);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /Super Admin account cannot be modified/);
  }
  assert.equal(FakeAdmin.__get(otherSuper._id).status, "active");

  let res = makeRes();
  await superadmin.blockAdmin(
    req({ params: { id: String(target._id) }, body: { reason: "abuse" } }),
    res
  );
  assert.equal(res.statusCode, 200);
  const blocked = FakeAdmin.__get(target._id);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.isActive, false);
  assert.ok(blocked.blockedAt instanceof Date);
  assert.equal(String(blocked.blockedBy), String(actor._id));
  assert.equal(blocked.blockedReason, "abuse");
  assert.equal(blocked.tokenVersion, 1, "block must bump tokenVersion");
  assert.equal(containsPasswordKey(serializable(res.body)), false);

  res = makeRes();
  await superadmin.unblockAdmin(req({ params: { id: String(target._id) } }), res);
  assert.equal(res.statusCode, 200);
  const unblocked = FakeAdmin.__get(target._id);
  assert.equal(unblocked.status, "active");
  assert.equal(unblocked.isActive, true);
  assert.equal(unblocked.blockedAt, null);
  assert.equal(unblocked.role, "admin", "unblock must not change role");
  assert.equal(unblocked.tokenVersion, 2);

  res = makeRes();
  await superadmin.setAdminStatus(
    req({ params: { id: String(target._id) }, body: { status: "inactive" } }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(FakeAdmin.__get(target._id).status, "inactive");
  assert.equal(FakeAdmin.__get(target._id).isActive, false);
  assert.equal(FakeAdmin.__get(target._id).tokenVersion, 3);

  res = makeRes();
  await superadmin.setAdminStatus(
    req({ params: { id: String(target._id) }, body: { isActive: true } }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(FakeAdmin.__get(target._id).status, "active");
  assert.equal(FakeAdmin.__get(target._id).isActive, true);
  assert.equal(FakeAdmin.__get(target._id).tokenVersion, 4);

  res = makeRes();
  await superadmin.deleteAdmin(req({ params: { id: String(target._id) } }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.message, /deleted/);
  assert.equal(FakeAdmin.__get(target._id), null);
});

// ---------------------------------------------------------------------------
// 6. listAdmins
// ---------------------------------------------------------------------------

test("listAdmins returns admins/stats/pagination, filters by search and status, and strips passwords", async () => {
  await createAdminDoc({
    email: "alice@test.dev",
    username: "alice",
    status: "active",
  });
  await createAdminDoc({
    email: "bob@test.dev",
    username: "bob",
    status: "blocked",
    isActive: false,
  });
  await createAdminDoc({
    email: "carol@test.dev",
    username: "carol",
    status: "inactive",
    isActive: false,
  });
  await createAdminDoc({
    email: "dave@test.dev",
    username: "dave",
    status: "active",
  });
  await createAdminDoc({
    email: "boss@test.dev",
    username: "boss",
    role: "superadmin",
    status: "active",
  });

  let res = makeRes();
  await superadmin.listAdmins(makeReq({ query: {} }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), [
    "admins",
    "pagination",
    "stats",
  ]);
  assert.equal(res.body.admins.length, 5);
  assert.deepEqual(res.body.stats, {
    total: 5,
    active: 3,
    inactive: 1,
    blocked: 1,
  });
  assert.deepEqual(res.body.pagination, {
    page: 1,
    limit: 10,
    total: 5,
    pages: 1,
  });
  assert.equal(containsPasswordKey(res.body), false);
  for (const entry of res.body.admins) {
    assert.equal("password" in entry, false);
  }

  res = makeRes();
  await superadmin.listAdmins(makeReq({ query: { search: "ALICE" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.admins.length, 1);
  assert.equal(res.body.admins[0].username, "alice");

  res = makeRes();
  await superadmin.listAdmins(makeReq({ query: { search: "BOB@" } }), res);
  assert.equal(res.body.admins.length, 1);
  assert.equal(res.body.admins[0].username, "bob");

  res = makeRes();
  await superadmin.listAdmins(makeReq({ query: { status: "blocked" } }), res);
  assert.equal(res.body.admins.length, 1);
  assert.equal(res.body.admins[0].username, "bob");

  res = makeRes();
  await superadmin.listAdmins(makeReq({ query: { status: "inactive" } }), res);
  assert.equal(res.body.admins.length, 1);
  assert.equal(res.body.admins[0].username, "carol");

  res = makeRes();
  await superadmin.listAdmins(makeReq({ query: { page: "2", limit: "2" } }), res);
  assert.equal(res.body.admins.length, 2);
  assert.deepEqual(res.body.pagination, {
    page: 2,
    limit: 2,
    total: 5,
    pages: 3,
  });
});

// ---------------------------------------------------------------------------
// 7. loginAdmin
// ---------------------------------------------------------------------------

test("loginAdmin rejects blocked/inactive admins, signs DB-derived role/version and never returns a password", async () => {
  const doc = await createAdminDoc({
    email: "login@test.dev",
    username: "login-user",
    role: "superadmin",
    tokenVersion: 4,
  });
  const body = { email: "login@test.dev", password: "Password123!" };

  let res = makeRes();
  await admin.loginAdmin(makeReq({ body }), res);
  assert.equal(res.statusCode, 200);
  const decoded = jwt.verify(res.body.token, "test-secret");
  assert.equal(decoded.id, String(doc._id));
  assert.equal(decoded.role, "superadmin");
  assert.equal(decoded.email, "login@test.dev");
  assert.equal(decoded.version, 4);
  assert.equal(res.body.role, "superadmin");
  assert.equal(res.body.isSuperAdmin, true);
  assert.equal(res.body.admin.status, "active");
  assert.equal(res.body.admin.password, undefined);
  assert.equal(containsPasswordKey(serializable(res.body)), false);

  await FakeAdmin.findByIdAndUpdate(doc._id, {
    $set: { status: "blocked", isActive: false },
  });
  res = makeRes();
  await admin.loginAdmin(makeReq({ body }), res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /blocked/);

  await FakeAdmin.findByIdAndUpdate(doc._id, {
    $set: { status: "active", isActive: false },
  });
  res = makeRes();
  await admin.loginAdmin(makeReq({ body }), res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /inactive/);

  await FakeAdmin.findByIdAndUpdate(doc._id, {
    $set: { status: "inactive", isActive: true },
  });
  res = makeRes();
  await admin.loginAdmin(makeReq({ body }), res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /inactive/);

  await FakeAdmin.findByIdAndUpdate(doc._id, {
    $set: { status: "active", isActive: true },
  });
  res = makeRes();
  await admin.loginAdmin(
    makeReq({ body: { email: doc.email, password: "wrong-password" } }),
    res
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Invalid credentials/);
});

// ---------------------------------------------------------------------------
// 8. registerAdmin
// ---------------------------------------------------------------------------

test("registerAdmin closes after the first admin and always creates a regular admin", async () => {
  let res = makeRes();
  await admin.registerAdmin(
    makeReq({
      body: {
        email: "first@test.dev",
        username: "first",
        password: "Password123!",
        role: "superadmin",
        status: "blocked",
      },
    }),
    res
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.role, "admin");
  const created = FakeAdmin.__all()[0];
  assert.equal(created.role, "admin");
  assert.equal(containsPasswordKey(serializable(res.body)), false);

  res = makeRes();
  await admin.registerAdmin(
    makeReq({
      body: {
        email: "second@test.dev",
        username: "second",
        password: "Password123!",
      },
    }),
    res
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /closed/);
  assert.equal(FakeAdmin.__all().length, 1);

  FakeAdmin.__reset();
  process.env.ADMIN_BOOTSTRAP_KEY = "bootstrap-key";

  res = makeRes();
  await admin.registerAdmin(
    makeReq({
      body: {
        email: "again@test.dev",
        username: "again",
        password: "Password123!",
      },
    }),
    res
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /bootstrap key/);

  res = makeRes();
  await admin.registerAdmin(
    makeReq({
      body: {
        email: "again@test.dev",
        username: "again",
        password: "Password123!",
        bootstrapKey: "bootstrap-key",
        role: "superadmin",
      },
    }),
    res
  );
  assert.equal(res.statusCode, 201);
  assert.equal(FakeAdmin.__all()[0].role, "admin");
  assert.equal(res.body.role, "admin");
});
