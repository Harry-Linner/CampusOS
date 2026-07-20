import { app } from "electron";
import { join } from "node:path";
import {
  createDatabaseService,
  type DatabaseService
} from "./databaseService";

let databaseService: DatabaseService | null = null;

export const getOfficialDatabaseService = (): DatabaseService => {
  databaseService ??= createDatabaseService({
    databasePath: join(app.getPath("userData"), "campusos.sqlite")
  });
  return databaseService;
};
