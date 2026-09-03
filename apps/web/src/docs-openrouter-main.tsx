import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@kit-styles";
import "./site.css";
import { OpenRouterDocs } from "./OpenRouterDocs";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OpenRouterDocs />
  </StrictMode>,
);
