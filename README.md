# Stockdesk

## Free hosting mode

`vercel.json` sets `git.deploymentEnabled` to `false`. GitHub pushes no longer automatically deploy, including code changes. This prevents frequent JSON data commits from exhausting Vercel Hobby deployment limits. Existing production hosting and scheduled function invocations remain unchanged.

Data stays in `data/` on the default branch. `/api/picks-data` reads GitHub at request time; new data does not need a rebuild. Keep `GH_REPO` and `GH_TOKEN` configured for Production. Never commit tokens.

When code changes are ready, create a new Production deployment from the latest `main` in the Vercel dashboard after the quota recovers. Redeploying an old deployment reuses its old commit. Verify the deployed commit and data endpoints afterward.

This change does not reset an already exhausted quota, reduce function/AI usage, or guarantee all services are free. Do not remove existing scheduler jobs without checking their purpose.

To restore commit-triggered deployment, change `git.deploymentEnabled` to `true`. Do this only after separating high-frequency data commits from deployment triggers.
