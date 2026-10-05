import type { RepositoryTopology } from "../domain/repository";
import type { GitReadOptions } from "./git-client";

export interface GitTopologyClient {
  readRepositoryTopology(
    path: string,
    options?: GitReadOptions
  ): Promise<RepositoryTopology>;
}
