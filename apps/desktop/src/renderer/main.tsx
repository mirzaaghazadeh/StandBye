import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { store } from "./state/store";
import "./styles.css";

void store.init();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
