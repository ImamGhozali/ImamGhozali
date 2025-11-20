import fs from "fs";
import fetch from "node-fetch";

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
  const query = `
  {
    viewer {
      name
      login
      followers { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC) {
        nodes {
          stargazerCount
          forkCount
          languages(first: 10) {
            edges { size node { name } }
          }
        }
      }
      privateRepos: repositories(first: 100, ownerAffiliations: OWNER, privacy: PRIVATE) {
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

- Total Stars (public + private): **${stars}**
- Total Forks (public + private): **${forks}**
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
