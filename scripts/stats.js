import fs from "fs";
import fetch from "node-fetch";

// Log environment variables for debugging
console.log("GH_USER:", process.env.GH_USER);  // Should print the username
console.log("GH_TOKEN:", process.env.GH_TOKEN);  // Should print the token (use caution)

const user = process.env.GH_USER;
const token = process.env.GH_TOKEN;

if (!user || !token) {
  console.error("Missing GH_USER or GH_TOKEN");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function gql(query) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });

  const json = await res.json();
  if (json.errors) {
    console.error("GraphQL Errors:", json.errors);
    process.exit(1);
  }
  return json.data;
}

async function main() {
  // First query to get total counts
  const countQuery = `
  {
    viewer {
      name
      login
      followers { totalCount }
      ownedRepos: repositories(ownerAffiliations: OWNER) {
        totalCount
      }
      orgRepos: repositories(ownerAffiliations: ORGANIZATION_MEMBER) {
        totalCount
      }
      organizations(first: 100) {
        totalCount
      }
    }
  }
  `;

  const countData = await gql(countQuery);
  const totalRepoCount = countData.viewer.ownedRepos.totalCount + countData.viewer.orgRepos.totalCount;
  const orgCount = countData.viewer.organizations.totalCount;
  
  console.log(`Owned repos: ${countData.viewer.ownedRepos.totalCount}`);
  console.log(`Org repos: ${countData.viewer.orgRepos.totalCount}`);
  console.log(`Total repos: ${totalRepoCount}`);
  console.log(`Organizations: ${orgCount}`);

  // Second query to get repository details with contribution data
  const query = `
  {
    viewer {
      name
      login
      followers { totalCount }
      contributionsCollection {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        restrictedContributionsCount
      }
      ownedPublic: repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          name
          stargazerCount
          forkCount
          isPrivate
          isFork
          defaultBranchRef {
            target {
              ... on Commit {
                history {
                  totalCount
                }
              }
            }
          }
          pullRequests(states: [OPEN, CLOSED, MERGED]) {
            totalCount
          }
          languages(first: 10) {
            edges { size node { name } }
          }
        }
      }
      ownedPrivate: repositories(first: 100, ownerAffiliations: OWNER, privacy: PRIVATE, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          name
          stargazerCount
          forkCount
          isPrivate
          isFork
          defaultBranchRef {
            target {
              ... on Commit {
                history {
                  totalCount
                }
              }
            }
          }
          pullRequests(states: [OPEN, CLOSED, MERGED]) {
            totalCount
          }
          languages(first: 10) {
            edges { size node { name } }
          }
        }
      }
      orgPublic: repositories(first: 100, ownerAffiliations: ORGANIZATION_MEMBER, privacy: PUBLIC, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          name
          stargazerCount
          forkCount
          isPrivate
          isFork
          defaultBranchRef {
            target {
              ... on Commit {
                history {
                  totalCount
                }
              }
            }
          }
          pullRequests(states: [OPEN, CLOSED, MERGED]) {
            totalCount
          }
          languages(first: 10) {
            edges { size node { name } }
          }
        }
      }
      orgPrivate: repositories(first: 100, ownerAffiliations: ORGANIZATION_MEMBER, privacy: PRIVATE, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          name
          stargazerCount
          forkCount
          isPrivate
          isFork
          defaultBranchRef {
            target {
              ... on Commit {
                history {
                  totalCount
                }
              }
            }
          }
          pullRequests(states: [OPEN, CLOSED, MERGED]) {
            totalCount
          }
          languages(first: 10) {
            edges { size node { name } }
          }
        }
      }
    }
  }
  `;

  const data = await gql(query);
  const v = data.viewer;

  const allRepos = [
    ...v.ownedPublic.nodes,
    ...v.ownedPrivate.nodes,
    ...v.orgPublic.nodes,
    ...v.orgPrivate.nodes
  ];

  // Filter repos where user has actually contributed
  // For owned repos, we assume contribution. For org repos, check if there are commits
  const contributedRepos = allRepos.filter(repo => {
    // If it's an owned repo, include it
    const isOwned = v.ownedPublic.nodes.includes(repo) || v.ownedPrivate.nodes.includes(repo);
    if (isOwned) return true;
    
    // For org repos, only include if there are commits in default branch
    const commitCount = repo.defaultBranchRef?.target?.history?.totalCount || 0;
    return commitCount > 0;
  });

  console.log(`Total repos fetched: ${allRepos.length}`);
  console.log(`Repos with contributions: ${contributedRepos.length}`);

  // Calculate stats from contributed repos
  const stars = contributedRepos.reduce((s, r) => s + r.stargazerCount, 0);
  const forks = contributedRepos.reduce((s, r) => s + r.forkCount, 0);
  
  // Calculate total commits across contributed repos
  const totalCommits = contributedRepos.reduce((sum, repo) => {
    return sum + (repo.defaultBranchRef?.target?.history?.totalCount || 0);
  }, 0);

  // Count total PRs across contributed repos
  const totalPRs = contributedRepos.reduce((sum, repo) => {
    return sum + (repo.pullRequests?.totalCount || 0);
  }, 0);

  // Separate owned vs org repos
  const ownedContributed = contributedRepos.filter(r => 
    v.ownedPublic.nodes.includes(r) || v.ownedPrivate.nodes.includes(r)
  );
  const orgContributed = contributedRepos.filter(r => 
    v.orgPublic.nodes.includes(r) || v.orgPrivate.nodes.includes(r)
  );

  // Count forks
  const forkedRepos = contributedRepos.filter(r => r.isFork).length;

  // Language statistics from contributed repos
  const langMap = {};
  for (const repo of contributedRepos) {
    for (const edge of repo.languages.edges) {
      const lang = edge.node.name;
      langMap[lang] = (langMap[lang] || 0) + edge.size;
    }
  }

  const totalBytes = Object.values(langMap).reduce((a, b) => a + b, 0);
  const topLangs = Object.entries(langMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, bytes]) => `${name} (${Math.round(bytes / totalBytes * 100)}%)`)
    .join(", ") || "—";

  const contributions = v.contributionsCollection;

  const md = `
**GitHub Stats for @${v.login}**

### 📊 Repository Statistics
- **Total Repositories**: ${totalRepoCount} (${countData.viewer.ownedRepos.totalCount} owned, ${countData.viewer.orgRepos.totalCount} org)
- **Repositories with Contributions**: ${contributedRepos.length} (${ownedContributed.length} owned, ${orgContributed.length} org)
- **Forked Repositories**: ${forkedRepos}
- **Total Stars Earned**: ⭐ ${stars}
- **Total Forks**: 🍴 ${forks}

### 💻 Contribution Statistics
- **Total Commits**: ${contributions.totalCommitContributions.toLocaleString()} (this year)
- **Total Commits in Repos**: ${totalCommits.toLocaleString()} (all time in fetched repos)
- **Pull Requests**: ${contributions.totalPullRequestContributions} (this year)
- **Issues Opened**: ${contributions.totalIssueContributions} (this year)
- **Code Reviews**: ${contributions.totalPullRequestReviewContributions} (this year)

### 🌐 Community
- **Organizations**: ${orgCount}
- **Followers**: ${v.followers.totalCount}

### 🔤 Top Languages
${topLangs}

_Last updated: ${new Date().toISOString()}_
  `;

  let readme = fs.readFileSync("README.md", "utf8");
  readme = readme.replace(
    /<!--GITHUB_STATS_START-->[\s\S]*<!--GITHUB_STATS_END-->/,
    `<!--GITHUB_STATS_START-->\n${md}\n<!--GITHUB_STATS_END-->`
  );
  fs.writeFileSync("README.md", readme);
  console.log("README updated with stats");
}

main();
