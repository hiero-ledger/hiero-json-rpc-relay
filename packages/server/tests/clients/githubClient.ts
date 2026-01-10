// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Octokit } from '@octokit/core';

import { GitHubContext } from '../types/GitHubContext';

/**
 * Client for interacting with GitHub, providing methods to perform operations such as adding comments to pull requests.
 */
export class GitHubClient {
  private static readonly GET_COMMENTS_ENDPOINT = 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments';
  private static readonly CREATE_COMMENT_ENDPOINT = 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments';
  private static readonly UPDATE_COMMENT_ENDPOINT = 'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}';

  /**
   * The Octokit instance used to interact with GitHub.
   * @private
   */
  private readonly octokit: Octokit;

  constructor(octokit?: Octokit) {
    this.octokit = octokit || new Octokit({ auth: ConfigService.get('GITHUB_TOKEN') });
  }

  /**
   * Update or add a comment to a pull request.
   * @param {string} commentBody - The body of the comment.
   * @param {function} predicate - A function that determines if an existing comment should be updated.
   * @returns {Promise<void>} A promise that resolves when the comment is successfully updated or added.
   */
  async addOrUpdateExistingCommentOnPullRequest(
    commentBody: string,
    predicate: (existingComment: string) => boolean,
  ): Promise<void> {
    const comments = await this.getCommentsOnPullRequest();
    const existingComment = comments.data.find((comment) => comment.body && predicate(comment.body));
    if (existingComment) {
      await this.updateCommentOnPullRequest(commentBody, existingComment.id);
    } else {
      await this.addCommentToPullRequest(commentBody);
    }
  }

  /**
   * Gets a list of comments on a pull request.
   * @returns A promise that resolves with the list of comments.
   */
  async getCommentsOnPullRequest() {
    try {
      const context = GitHubClient.getContext();
      return await this.octokit.request(GitHubClient.GET_COMMENTS_ENDPOINT, {
        owner: context.owner,
        repo: context.repo,
        issue_number: context.pullNumber,
      });
    } catch (error) {
      console.error('Failed to retrieve comments on PR:', error);
      return { data: [] };
    }
  }

  /**
   * Updates a comment on a pull request.
   * @param {string} commentBody - The body of the comment.
   * @param {number} commentId - The ID of the comment to update.
   * @returns {Promise<void>} A promise that resolves when the comment is successfully updated.
   */
  async updateCommentOnPullRequest(commentBody: string, commentId: number): Promise<void> {
    try {
      const context = GitHubClient.getContext();
      await this.octokit.request(GitHubClient.UPDATE_COMMENT_ENDPOINT, {
        owner: context.owner,
        repo: context.repo,
        comment_id: commentId,
        body: commentBody,
      });
    } catch (error) {
      console.error('Failed to update comment on PR:', error);
    }
  }

  /**
   * Adds a comment to a pull request.
   * @param {string} commentBody - The body of the comment.
   * @returns {Promise<void>} A promise that resolves when the comment is successfully posted.
   */
  async addCommentToPullRequest(commentBody: string): Promise<void> {
    try {
      const context = GitHubClient.getContext();
      await this.octokit.request(GitHubClient.CREATE_COMMENT_ENDPOINT, {
        owner: context.owner,
        repo: context.repo,
        issue_number: context.pullNumber,
        body: commentBody,
      });
    } catch (error) {
      console.error('Failed to post comment to PR:', error);
    }
  }

  /**
   * Retrieves the GitHub context from environment variables.
   * @returns {GitHubContext} The GitHub context.
   */
  private static getContext(): GitHubContext {
    const GITHUB_REPOSITORY = ConfigService.get('GITHUB_REPOSITORY');
    const GITHUB_PR_NUMBER = ConfigService.get('GITHUB_PR_NUMBER');
    const GITHUB_TOKEN = ConfigService.get('GITHUB_TOKEN');
    if (!GITHUB_REPOSITORY || !GITHUB_PR_NUMBER || !GITHUB_TOKEN) {
      throw new Error(`Missing required environment variables: $GITHUB_REPOSITORY, $GITHUB_PR_NUMBER, $GITHUB_TOKEN`);
    }

    const pullNumber = parseInt(GITHUB_PR_NUMBER);
    if (isNaN(pullNumber)) {
      throw new Error('Invalid PR number: $GITHUB_PR_NUMBER must be a valid number.');
    }

    const [owner, repo] = GITHUB_REPOSITORY.split('/');
    if (!owner || !repo) {
      throw new Error('Invalid $GITHUB_REPOSITORY format: Expected "owner/repo".');
    }

    return { owner, repo, pullNumber, token: GITHUB_TOKEN };
  }
}
