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
      repositories(ownerAffiliations: [OWNER, ORGANIZATION_MEMBER]) {
        totalCount
      }
      organizations {
        totalCount
      }
    }
  }
  `;

  const countData = await gql(countQuery);
  const totalRepoCount = countData.viewer.repositories.totalCount;
  const orgCount = countData.viewer.organizations.totalCount;

  // Second query to get repository details (up to 100 repos)
  const query = `
  {
    viewer {
      name
      login
      followers { totalCount }
      repositories(first: 100, ownerAffiliations: [OWNER, ORGANIZATION_MEMBER], privacy: PUBLIC) {
        nodes {
          stargazerCount
          forkCount
          languages(first: 10) {
            edges { size node { name } }
          }
        }
      }
      privateRepos: repositories(first: 100, ownerAffiliations: [OWNER, ORGANIZATION_MEMBER], privacy: PRIVATE) {
        nodes {
          stargazerCount
          forkCount
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

  const allRepos = [...v.repositories.nodes, ...v.privateRepos.nodes];

  const stars = allRepos.reduce((s, r) => s + r.stargazerCount, 0);
  const forks = allRepos.reduce((s, r) => s + r.forkCount, 0);

  const langMap = {};
  for (const repo of allRepos) {
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

  const md = `
**GitHub Stats for @${v.login}**

- Total Repositories (personal + org): **${totalRepoCount}**
- Total Stars (from ${allRepos.length} repos): **${stars}**
- Total Forks (from ${allRepos.length} repos): **${forks}**
- Organizations: **${orgCount}**
- Followers: **${v.followers.totalCount}**
- Top Languages: ${topLangs}

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
