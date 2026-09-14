import { app, session, type Session } from "electron";
import { resolve } from "node:path";

/** Local State/safeStorage stays installation-wide; renderer storage stays account-local. */
export const getAccountBrowserSession = (): Session => {
  const directory = app.getPath("userData");
  return resolve(directory) === resolve(app.getPath("sessionData"))
    ? session.defaultSession
    : session.fromPath(directory);
};
