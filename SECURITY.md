# Security

EduOrbit treats security and data protection as the first priority (spec section 73). This document describes what is protected, how, and what is still open.

## 1. Principles

- **Balances and progress are server-only.** XP, Orbit Coins, streaks, mastery, attempts, sessions, redemptions, badges and group roles are written only by Cloud Functions with the Admin SDK. Firestore rules reject every client write to those collections, so a tampering client is indistinguishable from an honest one and equally powerless.
- **Absolute values from transactional reads.** `computeOutcome` writes `xp`, `coins` and counters as absolute values computed from documents read in the same transaction. Nothing is ever incremented from client input.
- **Idempotent events.** Every value-carrying action has an event id (`lesson_{uid}_{lessonId}`, `answer_{uid}_{attemptId}`, `session_{uid}_{sessionId}`, `spin_{uid}_{n}`, `redeem_{uid}_{key}`) recorded in `processedEvents`. Retries and replays return the original result and pay nothing twice.
- **Answer keys never leave the server.** `questionKeys` is admin-only; grading happens in `submitAnswer`.
- **Four subjects, enforced everywhere.** Rules whitelist `physics`, `chemistry`, `mathematics`, `biology` on user profiles, study plans and buddy preferences; the seed validator rejects any other subject and any JEE Biology or NEET Mathematics tagging; the frontend derives every filter from `src/lib/subjects.ts`.
- **No secrets in the browser.** The Gemini key is a Functions secret. Firebase web config values are identifiers, not secrets; access control is entirely in rules and Functions.

## 2. Firestore access matrix

| Collection | Anonymous | Other student | Owner | Admin | Client writes |
|---|---|---|---|---|---|
| subjects, chapters, topics, lessons, questions, assessments, rewards, badges, appConfig | no | read | read | read, write | none |
| questionKeys | no | no | no | read, write | none |
| users/{uid} | no | no | read, create, update | read, role only | create with pinned email, student role, zero balances; update of preference fields only |
| publicProfiles | no | read | read | read | none (trigger-written) |
| streaks, spinState, userBadges | no | no | read | read | none |
| lessonProgress, chapterProgress, topicMastery, questionAttempts, assessmentAttempts, learningSessions | no | no | read | read | none |
| xpTransactions, coinTransactions, spinHistory, redemptions | no | no | read | read, status on redemptions | none |
| aiConversations, aiMessages, aiUsage, dailyActivity | no | no | read | no | none |
| processedEvents | no | no | no | no | none |
| studyPlans/{uid}, buddyPreferences/{uid} | no | no | read, write (validated) | no | validated fields, subjects whitelisted |
| buddyRequests, buddies, buddySessions, buddyChallenges | no | participants read | participants read | no | none |
| groups | no | public: read; private: members | same | read | none |
| groupMembers, groupJoinRequests, groupInviteCodes, groupPosts, groupReplies, groupSessions, groupChallenges | no | members read | members read | read | none |
| groupInvitations | no | sender or recipient | same | no | none |
| projects, projectTasks | no | no | read, write (validated) | no | owner only, field validation, timestamps |
| notifications/{uid}/items | no | no | read, mark read | no | `read` flag only |
| blocks/{uid}/users | no | no | read, create, delete | no | own list only |
| reports | no | no | create, read own | read, status | create with pinned reporter, enum reason, open status |

## 3. Callables

| Callable | Validation | Idempotency and limits |
|---|---|---|
| `startLesson` | lesson exists | first call only |
| `completeLesson` | lesson exists | once per lesson; chapter bonus once per chapter |
| `submitAnswer` | question and key exist, answer shape matches type and option count, time 0..36000 s | once per attempt id; reward only on first correct attempt of a question |
| `recordStudySession` | kind in allowed set, 1..60 minutes | once per session id; 600 minutes per day cap |
| `spinWheel` | none | event id from the spin counter; 24 h cooldown checked against server time |
| `redeemReward` | reward exists, available, in stock, eligibility met, balance sufficient, once-per-user honoured | once per redemption key; any failure throws before writes |
| `askAi` | mode whitelist, message cap 1500 chars, ids capped, conversation ownership | 40 requests per student per IST day; output validated, hint mode leak check, crisis support notice |
| `startAssessment` / `submitAssessment` | template exists, scope required for topic and chapter tests, answers validated per question type | one paper per period; attempt owner check; finalized attempts return the stored result |
| `findBuddyCandidates` | none | returns anonymous profile fields only; excludes blocks in either direction, closed and matched students, other classes |
| `sendBuddyRequest` | target exists, same class, open, not matched, not blocked, no pending request, message free of phone, email, handle, link or app contact | one pending request per pair of students |
| `respondBuddyRequest` / `cancelBuddyRequest` / `unmatchBuddy` | recipient-only accept, sender-only cancel, member-only unmatch | pair creation checks both students are still free |
| `buddyRoomAction` | member of an active pair; state machine rejects invalid transitions | stop credits each present participant once through `session_{uid}_buddy-{historyId}`, capped at 60 minutes |
| `createBuddyChallenge` / `refreshBuddyChallenge` | member only; target bounds per kind | progress from server documents only; payout once per member; expired challenges never complete |
| `createGroup` / `updateGroup` | name 3..60, description, goal, rules capped, subject whitelist, JEE/NEET subject rules, 2..50 members, contact filter on every text field; edits by owner or admin only | max members cannot drop below the current count |
| `requestJoinGroup` / `respondJoinRequest` | public groups only, not a member, not full, one pending request; staff decide | approval re-checks capacity and existing membership |
| `createGroupInviteCode` / `revokeGroupInviteCode` / `joinGroupWithCode` | staff only; 1..720 hours, 1..100 uses; join checks revoked, expired, used up, full | uses counted server-side |
| `inviteToGroup` / `respondGroupInvitation` | staff invite by anonymous username; recipient-only response | one pending invitation per student per group |
| `leaveGroup` / `removeGroupMember` / `setGroupRole` | owner leaving hands over or archives; admins remove members only; owner alone changes roles, transfer demotes the old owner | no client can ever write a role |
| `createGroupPost` / `createGroupReply` / `reactToGroupPost` / `markGroupHelpful` / `moderateGroupContent` / `reportInGroup` | members only; announcements by staff; contact filter; one reaction per student; no helpful mark on own content; staff hide | reaction and helpful toggles are idempotent |
| `groupSessionAction` / `createGroupChallenge` / `refreshGroupChallenge` | member of the group; challenges created by staff | same room engine and once-only payout as Buddy |
| `deleteAccount` | authenticated | deletes every student-owned document, ends buddy pairs, removes group memberships, deletes the Auth user |

## 4. Student safety

- Other students see only `publicProfiles`: anonymous username, avatar, class, goal, subjects, language, level, progress summary. Never name, email, phone, school or location.
- Block and report are client-writable with validated shapes; blocks are private to the blocker.
- OrbitAI's system prompt forbids off-study content and links; a crisis-language detector prepends helpline guidance (Tele-MANAS 14416, KIRAN 1800-599-0019) and the UI states that OrbitAI is not a counsellor.
- Buddy request messages, group names, descriptions, goals, rules, join-request messages, posts and replies all pass through `functions/src/lib/safety.ts`, which refuses phone numbers, emails, handles, links and messaging-app contacts.
- Group roles exist only in `groupMembers` documents written by Functions; rules deny every client write, and `isGroupStaff` in the rules reads the stored role for report visibility.

## 5. Known gaps

- Firestore rules tests (`tests/rules`) are written but were not executed in the build environment (no emulator). Run them before launch.
- App Check is not enabled. Enable it on Functions and Firestore for production.
- Email verification is encouraged with a banner but does not block usage.
