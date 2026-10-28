import "dotenv/config";
import { app } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("Invalid PORT configuration");
}

app.listen(PORT, () => {
  console.log(
    `Taiwan Rental API running at http://localhost:${PORT}`
  );
});

