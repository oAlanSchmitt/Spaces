# 0186: Shared space knowledge and local project work

Date: 2026-11-16

Status: Accepted for the Spaces fork

## Context

Spaces initially used one native organization per project, a protected metadata coordinator and a subscription transport limited to JSON tool proposals. Spaces were navigation groups and project folders were briefing metadata. The owner now wants common knowledge across projects in a space, and development and image generation within the project's conversation.

Native organizations already provide project boundaries. The Codex runner already handles sessions, cancellation, native tool events, generated images and usage. Replacing those mechanisms or moving every project into one organization would create a larger migration than the requested behavior needs.

## Decision

The visible hierarchy is Area → Space → Project. Existing table names, identifiers and routes remain compatible.

Shared entries are canonical records explicitly bound to a space in its control organization. Existing records remain local to their project. Approved team-visible entries from a project's own space are composed with its local approved entries. Owner-only, proposed and archived entries are excluded from agent retrieval. Context receipts retain entry identity and revision. Changes invalidate old snapshots and derived contexts. Source review and publication serialize on consistently ordered workspace locks.

The protected model remains the coordinator. A server-owned internal work tool delegates to the existing Codex runner classes. This avoids inventing native machine/account pairings across the current project organizations. It has a separate named permission profile, explicit local account/host/project/folder binding, persistent revision and per-turn receipt. It receives authorized project context and returns artifacts to the same conversation. An ambiguous interrupted turn is inspected before new work rather than automatically repeating its effects.

Folder association is explicit and distinct from an optional exported briefing reference. Paths must exist, resolve canonically, exclude private server/account/system directories, and avoid overlap with another project's binding. Work is available only with a compatible subscription and a confinement proof matching the current executable, launch configuration, host and root. The old read-only proof cannot enable this profile. No API-key fallback is introduced.

Generated images use the runner's existing native image events. Actual availability and quota depend on the installed CLI and account. A missing result or unsupported image delivery must surface an error instead of a success claim.

## Consequences

Projects share a space's approved knowledge without copying it, while keeping conversations, private entries and work roots separate. The owner can request work from the project conversation and receive persistent files there. Browser access, publishing, arbitrary connectors, automatic routines and dependency installation remain outside this work profile.

Filesystem effects already performed are not rolled back when a source changes or a run is cancelled. Revalidation prevents further publication and reuse of revoked context. A finite confinement test verifies observed operations, not a universal defense against a process with the owner's own Windows privileges. Human acceptance and real-client use remain separate from synthetic tests.

The optional briefing export is retained as an auxiliary handoff. It does not grant filesystem access or synchronize copies. Specialists consulted during development do not become installed application agents automatically.
