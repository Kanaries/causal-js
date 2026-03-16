#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { loadManifests } = require("./lib/manifests.cjs");

function parseArgs(argv) {
  const args = {
    repo: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
    outputDir: undefined,
    limit: 10,
    artifactNames: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--repo") {
      args.repo = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--token") {
      args.token = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--output-dir") {
      args.outputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--limit") {
      args.limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--artifact") {
      args.artifactNames.push(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "causal-js-parity-history"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function githubBuffer(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "causal-js-parity-history"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`GitHub artifact download failed (${response.status}) for ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function listArtifacts(repo, token, artifactNames, limit) {
  const artifacts = [];
  let page = 1;
  const targetNames = artifactNames.length > 0 ? new Set(artifactNames) : null;

  while (artifacts.length < limit) {
    const payload = await githubJson(
      `https://api.github.com/repos/${repo}/actions/artifacts?per_page=100&page=${page}`,
      token
    );
    const pageArtifacts = payload.artifacts ?? [];
    if (pageArtifacts.length === 0) {
      break;
    }

    for (const artifact of pageArtifacts) {
      if (artifact.expired) {
        continue;
      }
      if (targetNames && !targetNames.has(artifact.name)) {
        continue;
      }
      artifacts.push(artifact);
      if (artifacts.length >= limit) {
        break;
      }
    }

    page += 1;
  }

  return artifacts
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, limit);
}

function ensureCleanDir(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function unzipArchive(zipPath, targetDir) {
  const result = spawnSync("unzip", ["-oq", zipPath, "-d", targetDir], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(`Failed to unzip ${zipPath}.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const manifests = loadManifests();
  const args = parseArgs(argv);

  if (!args.repo) {
    throw new Error("Missing GitHub repository. Pass --repo or set GITHUB_REPOSITORY.");
  }
  if (!args.token) {
    throw new Error("Missing GitHub token. Pass --token or set GITHUB_TOKEN/GH_TOKEN.");
  }

  const outputDir =
    args.outputDir ??
    path.join(manifests.root, "parity", "results", "imported", "github-artifacts");
  ensureCleanDir(outputDir);

  const artifacts = await listArtifacts(args.repo, args.token, args.artifactNames, args.limit);

  for (const artifact of artifacts) {
    const targetDir = path.join(outputDir, `${artifact.id}-${artifact.name}`);
    fs.mkdirSync(targetDir, { recursive: true });

    const zipPath = path.join(targetDir, "artifact.zip");
    const archiveBuffer = await githubBuffer(artifact.archive_download_url, args.token);
    fs.writeFileSync(zipPath, archiveBuffer);
    unzipArchive(zipPath, targetDir);
    fs.rmSync(zipPath, { force: true });

    fs.writeFileSync(
      path.join(targetDir, "artifact-metadata.json"),
      `${JSON.stringify(
        {
          id: artifact.id,
          name: artifact.name,
          createdAt: artifact.created_at,
          updatedAt: artifact.updated_at,
          expiresAt: artifact.expires_at,
          workflowRunId: artifact.workflow_run?.id ?? null,
          repo: args.repo
        },
        null,
        2
      )}\n`
    );
  }

  console.log(
    `Fetched ${artifacts.length} GitHub artifact(s) into ${outputDir}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  main
};
