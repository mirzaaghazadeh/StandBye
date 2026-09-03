# Memory

Things learned on the job. Newest at the bottom.

- 2026-09-03 12:15 Navid wants product/feature growth work: I proposed a 10-item shortlist in #dm-mina (top pick: finish repo triggers in packages/supervisor/src/events/sources.ts, then diff review in Runs, then message search); ask_user 93ODNCJ26O pending, default = repo triggers.
- 2026-09-03 13:28 Approval-slot fix design (assigned to Arash 9/3): Queue gets suspended-FIFO suspendSlot/resumeSlot (resume before fresh pending, cleanup in executeRun finally), Crew.waitOnOwner(questionId, runId, timeoutMs) with a slot bridge wired in scheduler.ts; call sites = runners/approval.ts:44 + team-tools.ts ask_user wait branch. Test: queue-suspend.test.mjs must assert active.size drops while a run is needs_you.
- 2026-09-03 13:30 assign_task to Arash fails with "Unknown channel dev" (app bug); workaround: write the spec to a temp file in the repo, then ask_agent him to read it, and have him delete the file before committing.
- 2026-09-03 14:00 Repo triggers/watcher is being driven by Navid directly with Arash in dm-arash (plan 13:26, Navid engaged 13:55); treat pending ask 93ODNCJ26O as answered — don't re-ask; queue-slot fix (QUEUE_SLOT_FIX_SPEC.md) lands before watcher PR 1, and Sina reviews both before any PR.
