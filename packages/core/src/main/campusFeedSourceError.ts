export class CampusFeedSourceError extends Error {
  constructor(public readonly code: "restricted" | "layout-changed" | "network-error", message: string) {
    super(message);
    this.name = "CampusFeedSourceError";
  }
}
