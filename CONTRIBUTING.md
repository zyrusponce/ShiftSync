# Working on ShiftSync

The app lives in [`shiftsync/`](shiftsync/). `main` deploys to Render automatically, so anything merged there is live within minutes.

## The routine

1. **Work on a branch, not on `main`.** `git switch -c short-description`
2. **Commit small and often.** One change per commit, with a message that says why. Several commits a day beats one large commit at the end of the week: small commits are easy to review, easy to undo, and nothing is lost if your laptop dies.
3. **Check before you push.** From `shiftsync/`:
   ```bash
   npm run format    # fix formatting
   npm run check:all # typecheck and every test, app and server
   ```
4. **Push, and wait for CI to pass.** GitHub runs the same checks on every push. A red ❌ next to the commit means it is not ready to merge.
5. **Merge into `main` only when CI is green.** Open a pull request on GitHub, or, when the branch already contains everything on `main`:
   ```bash
   git push origin your-branch:main
   ```

## Keep `git status` short

If `git status` lists dozens of files, commit what's finished before starting something new. A long list of uncommitted changes is how unrelated work ends up mixed into one commit.

Your personal notes (`Mark down/`, `frontendAdjustment/`, `docs/`) and Claude Code transcripts are ignored on purpose. They stay on your computer and never reach the repository.

## Old history

The former `master` branch is archived as the tag `archive/master`. It holds an earlier version of `Mark down/aiIntegration.md` that exists nowhere else. To get that file back:

```bash
git show "archive/master:Mark down/aiIntegration.md" > aiIntegration-old.md
```
