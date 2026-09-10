import { createOnlineServer } from "./app";

const port = Number(process.env.PORT ?? 3001);
const { http, io } = createOnlineServer();
http.listen(port, "127.0.0.1", () => {
  console.log(`Online matgo server: http://127.0.0.1:${port}`);
});
http.on("error", error => { console.error(error); process.exitCode = 1; });
process.on("SIGINT", () => { void io.close(); });
process.on("SIGTERM", () => { void io.close(); });
