# Testing

## 1. Automated

| Suite | Command | Covers | Last result |
|---|---|---|---|
| Server logic | `npm run test:functions` | IST dates, streak with protection tokens, mastery formula and bands, grading of all five question types, spin cooldown and weights, AI validation and crisis notice, fallback variation and hint progression, badges, invite codes, `computeOutcome` ledgers and balances, lesson and chapter completion, first-correct payout, session caps, redemption failures and success, spin replay protection, assessment period keys, deterministic paper building with bucket borrowing, grading with unanswered-as-wrong, ownership and double-submit guards, Buddy ranking and gender preference, request guards and contact-sharing filter, accept and decline, unmatch, room state machine with per-participant credit and idempotent stop, challenge validation, progress, one-time payout and expiry, group creation and validation (subject whitelist, exam mismatch, contact filter), staff-only edits, join requests and approval with capacity, invite codes (revoked, expired, used up, full), invitations, role changes with owner-only transfer, member removal limits, owner handover and archive on leave, discussion filter and announcement rights, reaction toggling, helpful marks, moderation, reports, group room credit, group-total challenge payout | 61 passed (2026-09-19) |
| Demo shims and callables | `npm test` | Firestore shim queries, four-subject invariant, auth shim (wrong password, duplicate email, Google-style account), engine-generated seed history with ledger consistency, `submitAnswer` grading and idempotency, `completeLesson` chapter completion, `recordStudySession` caps and streak, `redeemReward` stock and coin invariants, `spinWheel` cooldown, `askAi` variation, persistence and support notice, one daily paper per period with resume, grading, replay and cross-user rejection, Buddy match, request, accept, room from both accounts, challenge and unmatch, Groups end to end (request and approve, owner transfer, filtered posts, reactions, moderation, code join, session, challenge, leave with handover), `deleteAccount` | 17 passed (2026-09-19) |
| Content | `npm run seed:check` | Referential integrity, exact subject whitelist, slugs, question types vs keys, JEE/NEET subject rules, reward stock and prices; 10 chapters, 29 topics, 38 lessons, 231 questions | passed (2026-09-19) |
| Firestore rules | `firebase emulators:exec --only firestore "npm run test:rules"` | Every "a student cannot" case from spec section 99 plus admin limits | **Not run in build environment** (no emulator or Java) |
| Typecheck and build | `npm run typecheck`, `vite build --mode demo` | Frontend and Functions types, production bundle | passed (2026-09-19) |

## 2. Manual matrix (spec sections 98 and 99)

Verified column: **Demo** means checked in the browser against the in-browser demo (same engine code as the server, no network); **Not run** means it needs a real Firebase project.

### Authentication
| Case | Expected | Verified |
|---|---|---|
| Signup with email | Account created, verification email sent, redirected to onboarding | Demo |
| Onboarding | Class, path, subjects (path-restricted), daily goal, language, level saved; dashboard opens | Demo |
| Login, wrong password | Clear error, no navigation | Automated (demo tests) |
| Google sign-in | Popup, profile completion when no user doc | Automated (simulated popup in demo tests) |
| Visit /login while signed in | Redirect to /dashboard | Demo |
| Visit protected route signed out | Redirect to /login, return to the requested route after login | Demo |
| Forgot password | Reset email sent | Not run |
| Email verification link | emailVerified becomes true, banner disappears | Not run |
| Logout then login | Same profile, XP, coins, streak, mastery | Demo |
| Session persistence | Refresh keeps the session | Demo |

### Learning
| Case | Expected | Verified |
|---|---|---|
| Learn → Class → Subject → Chapter → Topic | Navigation with breadcrumbs, Preparing tags on unauthored chapters | Demo |
| Open a topic | Mastery unchanged | Demo |
| Complete a lesson | Completed tag, XP toast, lessonsCompleted +1, chapter progress bar | Automated (demo and functions tests) |
| Complete last lesson of a chapter | Chapter bonus XP and coins, chaptersCompleted +1 | Automated |
| Topic practice by difficulty | Filtered set, server-graded feedback, explanation, mastery shown | Demo |

### Practice
| Case | Expected | Verified |
|---|---|---|
| Filters | Class, subject, chapter, topic, difficulty, type narrow the set | Not run in browser (topic-level difficulty filter verified) |
| Random, Chapter, Mixed, Timed | Ordering as described; timer advances on expiry | Not run in browser |
| Weak Topic mode with no ratings | Honest empty state | Not run in browser |
| Submit wrong answer | Correct answer and explanation, no reward | Demo |
| Submit correct answer | Reward once; repeat correct pays nothing | Demo (first payout) + Automated (repeat pays nothing) |

### Assessments
| Case | Expected | Verified |
|---|---|---|
| Start daily assessment | 10-question paper built from class and subjects; Start again returns the same paper | Demo |
| Answer, navigate away, return | Draft restored from this device; Resume shown on the catalogue | Demo |
| Submit | Score, accuracy, time, strong and weak topics, recommendations, per-question review with explanations; XP and coins paid; streak counted | Demo |
| Submit again or open Start for the same period | Stored result, no second payout | Automated (demo tests) |
| Topic test with too few questions | Honest "Not enough questions yet" error | Automated |
| Another student submits my attempt | Permission denied | Automated |
| Timer expiry auto-submits | Answers so far are graded | Not run in browser (logic in AssessmentRunPage) |
| JEE and NEET mocks | Gated on the student's goal; pool from Class 11 and 12 tagged questions | Demo (JEE mock starts with 30 questions from the three Class 11 chapters) |

### OrbitAI
| Case | Expected | Verified |
|---|---|---|
| Ask from a topic | Context banner, answer from topic content, conversation saved | Demo (fallback content) |
| Ask explain twice | Different explanation | Demo |
| Hint mode | Hints one at a time, never the answer | Automated (functions tests) |
| Crisis language | Support notice prepended | Automated (demo tests) |
| Gemini answer, daily limit, retry on failure | Real model answer, 40/day cap, Retry button | Not run (needs key) |

### Timer, rewards, calendar, projects
| Case | Expected | Verified |
|---|---|---|
| Timer start, pause, resume, refresh, stop | State survives refresh; whole minutes saved; streak day when 20 min reached | Demo (start, pause, refresh, reset) + Automated (minutes saved, caps, streak) |
| Spin | One spin, cooldown shown, second spin rejected | Demo |
| Redeem with enough coins | Coins deducted once, stock -1, redemption pending | Demo |
| Redeem without enough coins or stock | Error, nothing deducted | Automated (demo and functions tests) |
| Calendar day click | Study time, questions, accuracy, lessons, topics, XP, coins, streak | Demo |
| Project create, tasks, complete, notes, resources, delete | Persisted, progress recalculated | Demo (create, tasks, complete); notes, resources, delete not run in browser |

### Buddy
| Case | Expected | Verified |
|---|---|---|
| Preferences saved | Open flag, subjects, schedule, gender preference persisted | Demo |
| Candidates | Same class only, anonymous names, ranked with reasons; blocked and matched students hidden | Demo (ranking) + Automated (blocks, matched, gender) |
| Send request with a phone number | Refused with a clear message, nothing stored | Automated |
| Request, accept from the other account | Pair created, both profiles matched, live room seeded, notification | Demo |
| Room start, join from the other account, pause, resume, stop | Shared status on both sides, per-student time, stop records the session and credits minutes | Demo (under one minute, so 0 credited) + Automated (25 minute credit, replay-safe) |
| Challenge create and refresh | Progress from real activity; both must finish; paid once; expiry honoured | Demo (create, refresh) + Automated (completion, payout, expiry) |
| Unmatch | Pair ended, both free to match again, room closed | Demo |
| Block and report | Block ends the pair and hides both ways; report stored for moderators | Not run in browser (client writes validated by rules) |

### Groups
| Case | Expected | Verified |
|---|---|---|
| Discover and request to join a public group | Request stored; owner sees it under Requests and reports | Demo |
| Owner approves | Member added, member count updated | Demo |
| Join with invite code (case-insensitive) | Member added, uses incremented; bad, revoked, expired or used-up codes refused | Demo (valid code) + Automated (refusals) |
| Owner creates and revokes a code | Listed with uses and expiry | Demo (create) + Automated (revoke rights) |
| Invite by anonymous username; recipient accepts or declines | Invitation and notification; membership on accept | Automated |
| Roles | Only the owner sets roles; transfer demotes the old owner; admins cannot remove admins or the owner; members cannot self-promote | Automated |
| Post with a phone number or handle | Refused with a clear message | Demo |
| Post, reply, reaction toggle, helpful mark (not on own post), hide by staff | Persisted and reflected live | Demo (post, reaction, helpful) + Automated (reply, hide, own-post guard) |
| Group study session | Start, join, pause, resume, stop; each present member credited on stop | Demo (start) + Automated (credit) |
| Group challenge | Group total across members, paid once to contributors, expiry honoured | Automated |
| Leave | Ownership handed to earliest admin or member, or group archived when empty | Automated |

### Security (spec 99)
| Case | Expected | Verified |
|---|---|---|
| Client writes to users.xp, coins, role, streaks, topicMastery, questionAttempts, ledgers, redemptions, rewards | Permission denied | Rules written; **Not run** (emulator) |
| Read another student's users or topicMastery | Permission denied | Rules written; **Not run** |
| Read questionKeys | Permission denied | Rules written; **Not run** |
| Register with role admin, non-zero coins or a subject outside the four | Permission denied | Rules written; **Not run** |
| Create groupMembers with role owner, or promote self | Permission denied | Rules written; **Not run** |
| Replay a submitAnswer / redeemReward request | Original result, no second payout or deduction | Automated (demo tests) |

### Mobile
| Case | Expected | Verified |
|---|---|---|
| 390 px viewport | Bottom navigation, drawer for the full menu, no horizontal scroll on landing, dashboard, topic, practice | **Not run** (browser window could not be resized in the build session; layout uses responsive classes, verify on a phone) |
