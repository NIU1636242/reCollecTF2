// src/db/queryExecutor.js
import { dbWorkerPromise } from "./dbClient";

const isSelect = (sql = "") => /^\s*select\b/i.test(sql);

async function runSelectLocal(sql, params) {
  const worker = await dbWorkerPromise;
  return worker.db.query(sql, params);
}

async function runMutateServer(sql, params) {
  const res = await fetch("/api/mutate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Mutation error");
  return data;
}

export async function runQuery(sql, params = []) {
  return isSelect(sql) ? runSelectLocal(sql, params) : runMutateServer(sql, params);
}
