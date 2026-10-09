import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { clearReconnectSession, readReconnectSession, RECONNECT_STORAGE_KEY, saveReconnectSession } from "../src/online/reconnectSession";

function storage(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });
  return data;
}
test("reconnect storage retains only room code/token across reads and clears on leave", t => {
  const data = storage(t);
  const session = { roomCode: "ABC123", token: "a".repeat(64) };
  assert.equal(readReconnectSession(), null);
  assert.equal(saveReconnectSession(session), true);
  assert.deepEqual(readReconnectSession(), session);
  assert.deepEqual([...data.keys()], [RECONNECT_STORAGE_KEY]);
  assert.deepEqual(Object.keys(JSON.parse(data.get(RECONNECT_STORAGE_KEY)!)), ["roomCode", "token"]);
  clearReconnectSession();
  assert.equal(readReconnectSession(), null);
});
test("corrupt/stale-format session storage never crashes app startup", t => {
  const data = storage(t);
  for (const raw of ["{", "null", "[]", "{}", '{"roomCode":"ABC123","token":"short"}', '{"roomCode":10,"token":false}']) {
    data.set(RECONNECT_STORAGE_KEY, raw);
    assert.equal(readReconnectSession(), null);
    assert.equal(data.has(RECONNECT_STORAGE_KEY), false);
  }
});
test("disabled storage fails gracefully so offline modes remain usable", t => {
  storage(t);
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("Storage disabled"); } });
  assert.equal(readReconnectSession(), null);
  assert.equal(saveReconnectSession({ roomCode: "ABC123", token: "b".repeat(64) }), false);
  assert.doesNotThrow(clearReconnectSession);
});
