
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_PR_NUMBER } = process.env;

const [owner, repo] = GITHUB_REPOSITORY.split('/');

// https://gist.github.com/leommoore/4526808
// https://en.wikipedia.org/wiki/ANSI_escape_code
const dim = text => `\x1b[2m${text}\x1b[0m`;
const red = text => `\x1b[31m${text}\x1b[0m`;
const yellow = text => `\x1b[33m${text}\x1b[0m`;
const blue = text => `\x1b[34m${text}\x1b[0m`;

/**
 * @param {string} endpoint 
 * @returns 
 */
async function _get(endpoint) {
  return await fetch('https://api.github.com/repos/' + endpoint, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
    },
  });
}

/**
 * 
 * @param {string | number} prNumber 
 * @returns 
 */
async function getPRDetails(prNumber) {
  const response = await _get(`${owner}/${repo}/pulls/${prNumber}`);
  if (response.status === 404) {
    console.info(dim(`PR #${prNumber} not found in repository ${owner}/${repo}, skipping...`));
    return null;
  }
  return await response.json();
}

async function getIssueDetails(issueOwner, issueRepo, issueNumber) {
  const response = await _get(`${issueOwner}/${issueRepo}/issues/${issueNumber}`);
  if (response.status === 404) {
    console.info(dim(`Issue #${issueNumber} not found in repository ${issueOwner}/${issueRepo}, skipping...`));
    return null;
  }
  return await response.json();
}

async function getContributors() {
  const response = await _get(`${owner}/${repo}/contributors`);
  return await response.json();
}

/**
 * @param {string} text 
 */
function stripHTMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, '');
}

/**
 * @param {string} text 
 */
function removeCodeBlocks(text) {
  // Remove fenced code blocks (triple backticks or tildes)
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/~~~[\s\S]*?~~~/g, '');
  // Remove inline code (single backticks)
  text = text.replace(/`[^`]*`/g, '');
  return text;
}

function extractPRReferences(text) {
  // Regex to match PR references with any number of digits
  const prRegex =
    /(?:^|\s)(?:Fixes|Closes|Resolves|See|PR|Pull Request)?\s*(?:https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)|([\w.-]+)\/([\w.-]+)#(\d+)|#(\d+))(?!\w)/gm;
  const matches = [];
  let match;
  while ((match = prRegex.exec(text)) !== null) {
    const refOwner = match[1] || match[4] || owner;
    const refRepo = match[2] || match[5] || repo;
    const prNumber = match[3] || match[6] || match[7];
    matches.push({
      owner: refOwner,
      repo: refRepo,
      prNumber,
    });
  }
  return matches;
}

/**
 * @param {string} text 
 */
function extractIssueReferences(text) {
  // Regex to match issue references with any number of digits
  // Supports 'Fixes #123', 'owner/repo#123', 'https://github.com/owner/repo/issues/123'
  const issueRegex =
    /(?:^|\s)(?:Fixes|Closes|Resolves|See|Issue)?\s*(?:(?:https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+))|([\w.-]+)\/([\w.-]+)#(\d+)|#(\d+))(?!\w)/gm;
  const issues = [];
  let match;
  while ((match = issueRegex.exec(text)) !== null) {
    const issueOwner = match[1] || match[4] || owner;
    const issueRepo = match[2] || match[5] || repo;
    const issueNumber = match[3] || match[6] || match[7];
    issues.push({
      owner: issueOwner,
      repo: issueRepo,
      issueNumber,
    });
  }
  return issues;
}

/**
 * @param {string} text 
 */
function cleanText(text) {
  let cleanText = text;
  cleanText = stripHTMLTags(cleanText);
  cleanText = removeCodeBlocks(cleanText);
  return cleanText;
}

/**
 * 
 * @param {*} pr 
 * @param {string[]} errors
 */
async function checkPRLabelsAndMilestone(pr, errors) {
  const { labels, milestone } = pr;

  if (!labels || labels.length === 0) {
    errors.push('The PR has no labels.');
  }
  if (!milestone) {
    errors.push('The PR has no milestone.');
  }
}

function isDependabotOrSnykPR(pr) {
  return pr.user.login === 'dependabot[bot]' || pr.user.login === 'swirlds-automation';
}

/**
 * @param {string} text 
 * @param {string[]} errors 
 */
async function processIssueReferencesInText(text, errors) {
  const issueReferences = extractIssueReferences(text);

  let hasElegibleIssueReference = false;
  let hasErrors = false;

  for (const issueRef of issueReferences) {
    // Only process issues from the same repository
    if (issueRef.owner === owner && issueRef.repo === repo) {
      hasElegibleIssueReference = true;
      const issue = await getIssueDetails(issueRef.owner, issueRef.repo, issueRef.issueNumber);
      if (issue) {
        const { labels, milestone } = issue;

        if (!labels || labels.length === 0) {
          errors.push(`Associated issue #${issueRef.issueNumber} has no labels.`);
          hasErrors = true;
        }
        if (!milestone) {
          errors.push(`Associated issue #${issueRef.issueNumber} has no milestone.`);
          hasErrors = true;
        }
      }
    } else {
      console.info(
        dim(`Issue #${issueRef.issueNumber} is from a different repository (${issueRef.owner}/${issueRef.repo}), skipping...`),
      );
    }
  }

  if (hasErrors) return;
  if (!hasElegibleIssueReference) {
    errors.push('The PR description must reference at least one issue from the current repository.');
  } else {
    console.info('All associated issues have labels and milestones.');
  }
}

/**
 * @param {string} text 
 * @param {{login: string}[]} contributors 
 */
async function processPRReferencesInText(text, contributors, errors) {
  const prReferences = extractPRReferences(text);

  if (prReferences.length === 0) {
    console.info('No associated PRs found in PR description.');
  } else {
    for (const prRef of prReferences) {
      // Only process PRs from the same repository
      if (prRef.owner === owner && prRef.repo === repo) {
        await processReferencedPR(prRef, contributors, errors);
      } else {
        console.info(dim(`PR #${prRef.prNumber} is from a different repository (${prRef.owner}/${prRef.repo}), skipping...`));
        // Skip processing issue references from external PRs
      }
    }
  }
}

/**
 * @param {string} prRef 
 * @param {{login: string}[]} contributors 
 */
async function processReferencedPR(prRef, contributors) {
  // Attempt to fetch the PR to validate its existence
  const referencedPR = await getPRDetails(prRef.prNumber);
  if (!referencedPR) {
    console.info(dim(`PR #${prRef.prNumber} does not exist, skipping...`));
    return; // Skip if PR not found
  }

  const authorLogin = referencedPR.user.login;

  const isContributor = contributors.some((contributor) => contributor.login === authorLogin);

  if (!isContributor) {
    console.info(dim(`PR author ${authorLogin} is not a contributor, skipping issue matching for PR #${prRef.prNumber}.`));
    return;
  }

  // Clean the referenced PR body
  const refPrBody = cleanText(referencedPR.body);

  // Extract issue references from the referenced PR description
  const refIssueReferences = extractIssueReferences(refPrBody);

  if (refIssueReferences.length === 0) {
    console.info(`No associated issues found in PR #${prRef.prNumber} description.`);
  } else {
    for (const issueRef of refIssueReferences) {
      // Only process issues from the same repository
      if (issueRef.owner === owner && issueRef.repo === repo) {
        const issue = await getIssueDetails(issueRef.owner, issueRef.repo, issueRef.issueNumber);
        if (issue) {
          const { labels: issueLabels, milestone: issueMilestone } = issue;

          if (!issueLabels || issueLabels.length === 0) {
            errors.push(`Associated issue #${issueRef.issueNumber} has no labels.`);
          }
          if (!issueMilestone) {
            errors.push(`Associated issue #${issueRef.issueNumber} has no milestone.`);
          }
        }
      } else {
        console.info(
          dim(`Issue #${issueRef.issueNumber} is from a different repository (${issueRef.owner}/${issueRef.repo}), skipping...`),
        );
      }
    }
    console.info(`PR #${prRef.prNumber} and all associated issues have labels and milestones.`);
  }
}

async function fixSnykPR(pr) {
  let title = pr.title;

  if (!title.startsWith('[Snyk]')) {
    return;
  }

  const validPrefixes = ['build:', 'build(dep):', 'build(deps):'];
  const lowerTitle = title.toLowerCase();
  const hasValidPrefix = validPrefixes.some((prefix) => lowerTitle.startsWith(prefix));

  if (!hasValidPrefix) {
    title = `build(dep): ${title}`;
    console.info(`Updating PR title to: ${title}`);
    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
        },
        body: JSON.stringify({ title }),
      },
    );
  }

  const labelExists = pr.labels && pr.labels.some((label) => label.name.toLowerCase() === 'dependencies');
  if (!labelExists) {
    console.info("Adding 'dependencies' label to the PR");
    // Github API uses /issues both for issues and PRs since they use the same sequence
    await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/labels`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
        },
        body: JSON.stringify({ labels: ['dependencies'] }),
      },
    );
  }
}

async function main() {
  const pr = await getPRDetails(GITHUB_PR_NUMBER);
  if (!pr) {
    throw new Error(`PR #${GITHUB_PR_NUMBER} not found.`);
  }

  await fixSnykPR(pr);
  const errors = [];

  await checkPRLabelsAndMilestone(pr, errors);

  if (isDependabotOrSnykPR(pr)) {
    console.info(dim('Dependabot or snyk PR detected. Skipping issue reference requirement.'));
    return;
  }

  const cleanBody = cleanText(pr.body);
  await processIssueReferencesInText(cleanBody, errors);

  const contributors = await getContributors();
  await processPRReferencesInText(cleanBody, contributors, errors);

  if (errors.length > 0) {
    console.info(yellow('PR validation failed with the following errors:'));
    errors.forEach((error) => console.info(yellow(`- ${error}`)));
    process.exit(2);
  }

  console.info(blue('All checks completed.'));
}

main().catch((error) => {
  console.error(red(error.message));
  process.exit(1);
});
