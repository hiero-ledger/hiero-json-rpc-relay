// SPDX-License-Identifier: Apache-2.0

export interface GitHubContext {
  readonly owner: string;
  readonly repo: string;
  readonly token: string;
  readonly pullNumber: number;
}
