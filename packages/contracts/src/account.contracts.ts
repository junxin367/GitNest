export type AccountProviderDto =
  | "github"
  | "gitlab"
  | "gitee"
  | "custom";

export type AccountAuthTypeDto =
  | "https-token"
  | "system-ssh";

export type AccountVerificationStatusDto =
  | "untested"
  | "verified"
  | "authentication-failed"
  | "permission-denied"
  | "unavailable";

export interface AccountProfileDto {
  id: string;
  provider: AccountProviderDto;
  host: string;
  username?: string;
  authType: AccountAuthTypeDto;
  hasCredential: boolean;
  verificationStatus: AccountVerificationStatusDto;
  lastVerifiedAt?: string;
}

export interface RepositoryAccountBindingDto {
  host: string;
  accountId: string;
  repositoryId?: string;
}

export interface AccountOverviewDto {
  accounts: AccountProfileDto[];
  bindings: RepositoryAccountBindingDto[];
}

export interface SaveAccountRequest {
  id?: string;
  provider: AccountProviderDto;
  host: string;
  username?: string;
  authType: AccountAuthTypeDto;
  token?: string;
  makeHostDefault?: boolean;
}

export interface BindAccountRequest {
  accountId: string;
  repositoryId?: string;
}

export interface UnbindAccountRequest {
  host: string;
  repositoryId?: string;
}

export interface AccountRemovalImpactRequest {
  accountId: string;
}

export interface RemoveAccountRequest {
  accountId: string;
  confirmed: boolean;
}

export interface AccountRemovalImpactDto {
  accountId: string;
  host: string;
  repositoryIds: string[];
  hostDefault: boolean;
}

export interface TestAccountRequest {
  accountId: string;
  repositoryUrl: string;
}

export interface AccountConnectionTestResultDto {
  accountId: string;
  status: Exclude<
    AccountVerificationStatusDto,
    "untested"
  >;
  message: string;
  verifiedAt: string;
}
