import type { CampusosBridge } from "../shared/campusBridge";

declare global {
  interface Window {
    campusos?: CampusosBridge;
  }
}

export {};
