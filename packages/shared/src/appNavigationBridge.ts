/** Structured navigation request sent from the main process to the main renderer. */
export interface AppNavigationRequest {
  requestId: string;
  viewId: string;
  entityId?: string;
  /** Optional feed batch used when one desktop toast represents several notices. */
  entityIds?: string[];
  /** Optional semester/term hint carried by the global-search jump-to-locate flow. */
  semester?: string;
}

export interface AppNavigationBridge {
  subscribe: (listener: (request: AppNavigationRequest) => void) => () => void;
}
