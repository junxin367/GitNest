export interface GitEnvironment {
  executablePath: string;
  version: string;
  lfs: {
    available: boolean;
    version?: string;
  };
  identity: {
    name?: string;
    email?: string;
  };
  credentialHelpers: string[];
  ssh: {
    command: string;
    authSockConfigured: boolean;
    configPath?: string;
    configExists: boolean;
  };
  detectedAt: string;
}
