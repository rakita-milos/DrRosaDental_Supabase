# How to remove sensitive files from Git history

Follow these steps to safely remove `backend/.env` (or other sensitive files) from the repository history.

Important: rewriting history requires force-push and coordination with your team. Everyone must re-clone after this.

Option A — git-filter-repo (recommended):

```bash
# Clone a mirror
git clone --mirror <repo-url> repo-mirror.git
cd repo-mirror.git

# Remove the file(s)
git filter-repo --invert-paths --paths backend/.env

# Push rewritten history
git push --force
```

Option B — BFG (easier for basic cases):

```bash
# Create a bare mirror clone
git clone --mirror <repo-url> repo-mirror.git
cd repo-mirror.git

# Use BFG to remove the file
bfg --delete-files backend/.env

# Clean up and push
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force
```

After rewriting history:

```bash
# Notify team and then everyone should re-clone
git clone <repo-url>
```

Rotation: Immediately rotate any secrets removed from the repo (JWT_SECRET, INITIAL_* passwords, backup keys). Treat them as compromised.
