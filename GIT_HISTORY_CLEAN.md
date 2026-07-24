# How to remove sensitive files from Git history

Follow these steps to safely remove `backend/.env` or other sensitive files from repository history.

Important: rewriting history requires force-push and coordination with the team. Everyone must re-clone after this.

Option A - git-filter-repo recommended:

```bash
# Clone a mirror
git clone --mirror <repo-url> repo-mirror.git
cd repo-mirror.git

# Remove the file
git filter-repo --invert-paths --paths backend/.env

# Push rewritten history
git push --force
```

Option B - BFG:

```bash
# Create a bare mirror clone
git clone --mirror <repo-url> repo-mirror.git
cd repo-mirror.git

# Use BFG to remove the file
bfg --delete-files backend/.env

# Clean up and push
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force
```

After rewriting history:

```bash
# Notify the team and then everyone should re-clone
git clone <repo-url>
```

Immediately rotate any secrets removed from the repo. Treat them as compromised, including `JWT_SECRET`, `INITIAL_*` passwords, OAuth client secrets, database URLs and backup keys.
