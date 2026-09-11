import { createOnlineServer } from "./app";
import { readServerConfig } from "./config";

const config = readServerConfig();
const { http, io } = createOnlineServer({ connectionPolicy: config });
http.listen(config.port, config.host, () => {
  console.log(`Online server listening on ${config.host}:${config.port}`);
});
http.on("error", error => { console.error(error); process.exitCode = 1; });
process.on("SIGINT", () => { void io.close(); });
process.on("SIGTERM", () => { void io.close(); });
