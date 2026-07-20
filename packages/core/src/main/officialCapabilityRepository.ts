import {
  type CapabilityRepository
} from "./capabilityRepository";
import { getOfficialDatabaseService } from "./officialDatabaseService";
import { createSqliteCapabilityRepository } from "./sqliteCapabilityRepository";

let repository: CapabilityRepository | null = null;

export const getOfficialCapabilityRepository = (): CapabilityRepository => {
  repository ??= createSqliteCapabilityRepository({
    database: getOfficialDatabaseService()
  });

  return repository;
};
