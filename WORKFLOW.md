# PageSnap Team Workflow

## Code Workflow
1. All code is built in `/home/team/shared/pagesnap/` — this is the shared workspace
2. Members write code independently in their assigned areas
3. When a member completes their task, they submit it for review via `finish_task`
4. The lead reviews submitted work and provides feedback
5. Once approved, code is considered part of the codebase

## Branch Strategy
- Since this is a shared filesystem workspace, members write to their assigned directory paths
- No Git branches needed for initial build phase
- Repo connection: `chiragsd-coding/Website-Screenshot-API` — once the initial build is complete, we'll create PRs to push to GitHub

## Review Process
1. Submit work via `finish_task` with a summary of what was built
2. Lead reviews for correctness, completeness, and code quality
3. If approved → goes to done, artifacts are preserved
4. If rejected → sent back with specific feedback, member resumes work

## Dependencies Between Team Members
- **DevOps Engineer** scaffolds the project (package.json, tsconfig) — members must wait for this before they can compile
- **Screenshot Engineer** builds standalone modules — no hard dependency on other members
- **API & Billing Engineer** builds payment gateways (standalone) and API layer that imports from screenshot-engine

## Communication
- Use `send_message(to="lead", ...)` to communicate with the lead
- Check your inbox for messages from the lead
- All non-code artifacts go in `/home/team/shared/`