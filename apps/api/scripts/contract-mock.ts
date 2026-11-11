import { createContractMock } from "../src/modules/listings/contract-mock.js";
const port = Number(process.env.CONTRACT_MOCK_PORT ?? 4010);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid CONTRACT_MOCK_PORT");
createContractMock().listen(port, "127.0.0.1", () =>
  process.stdout.write(
    `Contract fixture server only: http://127.0.0.1:${port}\n`,
  ),
);
