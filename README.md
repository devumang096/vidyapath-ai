# EduOrbit

**Quality Education. Without Barriers.**
**Learn. Practice. Ask. Improve. Grow.**

EduOrbit is a students-only learning platform for Classes 9 to 12, JEE and NEET aspirants. It covers exactly four subjects, Physics, Chemistry, Mathematics and Biology (JEE: Physics, Chemistry, Mathematics; NEET: Physics, Chemistry, Biology), and combines NCERT-aligned lessons, a server-graded question bank, mastery-based strengths and weaknesses, the OrbitAI tutor, Buddy and Group learning, a study timer, streaks, XP, Orbit Coins, badges, an Orbit Store, projects and a learning calendar.

Smart India Hackathon entry for problem statement **SIH26207** (Smart Education). The repository name is historical; the product is EduOrbit.

## 1. Build status

The rebuild from the earlier VidyaPath prototype is in progress. Everything marked **live** works end to end through the backend and the in-browser demo; everything marked **planned** is described honestly in the UI and has no dead buttons.

| Area | Status | Notes |
|---|---|---|
| Authentication | live | Email/password, Google Sign-In, email verification banner, password reset, password change, account deletion (server-side), protected routes with return URL |
| Signup and onboarding | live | Name, email, password, class, goal, optional phone/school, then class, path, subjects, daily goal, language, level |
| Landing, About, Safety, Guidelines, Privacy, Terms, Cookies, Account Deletion, Contact, Help | live | Legal pages are marked as drafts for review |
| Learn: Class → Subject → Chapter → Topic | live | Full NCERT-aligned chapter skeleton for all four subjects and four classes; topics, lessons and questions authored for a subset (see section 6) |
| Lessons | live | Start on open, complete on demand, chapter completion bonus when every lesson in the chapter is done |
| Question engine | live | MCQ, multiple answer, true/false, numerical and conceptual; server grading; attempts stored; XP and coins on first correct attempt only |
| Practice | live | Filters (class, subject, chapter, topic, difficulty, type) and Random, Weak Topic, Chapter, Mixed and Timed modes |
| Mastery and strengths | live | Documented formula in `functions/src/lib/mastery.ts`; Strong, Good, Needs Practice, Weak; recommendations from real performance |
| Dashboard | live | All statistics from server-written documents; honest empty state for new students |
| Study timer | live | Start, pause, resume, stop, reset; survives refresh; server caps 60 min per session and 600 per day |
| Streak | live | Meaningful activity only, IST day boundary, protection tokens from the Orbit Spin |
| XP, Orbit Coins, ledgers | live | Absolute balances written in the same transaction as the ledger entries |
| Orbit Spin | live | 24 h server cooldown, replay-safe event ids |
| Orbit Store | live | Eligibility, balance and stock checked in one transaction; stock decremented; redemptions tracked; admin fulfilment |
| Badges | live | Seven spec badges on real conditions |
| Free Goodie and 90-Day programs | live | Configurable criteria in `appConfig/rewards`, real progress bars; claim button lands once criteria can realistically be met |
| OrbitAI | live | Explain, Solve, Hint, Quiz, Revision, Mistake Analysis, Study Planner, Beginner mode; context from class, path, chapter, topic, question, weak topics and conversation history; varied re-explanations; crisis support notice; persisted conversations; Gemini via Cloud Function with content-authored fallback |
| Progress and Calendar | live | Accuracy by subject, minutes over time, strength groups, topic table, badges; month calendar with per-day breakdown |
| Projects | live | Create, edit, delete, tasks, deadlines, notes, resources, status and progress |
| Global search | live | Subjects, chapters, topics, lessons, question sets, JEE, NEET, OrbitAI modes, public groups |
| JEE and NEET hubs | live | Exam → Subject → Chapter with per-chapter accuracy and mastery; JEE and NEET mocks via Assessments; PYQ tag in the schema, none tagged yet |
| Assessments | live | Daily, weekly, monthly (one paper per period), topic and chapter tests, JEE and NEET mocks; server-built papers, countdown, answers preserved until submission succeeds, results with strong and weak topics and recommendations; refuses honestly when fewer than 5 questions exist |
| Buddy | live | Preferences, anonymous ranked matching (same class required), requests with a contact-sharing filter, accept or decline, shared study room with per-student time credited on stop, pair challenges paid once from validated activity, unmatch, block, report |
| Groups | live | Public and private groups around class, JEE, NEET, subject, chapter, project or goal; discover and request, invite codes with expiry, usage limit and revocation, in-app invitations by anonymous username; owner, admin and member roles set only on the server; discussion with reactions, helpful marks, report, hide; contact-sharing filter on posts; shared study session; group-total challenges paid once to contributors; leave with ownership handover |
| Admin | live | Reports, redemptions, store stock; hidden from students, gated by custom claim and rules |

## 2. Stack

React 18, TypeScript, Vite, Tailwind CSS 4, Firebase Authentication, Cloud Firestore, Cloud Functions v2 (Node 22), Gemini through `@google/genai` inside a Function secret. No AI key or service account ever reaches the browser.

## 3. Architecture in one paragraph

Feature logic lives as pure functions in `functions/src/lib` (`outcome.ts` for rewards and streaks, `learning.ts` for lessons, answers and sessions, `assessments.ts` for building and grading papers, `buddy.ts` for matching, requests and pair challenges, `groups.ts` for everything group-related, `room.ts` for the shared study room used by both, `safety.ts` for the contact-sharing filter, `rewards.ts` for spin and store, `mastery.ts`, `grading.ts`, `aiFallback.ts`). Each returns a list of write operations. Cloud Functions read the documents inside a transaction, call the pure function and apply the writes; the browser demo (`src/demo`) reads from an in-memory store and applies the same writes. Firestore rules (`firestore.rules`) let the client write only its profile preferences, projects, buddy preferences, blocks, reports and notification read flags. Everything with value is server-written.

## 4. Local development

```bash
npm install
npm --prefix functions install
cp .env.example .env        # fill in the Firebase web config
npm run dev                 # real Firebase project from .env
npm run demo                # in-browser demo, no Firebase project needed
```

Demo accounts (password `demo1234`): `aarav@eduorbit.demo` (student with nine days of engine-generated history), `priya@eduorbit.demo` and `rahul@eduorbit.demo` (fresh students; Rahul owns the public "Class 10 Physics Circle", Priya owns the private "NEET Biology Sprint" with invite code `EDU-7K4P9`), `admin@eduorbit.demo`. Demo data lives in `localStorage` under `eduorbit.demo.*`.

## 5. Firebase setup

1. Create a Firebase project on the Blaze plan (Functions need it). Enable Authentication (Email/Password and Google), Firestore and Functions.
2. Register a web app and copy its config into `.env` (`VITE_FIREBASE_*`).
3. Set the Gemini key as a Functions secret: `npx firebase functions:secrets:set GEMINI_API_KEY`.
4. Deploy rules, indexes and functions:
   ```bash
   npx firebase deploy --only firestore:rules,firestore:indexes,functions
   ```
5. Seed content and demo accounts, then build and deploy hosting:
   ```bash
   npm run seed:check   # validates content only
   npm run seed         # needs GOOGLE_APPLICATION_CREDENTIALS and DEMO_* in .env
   npm run build
   npx firebase deploy --only hosting
   ```
6. Grant an admin: `npm run set-admin -- admin@example.com`.

Composite indexes that Firestore will ask for on first use: `topicMastery (userId, strength, mastery)`, `aiMessages (conversationId, createdAt)`, `aiConversations (userId, updatedAt)`, `dailyActivity (uid, date)`, `questionAttempts (userId, questionId)`, `assessmentAttempts (userId, createdAt)`, `buddies (members, status)`, `buddyRequests (toUid, status)`, `buddyRequests (fromUid, status)`, `buddySessions (pairId, status, finalizedAt)`, `buddyChallenges (pairId, createdAt)`, `learningSessions (userId, createdAt)`, `questionAttempts (userId, createdAt)`, `groups (privacy, status, memberCount)`, `groupMembers (groupId)`, `groupJoinRequests (groupId, uid, status)`, `groupInvitations (groupId, toUid, status)`, `groupInvitations (toUid, status)`, `groupInviteCodes (groupId, createdAt)`, `groupPosts (groupId, createdAt)`, `groupPosts (groupId, kind, hidden, createdAt)`, `groupReplies (postId, createdAt)`, `groupReports (groupId, status)`, `groupSessions (groupId, status, finalizedAt)`, `groupChallenges (groupId, createdAt)`, `publicProfiles (anonUsername)`, `questions (examTags, subjectId)`, `questions (classLevel, subjectId)`, `groups (privacy, nameLower)`. Add them to `firestore.indexes.json` as the console suggests.

## 6. Content

Content is data, never React. `seed/content/*.json` holds `subjects` (exactly four), `chapters` (139, NCERT-aligned, with `slug`, `category`, `examTags`, `hasContent`), `topics`, `lessons`, `questions` (each entry is `{ question, key }`; keys are written to `questionKeys` and never readable by clients), `assessments`, `rewards`, `badges` and `appConfig`. `npm run seed:check` validates every reference, the subject whitelist, question types and keys, and JEE/NEET subject rules.

Authored so far (10 chapters, 29 topics, 38 lessons, 231 original questions across all five types and three difficulties): Physics Class 9 Motion and Class 11 Laws of Motion; Chemistry Class 10 Chemical Reactions and Equations and Class 11 Some Basic Concepts of Chemistry; Mathematics Class 10 Real Numbers, Polynomials and Quadratic Equations and Class 11 Complex Numbers and Quadratic Equations; Biology Class 9 The Fundamental Unit of Life and Class 11 Cell: The Unit of Life. The Class 11 chapters are tagged for JEE and NEET so the mocks have a pool. No question is a reproduced past exam question, so the PYQ flag is false everywhere; teammates with licensed PYQ sets can tag them. Every other chapter is present in the structure and shows "Content for this topic is being prepared." To add a chapter: set `hasContent: true`, add topics with `concept`, `keyPoints`, `formulae`, `examples`, `commonMistakes`, lessons with content blocks, and questions of all five types, then run `npm run seed:check`.

## 7. Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `npm run demo` | Dev server against Firebase / against the in-browser demo |
| `npm run build` | Typecheck and production build |
| `npm test` | Vitest: demo shims and callables against the shared engine |
| `npm run test:functions` | Vitest: pure server logic (streak, mastery, grading, rewards, AI validation) |
| `npm run test:rules` | Firestore rules tests (needs the emulator) |
| `npm run seed:check` / `npm run seed` | Validate / write content and demo accounts |
| `npm run deploy:pages` | Build the demo and publish to GitHub Pages |

## 8. Security

See `SECURITY.md` for the full matrix: which collection the client may read or write, which callables exist, how idempotency, rate limits and the four-subject rule are enforced, and what protects minors in Buddy and Groups.

## 9. Testing

See `TESTING.md` for the automated coverage and the manual matrix from spec sections 98 and 99, with a column recording what was verified in this build environment (no Firebase project, no emulator) and what remains for a real project.

## 10. Demo

A public preview runs at https://devumang096.github.io/vidyapath-ai/ (built with `--mode demo`). `JUDGE_DEMO_GUIDE.md` is a five-minute click path.
