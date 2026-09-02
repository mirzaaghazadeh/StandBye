import type { CrewApi } from "./index";

declare global {
  interface Window {
    crew: CrewApi;
  }
}

export {};
