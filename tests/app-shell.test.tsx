import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../src/ui/App";

describe("application shell", () => {
  it("renders an accessible main landmark and local-processing statement", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("<main");
    expect(html).toContain("Processed locally. Nothing is uploaded.");
    expect(html).toContain("Turn a target dummy log into an encounter log.");
    expect(html).not.toContain("Browser only");
    expect(html).not.toContain("<header");
    expect(html).toContain("How to use it");
    expect(html).toContain("Upload your target dummy combat log.");
    expect(html).toContain("Archon desktop client");
    expect(html).toContain("chosen analysis tool");
  });
});
