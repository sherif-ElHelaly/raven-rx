# Running Raven Rx from an iPhone

Live app: https://sherif-elhelaly.github.io/raven-rx/

## Getting app updates

- When a new version is published, the app notices it next time you switch
  back to it and shows **"A new version is ready"** at the top. Tap **Update**.
- To check by hand: **Settings → App version → Check for updates**.
- The version line in Settings (date · code) tells you exactly which build
  you are running. The code matches the commit on GitHub.
- Nothing reloads by itself, so you never lose a half-filled form.

## Backing up

- **Home** shows a **Back up now** button if you have never backed up, or it
  has been more than 7 days.
- Tapping it (or **Settings → Export backup**) opens the share sheet. Tap
  **Save to Files → iCloud Drive** (make a `Raven Rx backups` folder once).
- Settings shows the date of your last backup.

## Restoring

1. **Settings → Restore from backup…**
2. Pick the `.json` file from **Files → iCloud Drive**.
3. Confirm **Replace everything**. This replaces all data on this phone.

Back up before deleting the home-screen icon. On iPhone, removing the icon
deletes the app's data.

## Changing the code and redeploying (no PC)

Every change that lands on the `main` branch deploys automatically: the tests
run, the site rebuilds, and the app offers the update within a few minutes.
You can follow progress in the repo's **Actions** tab (green check = live).

**Option A: ask Claude (recommended for real changes)**
1. Open the Claude app (or claude.ai/code in Safari) and pick **Code**.
2. Connect GitHub once and choose the `raven-rx` repo.
3. Describe the change. Claude works on a branch and opens a pull request.
4. In the GitHub app/website, open the pull request → **Merge**. That deploys.

**Option B: small text edits on github.com**
1. Open the repo in Safari → find the file → tap the **pencil** (Edit).
2. Make the change → **Commit changes** → commit directly to `main`.

If a deploy fails (red ✗ in Actions), the live app stays on the last good
version. Open the failed run to see why.
