import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const fixturePath = "tests/tooling/unsafe-any.fixture.ts";
const source = readFileSync(fixturePath, "utf8");
const result = spawnSync(
  "npx",
  ["eslint", "--no-ignore", "--stdin", "--stdin-filename", fixturePath],
  {
    input: source,
    encoding: "utf8",
  },
);
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.status === 0) {
  process.stderr.write("Negative lint fixture unexpectedly passed.\n");
  process.exitCode = 1;
} else if (!output.includes("@typescript-eslint/no-explicit-any")) {
  process.stderr.write(
    `Negative lint fixture failed for the wrong reason:\n${output}`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Negative lint fixture was rejected as expected.\n");
}
