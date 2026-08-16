/** Structured navigation request sent from the main process to the main renderer. */
export interface AppNavigationRequest {
  requestId: string;
  viewId: string;
  entityId?: string;
}

export interface AppNavigationBridge {
  subscribe: (listener: (request: AppNavigationRequest) => void) => () => void;
}
