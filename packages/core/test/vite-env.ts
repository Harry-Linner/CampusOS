const meta = import.meta as ImportMeta & {
  env?: Record<string, string | boolean>;
};

if (!meta.env) {
  meta.env = {
    MODE: "test",
    DEV: false,
    PROD: true,
    SSR: true
  };
}

export {};
