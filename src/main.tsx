import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./ui/App";
import "./ui/styles.css";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("Application root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
