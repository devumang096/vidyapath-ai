/**
 * Seed EduOrbit content and demo accounts.
 *
 *   npm run seed:check   validate content only, no Firebase access
 *   npm run seed         write content + demo accounts to the project in .env (or the emulator with FIRESTORE_EMULATOR_HOST)
 *
 * Content lives in seed/content/*.json and is the single source of truth for both the real
 * project and the in-browser demo (src/demo/seedData.ts imports the same files).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config as loadEnv } from "dotenv";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import type {
  AssessmentDoc, BadgeDoc, ChapterDoc, LessonDoc, QuestionDoc, QuestionKeyDoc, RewardConfig, RewardDoc, SubjectDoc, TopicDoc
} from "../src/lib/types.js";
import { SUBJECT_IDS } from "../src/lib/subjects.js";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", ".env") });

function read<T>(name: string): T {
  return JSON.parse(readFileSync(join(here, "content", `${name}.json`), "utf8")) as T;
}

const subjects = read<SubjectDoc[]>("subjects");
const chapters = read<ChapterDoc[]>("chapters");
const topics = read<TopicDoc[]>("topics");
const lessons = read<LessonDoc[]>("lessons");
const questions = read<{ question: QuestionDoc; key: QuestionKeyDoc }[]>("questions");
const assessments = read<AssessmentDoc[]>("assessments");
const rewards = read<RewardDoc[]>("rewards");
const badges = read<BadgeDoc[]>("badges");
const appConfig = read<RewardConfig>("appConfig");

function validate(): void {
  const problems: string[] = [];
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  for (const subject of subjects) if (!SUBJECT_IDS.includes(subject.id)) problems.push(`subject ${subject.id} is not one of ${SUBJECT_IDS.join(", ")}`);
  if (subjects.length !== 4) problems.push(`expected exactly 4 subjects, found ${subjects.length}`);

  const chapterIds = new Set<string>();
  const chapterSlugs = new Set<string>();
  for (const chapter of chapters) {
    if (chapterIds.has(chapter.id)) problems.push(`duplicate chapter ${chapter.id}`);
    chapterIds.add(chapter.id);
    if (!subjectIds.has(chapter.subjectId)) problems.push(`chapter ${chapter.id} has unknown subject ${chapter.subjectId}`);
    const slugKey = `${chapter.classLevel}/${chapter.subjectId}/${chapter.slug}`;
    if (chapterSlugs.has(slugKey)) problems.push(`duplicate chapter slug ${slugKey}`);
    chapterSlugs.add(slugKey);
    if (chapter.subjectId === "mathematics" && chapter.examTags.includes("neet")) problems.push(`chapter ${chapter.id}: Mathematics is not a NEET subject`);
    if (chapter.subjectId === "biology" && chapter.examTags.includes("jee")) problems.push(`chapter ${chapter.id}: Biology is not a JEE subject`);
    if (chapter.category && chapter.subjectId !== "chemistry" && chapter.subjectId !== "biology") problems.push(`chapter ${chapter.id} has a category but is not chemistry or biology`);
  }
  const topicIds = new Set<string>();
  const topicById = new Map<string, TopicDoc>();
  for (const topic of topics) {
    if (topicIds.has(topic.id)) problems.push(`duplicate topic ${topic.id}`);
    topicIds.add(topic.id);
    topicById.set(topic.id, topic);
    const chapter = chapters.find((item) => item.id === topic.chapterId);
    if (!chapter) problems.push(`topic ${topic.id} has unknown chapter ${topic.chapterId}`);
    else if (chapter.subjectId !== topic.subjectId || chapter.classLevel !== topic.classLevel) problems.push(`topic ${topic.id} disagrees with its chapter on subject or class`);
    if (topic.hasContent && (!topic.concept || topic.keyPoints.length === 0)) problems.push(`topic ${topic.id} claims content but has no concept or key points`);
  }
  for (const chapter of chapters) {
    const hasTopicContent = topics.some((topic) => topic.chapterId === chapter.id && topic.hasContent);
    if (chapter.hasContent !== hasTopicContent) problems.push(`chapter ${chapter.id} hasContent=${chapter.hasContent} but topics say ${hasTopicContent}`);
  }
  for (const lesson of lessons) {
    if (!topicIds.has(lesson.topicId)) problems.push(`lesson ${lesson.id} has unknown topic ${lesson.topicId}`);
    if (!chapterIds.has(lesson.chapterId)) problems.push(`lesson ${lesson.id} has unknown chapter ${lesson.chapterId}`);
    if (lesson.blocks.length === 0) problems.push(`lesson ${lesson.id} has no content blocks`);
  }
  const questionIds = new Set<string>();
  for (const { question, key } of questions) {
    if (questionIds.has(question.id)) problems.push(`duplicate question ${question.id}`);
    questionIds.add(question.id);
    if (key.id !== question.id) problems.push(`question ${question.id} key id mismatch`);
    const topic = topicById.get(question.topicId);
    if (!topic) problems.push(`question ${question.id} has unknown topic ${question.topicId}`);
    else if (topic.chapterId !== question.chapterId) problems.push(`question ${question.id} chapter does not match its topic`);
    if (![1, 2, 3].includes(question.difficulty)) problems.push(`question ${question.id} has invalid difficulty`);
    if (!key.explanation) problems.push(`question ${question.id} has no explanation`);
    switch (question.type) {
      case "numerical":
        if (key.numericAnswer === null || question.options.length !== 0) problems.push(`numerical question ${question.id} needs a numeric answer and no options`);
        break;
      case "true_false":
        if (question.options.length !== 2 || key.correctIndexes.length !== 1) problems.push(`true/false question ${question.id} needs two options and one answer`);
        break;
      case "multi":
        if (question.options.length < 3 || key.correctIndexes.length < 2) problems.push(`multi question ${question.id} needs at least 3 options and 2 correct answers`);
        break;
      default:
        if (question.options.length < 3 || key.correctIndexes.length !== 1) problems.push(`question ${question.id} needs at least 3 options and exactly one answer`);
    }
    if (key.correctIndexes.some((index) => index < 0 || index >= question.options.length)) problems.push(`question ${question.id} has an out-of-range correct index`);
  }
  for (const assessment of assessments) {
    if (assessment.examTag === "jee" && assessment.subjectIds.includes("biology")) problems.push(`assessment ${assessment.id}: Biology is not a JEE subject`);
    if (assessment.examTag === "neet" && assessment.subjectIds.includes("mathematics")) problems.push(`assessment ${assessment.id}: Mathematics is not a NEET subject`);
  }
  for (const reward of rewards) if (reward.stock < 0 || reward.coinPrice <= 0) problems.push(`reward ${reward.id} has invalid stock or price`);
  const badgeIds = new Set(badges.map((badge) => badge.id));
  for (const outcome of appConfig.spinOutcomes) if (outcome.badgeId && !badgeIds.has(outcome.badgeId)) problems.push(`spin outcome ${outcome.label} references unknown badge`);

  if (problems.length) {
    console.error("Content validation failed:");
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }
}

function summary(): void {
  const byType = new Map<string, number>();
  for (const { question } of questions) byType.set(question.type, (byType.get(question.type) ?? 0) + 1);
  console.log(`subjects ${subjects.length}, chapters ${chapters.length} (${chapters.filter((chapter) => chapter.hasContent).length} with content), topics ${topics.length}, lessons ${lessons.length}`);
  console.log(`questions ${questions.length}: ${[...byType.entries()].map(([type, count]) => `${type} ${count}`).join(", ")}`);
  console.log(`assessments ${assessments.length}, rewards ${rewards.length}, badges ${badges.length}`);
}

function connect(): { db: Firestore; emulator: boolean } {
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (emulator) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
    initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID ?? "demo-eduorbit" });
  } else {
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!path) throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON, or FIRESTORE_EMULATOR_HOST to seed the emulator.");
    initializeApp({ credential: cert(JSON.parse(readFileSync(path, "utf8"))) });
  }
  return { db: getFirestore(), emulator };
}

async function writeCollection(db: Firestore, name: string, docs: { id: string }[]): Promise<void> {
  for (let index = 0; index < docs.length; index += 400) {
    const batch = db.batch();
    for (const item of docs.slice(index, index + 400)) batch.set(db.doc(`${name}/${item.id}`), item);
    await batch.commit();
  }
  console.log(`wrote ${docs.length} -> ${name}`);
}

async function ensureUser(email: string, password: string, displayName: string, admin: boolean): Promise<string> {
  const auth = getAuth();
  const user = await auth.getUserByEmail(email).catch(() => auth.createUser({ email, password, displayName, emailVerified: true }));
  await auth.setCustomUserClaims(user.uid, admin ? { admin: true } : {});
  return user.uid;
}

interface DemoAccount { email: string; password: string; name: string; admin: boolean; goal: "school" | "jee" | "neet" | "school_jee" | "school_neet"; subjects: ("physics" | "chemistry" | "mathematics" | "biology")[] }

async function seedAccount(db: Firestore, account: DemoAccount): Promise<string> {
  const uid = await ensureUser(account.email, account.password, account.name, account.admin);
  const now = Timestamp.now();
  await db.doc(`users/${uid}`).set(
    {
      uid, email: account.email, name: account.name, classLevel: 10, goal: account.goal, subjects: account.subjects, language: "en", learningLevel: "intermediate",
      dailyGoalMinutes: 60, school: null, phone: null, photoURL: null, onboardingComplete: true,
      notificationPrefs: { streak: true, dailyGoal: true, weakTopic: true, assessment: true, buddy: true, group: true, reward: true },
      role: account.admin ? "admin" : "student", xp: 0, coins: 0, questionsSolved: 0, lessonsCompleted: 0, chaptersCompleted: 0, assessmentsCompleted: 0,
      totalStudyMinutes: 0, activeDays: 0, badgeIds: [], createdAt: now, updatedAt: now
    },
    { merge: true }
  );
  return uid;
}

async function main(): Promise<void> {
  validate();
  summary();
  if (process.argv.includes("--check")) return;
  const { db, emulator } = connect();
  console.log(emulator ? "Seeding the Firestore emulator" : "Seeding the configured Firebase project");

  await writeCollection(db, "subjects", subjects);
  await writeCollection(db, "chapters", chapters);
  await writeCollection(db, "topics", topics);
  await writeCollection(db, "lessons", lessons);
  await writeCollection(db, "questions", questions.map((entry) => entry.question));
  await writeCollection(db, "questionKeys", questions.map((entry) => entry.key));
  await writeCollection(db, "assessments", assessments);
  await writeCollection(db, "rewards", rewards);
  await writeCollection(db, "badges", badges);
  await db.doc("appConfig/rewards").set(appConfig);
  console.log("wrote appConfig/rewards");

  const studentEmail = process.env.DEMO_STUDENT_EMAIL;
  const studentPassword = process.env.DEMO_STUDENT_PASSWORD;
  const adminEmail = process.env.DEMO_ADMIN_EMAIL;
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD;
  if (!studentEmail || !studentPassword || !adminEmail || !adminPassword) {
    console.log("Demo accounts skipped: set DEMO_STUDENT_EMAIL/PASSWORD and DEMO_ADMIN_EMAIL/PASSWORD to create them.");
    return;
  }
  await seedAccount(db, { email: studentEmail, password: studentPassword, name: "Aarav Sharma", admin: false, goal: "school_jee", subjects: ["physics", "chemistry", "mathematics"] });
  await seedAccount(db, { email: adminEmail, password: adminPassword, name: "EduOrbit Admin", admin: true, goal: "school", subjects: ["physics"] });
  console.log("Demo accounts ready. Progress is earned through the app so every number stays real.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
