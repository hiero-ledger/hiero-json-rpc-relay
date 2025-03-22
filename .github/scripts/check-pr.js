const axios = require('axios');

const githubToken = process.env.GITHUB_TOKEN;
const { GITHUB_REPOSITORY, GITHUB_PR_NUMBER } = process.env;

const [owner, repo] = GITHUB_REPOSITORY.split('/');

async function getPRDetails(prNumber) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `token ${githubToken}`,
      },
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`PR #${prNumber} not found in repository ${owner}/${repo}, skipping...`);
      return null;
    } else {
      throw error;
    }
  }
}

async function getIssueDetails(issueOwner, issueRepo, issueNumber) {
  try {
    const url = `https://api.github.com/repos/${issueOwner}/${issueRepo}/issues/${issueNumber}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `token ${githubToken}`,
      },
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`Issue #${issueNumber} not found in repository ${issueOwner}/${issueRepo}, skipping...`);
      return null;
    } else {
      throw error;
    }
  }
}

async function getContributors() {
  const url = `https://api.github.com/repos/${owner}/${repo}/contributors`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `token ${githubToken}`,
    },
  });
  return response.data;
}

function stripHTMLTags(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, '');
}

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

function cleanText(text) {
  let cleanText = text;
  cleanText = stripHTMLTags(cleanText);
  cleanText = removeCodeBlocks(cleanText);
  return cleanText;
}

async function checkPRLabelsAndMilestone(pr) {
  const { labels: prLabels, milestone: prMilestone } = pr;

  if (!prLabels || prLabels.length === 0) {
    throw new Error('The PR has no labels.');
  }
  if (!prMilestone) {
    throw new Error('The PR has no milestone.');
  }
}

function isDependabotOrSnykPR(pr) {
  return pr.user.login === 'dependabot[bot]' || pr.user.login === 'swirlds-automation';
}

async function processIssueReferencesInText(text) {
  const issueReferences = extractIssueReferences(text);

  let hasValidIssueReference = false;

  if (issueReferences.length > 0) {
    for (const issueRef of issueReferences) {
      // Only process issues from the same repository
      if (issueRef.owner === owner && issueRef.repo === repo) {
        hasValidIssueReference = true;
        const issue = await getIssueDetails(issueRef.owner, issueRef.repo, issueRef.issueNumber);
        if (issue) {
          const { labels: issueLabels, milestone: issueMilestone } = issue;

          if (!issueLabels || issueLabels.length === 0) {
            throw new Error(`Associated issue #${issueRef.issueNumber} has no labels.`);
          }
          if (!issueMilestone) {
            throw new Error(`Associated issue #${issueRef.issueNumber} has no milestone.`);
          }
        }
      } else {
        console.log(
          `Issue #${issueRef.issueNumber} is from a different repository (${issueRef.owner}/${issueRef.repo}), skipping...`,
        );
      }
    }

    if (!hasValidIssueReference) {
      throw new Error('The PR description must reference at least one issue from the current repository.');
    } else {
      console.log('All associated issues have labels and milestones.');
    }
  } else {
    throw new Error('The PR description must reference at least one issue from the current repository.');
  }
}

async function processPRReferencesInText(text, contributors) {
  const prReferences = extractPRReferences(text);

  if (prReferences.length === 0) {
    console.log('No associated PRs found in PR description.');
  } else {
    for (const prRef of prReferences) {
      // Only process PRs from the same repository
      if (prRef.owner === owner && prRef.repo === repo) {
        await processReferencedPR(prRef, contributors);
      } else {
        console.log(`PR #${prRef.prNumber} is from a different repository (${prRef.owner}/${prRef.repo}), skipping...`);
        // Skip processing issue references from external PRs
      }
    }
  }
}

async function processReferencedPR(prRef, contributors) {
  // Attempt to fetch the PR to validate its existence
  const referencedPR = await getPRDetails(prRef.prNumber);
  if (!referencedPR) {
    console.log(`PR #${prRef.prNumber} does not exist, skipping...`);
    return; // Skip if PR not found
  }

  const authorLogin = referencedPR.user.login;

  const isContributor = contributors.some((contributor) => contributor.login === authorLogin);

  if (!isContributor) {
    console.log(`PR author ${authorLogin} is not a contributor, skipping issue matching for PR #${prRef.prNumber}.`);
    return;
  }

  // Clean the referenced PR body
  const refPrBody = cleanText(referencedPR.body);

  // Extract issue references from the referenced PR description
  const refIssueReferences = extractIssueReferences(refPrBody);

  if (refIssueReferences.length === 0) {
    console.log(`No associated issues found in PR #${prRef.prNumber} description.`);
  } else {
    for (const issueRef of refIssueReferences) {
      // Only process issues from the same repository
      if (issueRef.owner === owner && issueRef.repo === repo) {
        const issue = await getIssueDetails(issueRef.owner, issueRef.repo, issueRef.issueNumber);
        if (issue) {
          const { labels: issueLabels, milestone: issueMilestone } = issue;

          if (!issueLabels || issueLabels.length === 0) {
            throw new Error(`Associated issue #${issueRef.issueNumber} has no labels.`);
          }
          if (!issueMilestone) {
            throw new Error(`Associated issue #${issueRef.issueNumber} has no milestone.`);
          }
        }
      } else {
        console.log(
          `Issue #${issueRef.issueNumber} is from a different repository (${issueRef.owner}/${issueRef.repo}), skipping...`,
        );
      }
    }
    console.log(`PR #${prRef.prNumber} and all associated issues have labels and milestones.`);
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
    console.log(`Updating PR title to: ${title}`);
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}`;
    await axios.patch(
      url,
      { title },
      {
        headers: {
          Authorization: `token ${githubToken}`,
        },
      },
    );
  }

  const labelExists = pr.labels && pr.labels.some((label) => label.name.toLowerCase() === 'dependencies');
  if (!labelExists) {
    console.log("Adding 'dependencies' label to the PR");
    // Github API uses /issues both for issues and PRs since they use the same sequence
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/labels`;
    await axios.post(
      url,
      { labels: ['dependencies'] },
      {
        headers: {
          Authorization: `token ${githubToken}`,
        },
      },
    );
  }
}

async function run() {
  try {
    const pr = await getPRDetails(GITHUB_PR_NUMBER);
    if (!pr) {
      throw new Error(`PR #${GITHUB_PR_NUMBER} not found.`);
    }

    await checkPRLabelsAndMilestone(pr);

    if (isDependabotOrSnykPR(pr)) {
      console.log('Dependabot or snyk PR detected. Skipping issue reference requirement.');
      await fixSnykPR(pr);
      return;
    } else {
      const cleanBody = cleanText(pr.body);
      await processIssueReferencesInText(cleanBody);
    }

    const contributors = await getContributors();

    const cleanBody = cleanText(pr.body);
    await processPRReferencesInText(cleanBody, contributors);

    console.log('All checks completed.');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

run();
