#!/usr/bin/env bash
# Convenience script to remove backend/.env using git-filter-repo

if [ -z "$1" ]; then
  echo "Usage: $0 <repo-url>"
  exit 1
fi

REPO_URL=$1
WORKDIR=$(mktemp -d)
echo "Cloning mirror to $WORKDIR"
git clone --mirror "$REPO_URL" "$WORKDIR/repo-mirror.git"
cd "$WORKDIR/repo-mirror.git" || exit 1

echo "Removing backend/.env from history..."
git filter-repo --invert-paths --paths backend/.env

echo "Pushing rewritten history (force)..."
git push --force

echo "Done. Please coordinate with team to re-clone repository and rotate secrets."
