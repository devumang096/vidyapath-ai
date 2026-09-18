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
| Free Goodie and 90-Day programs | live | Configurable criteria in `appConfig/rewards`, real progress bars; claim flow lands with Assessments |
| OrbitAI | live | Explain, Solve, Hint, Quiz, Revision, Mistake Analysis, Study Planner, Beginner mode; context from class, path, chapter, topic, question, weak topics and conversation history; varied re-explanations; crisis support notice; persisted conversations; Gemini via Cloud Function with content-authored fallback |
| Progress and Calendar | live | Accuracy by subject, minutes over time, strength groups, topic table, badges; month calendar with per-day breakdown |
| Projects | live | Create, edit, delete, tasks, deadlines, notes, resources, status and progress |
| Global search | live | Subjects, chapters, topics, lessons, question sets, JEE, NEET, OrbitAI modes, public groups |
| JEE and NEET hubs | live | Exam → Subject → Chapter with per-chapter accuracy and mastery; PYQ tag ready, mocks land with Assessments |
| Assessments | planned (next phase) | Templates are live data; start/submit flow, timer, answer preservation and results are next |
| Buddy | planned | Matching, requests, shared study room, challenges, unmatch, block, report |
| Groups | planned | Create, discover, invite codes, invitations, roles, discussion, sessions, challenges |
| Admin | live | Reports, redemptions, store stock; hidden from students, gated by custom claim and rules |

## 2. Stack

React 18, TypeScript, Vite, Tailwind CSS 4, Firebase Authentication, Cloud Firestore, Cloud Functions v2 (Node 22), Gemini through `@google/genai` inside a Function secret. No AI key or service account ever reaches the browser.

## 3. Architecture in one paragraph

Feature logic lives as pure functions in `functions/src/lib` (`outcome.ts` for rewards and streaks, `learning.ts` for lessons, answers and sessions, `rewards.ts` for spin and store, `mastery.ts`, `grading.ts`, `aiFallback.ts`). Each returns a list of write operations. Cloud Functions read the documents inside a transaction, call the pure function and apply the writes; the browser demo (`src/demo`) reads from an in-memory store and applies the same writes. Firestore rules (`firestore.rules`) let the client write only its profile preferences, projects, buddy preferences, blocks, reports and notification read flags. Everything with value is server-written.

## 4. Local development

```bash
npm install
npm --prefix functions install
cp .env.example .env        # fill in the Firebase web config
npm run dev                 # real Firebase project from .env
npm run demo                # in-browser demo, no Firebase project needed
```

Demo accounts (password `demo1234`): `aarav@eduorbit.demo` (student with nine days of engine-generated history), `priya@eduorbit.demo` and `rahul@eduorbit.demo` (fresh students), `admin@eduorbit.demo`. Demo data lives in `localStorage` under `eduorbit.demo.*`.

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

Composite indexes that Firestore will ask for on first use: `topicMastery (userId, strength, mastery)`, `aiMessages (conversationId, createdAt)`, `aiConversations (userId, updatedAt)`, `dailyActivity (uid, date)`, `questionAttempts (userId, questionId)`, `groups (privacy, nameLower)`. Add them to `firestore.indexes.json` as the console suggests.

## 6. Content

Content is data, never React. `seed/content/*.json` holds `subjects` (exactly four), `chapters` (139, NCERT-aligned, with `slug`, `category`, `examTags`, `hasContent`), `topics`, `lessons`, `questions` (each entry is `{ question, key }`; keys are written to `questionKeys` and never readable by clients), `assessments`, `rewards`, `badges` and `appConfig`. `npm run seed:check` validates every reference, the subject whitelist, question types and keys, and JEE/NEET subject rules.

Authored today: Class 9 Physics Motion, Class 10 Mathematics Real Numbers, Polynomials and Quadratic Equations, Class 10 Chemistry Chemical Reactions and Equations (8 topics, 17 lessons, 73 questions). Every other chapter is present in the structure and shows "Content for this topic is being prepared." To add a chapter: set `hasContent: true`, add topics with `concept`, `keyPoints`, `formulae`, `examples`, `commonMistakes`, lessons with content blocks, and questions of all five types, then run `npm run seed:check`.

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
