import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../src/ui/App";

describe("application shell", () => {
  it("renders an accessible main landmark and local-processing statement", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("<main>");
    expect(html).toContain("Your combat log stays on your computer.");
    expect(html).toContain(
      "processed locally in your browser and is never uploaded",
    );
    expect(html).toContain('aria-labelledby="privacy-title"');
  });
});
