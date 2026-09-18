// Demo dataset: the seed/content collections plus demo accounts. Aarav's history is produced by
// replaying real learning events through the same engine the app uses, so every number on the
// dashboard is the result of an actual lesson, answer or study session.
import subjectsJson from "../../seed/content/subjects.json";
import chaptersJson from "../../seed/content/chapters.json";
import topicsJson from "../../seed/content/topics.json";
import lessonsJson from "../../seed/content/lessons.json";
import questionsJson from "../../seed/content/questions.json";
import assessmentsJson from "../../seed/content/assessments.json";
import rewardsJson from "../../seed/content/rewards.json";
import badgesJson from "../../seed/content/badges.json";
import appConfigJson from "../../seed/content/appConfig.json";
import { completeLesson, recordSession, submitAnswer } from "../../functions/src/lib/learning.js";
import { createGroup, createInviteCode, createPost, memberDoc, validateGroupInput } from "../../functions/src/lib/groups.js";
import { istDate } from "../../functions/src/lib/time.js";
import { anonUsername, avatarFor } from "./hash";
import { applyToMap, contextFrom, demoClock } from "./engine";
import { Timestamp, type DocData } from "./store";
import { DEFAULT_NOTIFICATION_PREFS, type Goal, type LessonDoc, type QuestionDoc, type QuestionKeyDoc, type SubjectId } from "../lib/types";

const questions = questionsJson as unknown as { question: QuestionDoc; key: QuestionKeyDoc }[];
const lessons = lessonsJson as unknown as LessonDoc[];

export function contentDocs(): Map<string, DocData> {
  const docs = new Map<string, DocData>();
  const put = (collectionName: string, rows: { id: string }[]) => {
    for (const row of rows) docs.set(`${collectionName}/${row.id}`, row as unknown as DocData);
  };
  put("subjects", subjectsJson);
  put("chapters", chaptersJson);
  put("topics", topicsJson);
  put("lessons", lessonsJson);
  put("questions", questions.map((entry) => entry.question));
  put("questionKeys", questions.map((entry) => entry.key));
  put("assessments", assessmentsJson);
  put("rewards", rewardsJson);
  put("badges", badgesJson);
  docs.set("appConfig/rewards", appConfigJson as unknown as DocData);
  return docs;
}

export const DEMO_PASSWORD = "demo1234";

export interface DemoAccount {
  uid: string;
  email: string;
  name: string;
  role: "student" | "admin";
  goal: Goal;
  subjects: SubjectId[];
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { uid: "demo-aarav", email: "aarav@eduorbit.demo", name: "Aarav Sharma", role: "student", goal: "school_jee", subjects: ["physics", "chemistry", "mathematics"] },
  { uid: "demo-priya", email: "priya@eduorbit.demo", name: "Priya Nair", role: "student", goal: "school", subjects: ["physics", "chemistry", "mathematics", "biology"] },
  { uid: "demo-rahul", email: "rahul@eduorbit.demo", name: "Rahul Verma", role: "student", goal: "school_neet", subjects: ["physics", "chemistry", "biology"] },
  { uid: "demo-admin", email: "admin@eduorbit.demo", name: "EduOrbit Admin", role: "admin", goal: "school", subjects: ["physics"] }
];

const DAY = 86_400_000;

function baseDocs(account: DemoAccount, now: Timestamp): [string, DocData][] {
  const { uid, email, name, role, goal, subjects } = account;
  return [
    [`demoAccounts/${uid}`, { uid, email, password: DEMO_PASSWORD, displayName: name, photoURL: null, admin: role === "admin", emailVerified: true, provider: "password" }],
    [`users/${uid}`, {
      uid, email, name, classLevel: 10, goal, subjects, language: "en", learningLevel: "intermediate", dailyGoalMinutes: 60, school: "Demo Public School", phone: null, photoURL: null,
      onboardingComplete: true, notificationPrefs: DEFAULT_NOTIFICATION_PREFS, role, xp: 0, coins: 0, questionsSolved: 0, lessonsCompleted: 0, chaptersCompleted: 0, assessmentsCompleted: 0,
      totalStudyMinutes: 0, activeDays: 0, badgeIds: [], createdAt: now, updatedAt: now
    }],
    [`publicProfiles/${uid}`, {
      uid, anonUsername: anonUsername(uid), avatar: avatarFor(uid), classLevel: 10, goal, subjects, language: "en", learningLevel: "intermediate",
      progressSummary: { accuracy: 0, questionsSolved: 0, lessonsCompleted: 0 }, buddyStatus: "none", buddyPairId: null, updatedAt: now
    }],
    [`streaks/${uid}`, { uid, current: 0, longest: 0, lastQualifiedDate: null, protectionTokens: 0, milestonesAwarded: [], updatedAt: now }],
    [`spinState/${uid}`, { uid, nextSpinAt: null, lastResult: null, totalSpins: 0 }],
    [`buddyPreferences/${uid}`, { uid, open: role === "student", subjects: subjects.slice(0, 2), schedule: uid === "demo-rahul" ? "morning" : "evening", genderPreference: "any", gender: "unspecified", updatedAt: now }]
  ];
}

/**
 * Replays nine days of Aarav's learning (a lesson, a few questions and a study session per day)
 * through the real engine. The 5th day back is deliberately skipped so the streak shows a
 * realistic reset, and answers alternate right and wrong so mastery bands are mixed.
 */
function replayAarav(docs: Map<string, DocData>, content: Map<string, DocData>): void {
  const uid = "demo-aarav";
  const read = (path: string) => docs.get(path) ?? content.get(path) ?? null;
  const aaravLessons = lessons.filter((lesson) => lesson.classLevel === 10).sort((left, right) => left.id.localeCompare(right.id));
  const aaravQuestions = questions.filter((entry) => entry.question.classLevel === 10 && entry.question.type !== "numerical");
  const lessonsPerChapter = new Map<string, number>();
  for (const lesson of lessons) lessonsPerChapter.set(lesson.chapterId, (lessonsPerChapter.get(lesson.chapterId) ?? 0) + 1);
  const poolSize = new Map<string, number>();
  for (const { question } of questions) poolSize.set(question.topicId, (poolSize.get(question.topicId) ?? 0) + 1);
  let questionCursor = 0;
  // Noon IST on each day, so the replay never straddles the IST day boundary.
  const todayNoonIst = Date.parse(`${istDate(new Date())}T06:30:00Z`);
  for (let daysAgo = 9; daysAgo >= 1; daysAgo -= 1) {
    if (daysAgo === 5) continue;
    const clock = demoClock(new Date(todayNoonIst - daysAgo * DAY));
    const lesson = aaravLessons[(9 - daysAgo) % aaravLessons.length];
    if (lesson && !docs.has(`lessonProgress/${uid}_${lesson.id}`)) {
      const ctx = contextFrom(read, uid, `lesson_${uid}_${lesson.id}`, clock);
      applyToMap(docs, completeLesson({
        ctx, clock, lesson, progress: null,
        chapterProgress: (docs.get(`chapterProgress/${uid}_${lesson.chapterId}`) as never) ?? null,
        lessonsInChapter: lessonsPerChapter.get(lesson.chapterId) ?? 0
      }).writes);
    }
    const answersToday = 3 + ((9 - daysAgo) % 3);
    for (let index = 0; index < answersToday; index += 1) {
      const entry = aaravQuestions[questionCursor % aaravQuestions.length];
      questionCursor += 1;
      const attemptId = `seed-${daysAgo}-${index}`;
      const correct = (questionCursor + daysAgo) % 5 !== 0 && !(entry.question.topicId.includes("solving-by-factorisation") && questionCursor % 2 === 0);
      const wrongIndex = entry.question.options.findIndex((_, optionIndex) => !entry.key.correctIndexes.includes(optionIndex));
      const ctx = contextFrom(read, uid, `answer_${uid}_${attemptId}`, clock);
      applyToMap(docs, submitAnswer({
        ctx, clock, attemptId, question: entry.question, key: entry.key,
        answer: { indexes: correct ? entry.key.correctIndexes : [Math.max(0, wrongIndex)] },
        timeTakenSec: 40 + index * 15, context: index % 2 === 0 ? "practice" : "topic",
        mastery: (docs.get(`topicMastery/${uid}_${entry.question.topicId}`) as never) ?? null,
        priorAttempts: 0, solvedBefore: false, poolSize: poolSize.get(entry.question.topicId) ?? 1
      }).writes);
    }
    const ctx = contextFrom(read, uid, `session_${uid}_seed-${daysAgo}`, clock);
    applyToMap(docs, recordSession({ ctx, clock, sessionId: `seed-${daysAgo}`, topicId: lesson?.topicId ?? null, minutes: 25 + (daysAgo % 3) * 10, kind: "learning" }).writes);
  }
}

/** One public group owned by Rahul with Priya as a member and a couple of posts, one private group owned by Priya with a live invite code. */
function seedGroups(docs: Map<string, DocData>): void {
  const profile = (uid: string) => docs.get(`publicProfiles/${uid}`) as unknown as Parameters<typeof createGroup>[0]["profile"];
  const clock = demoClock(new Date(Date.now() - 2 * DAY));
  const publicGroup = createGroup({ uid: "demo-rahul", profile: profile("demo-rahul"), groupId: "demo-group-physics", clock, fields: validateGroupInput({ name: "Class 10 Physics Circle", description: "Motion, force and electricity, one chapter a week. Ask anything, answer what you can.", privacy: "public", focus: "subject", classLevel: 10, path: "school", subjectId: "physics", studyGoal: "Finish Class 10 Physics before the pre-boards", rules: "Study talk only. No phone numbers or handles.", maxMembers: 20, cover: "atom" }) });
  applyToMap(docs, publicGroup.writes);
  applyToMap(docs, [{ path: "groupMembers/demo-group-physics_demo-priya", data: memberDoc("demo-group-physics", profile("demo-priya"), "member", clock) as unknown as DocData }, { path: "groups/demo-group-physics", merge: true, data: { memberCount: 2 } }]);
  const group = docs.get("groups/demo-group-physics") as never;
  const member = docs.get("groupMembers/demo-group-physics_demo-rahul") as never;
  applyToMap(docs, createPost({ uid: "demo-rahul", group, member, kind: "announcement", title: "This week: Equations of Motion", body: "Read the lesson, try the Basic set, and post any question you get stuck on.", postId: "demo-post-1", clock }).writes);
  applyToMap(docs, createPost({ uid: "demo-priya", group: docs.get("groups/demo-group-physics") as never, member: docs.get("groupMembers/demo-group-physics_demo-priya") as never, kind: "question", title: "Why is acceleration negative when a train slows down?", body: "I keep getting the sign wrong in v = u + at.", postId: "demo-post-2", clock: demoClock(new Date(Date.now() - DAY)) }).writes);
  const privateGroup = createGroup({ uid: "demo-priya", profile: profile("demo-priya"), groupId: "demo-group-bio", clock, fields: validateGroupInput({ name: "NEET Biology Sprint", description: "Private group for NEET aspirants doing Botany and Zoology together.", privacy: "private", focus: "neet", classLevel: 10, path: "neet", subjectId: "biology", studyGoal: "50 questions a week each", rules: "Join only if you are preparing for NEET.", maxMembers: 10, cover: "leaf" }) });
  applyToMap(docs, privateGroup.writes);
  applyToMap(docs, createInviteCode({ uid: "demo-priya", group: docs.get("groups/demo-group-bio") as never, member: docs.get("groupMembers/demo-group-bio_demo-priya") as never, code: "EDU-7K4P9", expiresInHours: 24 * 30, maxUses: 20, clock }).writes);
}

export function seedUserDocs(): Map<string, DocData> {
  const docs = new Map<string, DocData>();
  const now = Timestamp.now();
  for (const account of DEMO_ACCOUNTS) for (const [path, data] of baseDocs(account, now)) docs.set(path, data);
  replayAarav(docs, contentDocs());
  seedGroups(docs);
  return docs;
}
