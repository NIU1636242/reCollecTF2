import { createDbWorker } from "sql.js-httpvfs";

const workerUrl = new URL("sql.js-httpvfs/dist/sqlite.worker.js", import.meta.url).toString();
const wasmUrl   = new URL("sql.js-httpvfs/dist/sql-wasm.wasm",   import.meta.url).toString();

export const dbWorkerPromise = createDbWorker(
  [
    {
      from: "inline",
      config: {
        serverMode: "full",
        url:         "/CollecTF/CollecTF.db",
        requestChunkSize: 64 * 1024,  // fewer, larger requests
      },
    },
  ],
  workerUrl,
  wasmUrl,
  10 * 1024 * 1024
);




/*

let dbWorker = null;

export async function initDb() {
    if (dbWorker) return dbWorker;

    const workerUrl = new URL("sqlite.worker.js", `${window.location.origin}/CollecTF/`);
    const wasmUrl = new URL("sql-wasm.wasm", `${window.location.origin}/CollecTF/`);

    const config = {
        from: "inline",
        config: {
        serverMode: "full",
        url: "/CollecTF/CollecTF.db",
        requestChunkSize: 4096
        }
    };

    const maxBytesToRead = 10 * 1024 * 1024;

    try {
        dbWorker = await createDbWorker([config], workerUrl.toString(), wasmUrl.toString(), maxBytesToRead);
        return dbWorker;
    }
    catch (error){
        console.error("Error initializing dbWorker:", error);
        throw error;
    }
}

*/