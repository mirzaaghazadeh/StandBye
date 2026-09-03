import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@kit-styles";
import "./site.css";
import { DownloadPage } from "./DownloadPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DownloadPage />
  </StrictMode>,
);
