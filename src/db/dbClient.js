import { createDbWorker } from "sql.js-httpvfs";

const FILE_LENGTH = 71716864;

export async function initDatabase() {
  const config = {
    from: "jsonconfig",
    config: {
      serverMode: "full",
      requestChunkSize: 4096,
      databaseUrl: "/CollecTF.db.gz",
      fileLength: FILE_LENGTH,
      gzip: true,
    },
  };

  console.log("constructing url database", config.config.databaseUrl);
  const workerUrl = new URL("/sqlite.worker.js", window.location.href).toString();
  const wasmUrl = new URL("/sql-wasm.wasm", window.location.href).toString();

  const worker = await createDbWorker(
    [config],
    workerUrl,
    wasmUrl
  );

  return worker;
}

