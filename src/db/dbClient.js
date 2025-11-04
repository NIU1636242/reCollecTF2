import { createDbWorker } from "sql.js-httpvfs";

const workerUrl = new URL("sql.js-httpvfs/dist/sqlite.worker.js", import.meta.url).toString();
const wasmUrl   = new URL("sql.js-httpvfs/dist/sql-wasm.wasm",   import.meta.url).toString();


export const dbWorkerPromise = createDbWorker(
  [
    {
      from: "inline",
      config: {
        serverMode: "full",
        url: "/CollecTF.db.gz",
        requestChunkSize: 4096,
        fileLength: 71716864,
      },
    },
  ],
  workerUrl,
  wasmUrl,
  10 * 1024 * 1024
);

