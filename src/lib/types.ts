// Shared data model. A copy of this file lives at functions/src/types.ts so the
// Functions package deploys self-contained. Keep both in sync.

export type ClassLevel = 9 | 10 | 11 | 12;
export type SubjectId = "physics" | "chemistry" | "mathematics" | "biology";
export type SubjectCategory = "physical_chemistry" | "organic_chemistry" | "inorganic_chemistry" | "botany" | "zoology" | null;
export type LearningPath = "school" | "jee" | "neet";
export type Goal = "school" | "jee" | "neet" | "school_jee" | "school_neet";
export type ExamTag = "school" | "jee" | "neet";
export type Difficulty = 1 | 2 | 3;
export type QuestionType = "mcq" | "multi" | "true_false" | "numerical" | "conceptual";
export type LearningLevel = "beginner" | "intermediate" | "advanced";
export type Role = "student" | "admin";
export type Language = "en" | "hi";
export type Strength = "unrated" | "weak" | "needs_practice" | "good" | "strong";
export type AiMode = "explain" | "solve" | "hint" | "quiz" | "revision" | "mistake_analysis" | "study_planner";
export type AiSource = "gemini" | "fallback";
export type SessionKind = "learning" | "practice" | "revision" | "buddy" | "group";
export type AssessmentKind = "daily" | "weekly" | "monthly" | "topic_test" | "chapter_test" | "jee_mock" | "neet_mock";

export const GOAL_LABELS: Record<Goal, string> = {
  school: "School",
  jee: "JEE",
  neet: "NEET",
  school_jee: "School + JEE",
  school_neet: "School + NEET"
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = { 1: "Basic", 2: "Intermediate", 3: "Advanced" };

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "MCQ",
  multi: "Multiple Answer",
  true_false: "True / False",
  numerical: "Numerical",
  conceptual: "Conceptual"
};

export const STRENGTH_LABELS: Record<Strength, string> = {
  unrated: "Not enough data",
  weak: "Weak",
  needs_practice: "Needs Practice",
  good: "Good",
  strong: "Strong"
};

export const LEARNING_LEVEL_LABELS: Record<LearningLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

export const SESSION_KIND_LABELS: Record<SessionKind, string> = { learning: "Learning", practice: "Practice", revision: "Revision", buddy: "Buddy room", group: "Group session" };

export const ASSESSMENT_KIND_LABELS: Record<AssessmentKind, string> = {
  daily: "Daily Assessment",
  weekly: "Weekly Assessment",
  monthly: "Monthly Assessment",
  topic_test: "Topic Test",
  chapter_test: "Chapter Test",
  jee_mock: "JEE Mock",
  neet_mock: "NEET Mock"
};

export interface NotificationPrefs {
  streak: boolean;
  dailyGoal: boolean;
  weakTopic: boolean;
  assessment: boolean;
  buddy: boolean;
  group: boolean;
  reward: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { streak: true, dailyGoal: true, weakTopic: true, assessment: true, buddy: true, group: true, reward: true };

export interface UserDoc {
  uid: string;
  email: string;
  name: string;
  classLevel: ClassLevel;
  goal: Goal;
  subjects: SubjectId[];
  language: Language;
  learningLevel: LearningLevel;
  dailyGoalMinutes: number;
  school: string | null;
  phone: string | null;
  photoURL: string | null;
  onboardingComplete: boolean;
  notificationPrefs: NotificationPrefs;
  role: Role;
  xp: number;
  coins: number;
  questionsSolved: number;
  lessonsCompleted: number;
  chaptersCompleted: number;
  assessmentsCompleted: number;
  totalStudyMinutes: number;
  activeDays: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PublicProfile {
  uid: string;
  anonUsername: string;
  avatar: string;
  classLevel: ClassLevel;
  goal: Goal;
  subjects: SubjectId[];
  language: Language;
  learningLevel: LearningLevel;
  progressSummary: { accuracy: number; questionsSolved: number; lessonsCompleted: number };
  buddyStatus: "none" | "open" | "matched";
  buddyPairId: string | null;
  updatedAt: unknown;
}

export interface SubjectDoc {
  id: SubjectId;
  name: string;
  classLevels: ClassLevel[];
  examTags: ExamTag[];
  categories: { id: Exclude<SubjectCategory, null>; name: string }[];
  order: number;
}

export interface ChapterDoc {
  id: string;
  slug: string;
  subjectId: SubjectId;
  category: SubjectCategory;
  classLevel: ClassLevel;
  name: string;
  order: number;
  examTags: ExamTag[];
  hasContent: boolean;
  overview: string;
  objectives: string[];
  formulas: string[];
  keyConcepts: string[];
  commonMistakes: string[];
}

export interface TopicDoc {
  id: string;
  slug: string;
  chapterId: string;
  subjectId: SubjectId;
  category: SubjectCategory;
  classLevel: ClassLevel;
  name: string;
  order: number;
  hasContent: boolean;
  concept: string;
  keyPoints: string[];
  formulae: string[];
  examples: { problem: string; solution: string }[];
  commonMistakes: string[];
  revision: { concept: string; formula: string; commonMistake: string; miniQuestion: { question: string; answer: string } } | null;
}

export interface LessonContentBlock {
  type: "text" | "keypoints" | "formula" | "example";
  heading: string;
  body: string;
}

export interface LessonDoc {
  id: string;
  topicId: string;
  chapterId: string;
  subjectId: SubjectId;
  classLevel: ClassLevel;
  title: string;
  description: string;
  estimatedMinutes: number;
  order: number;
  blocks: LessonContentBlock[];
}

export interface QuestionDoc {
  id: string;
  topicId: string;
  chapterId: string;
  subjectId: SubjectId;
  classLevel: ClassLevel;
  type: QuestionType;
  difficulty: Difficulty;
  examTags: ExamTag[];
  pyq: boolean;
  text: string;
  options: string[];
  unit: string | null;
  hints: string[];
  source: string | null;
}

export interface QuestionKeyDoc {
  id: string;
  correctIndexes: number[];
  numericAnswer: number | null;
  tolerance: number;
  explanation: string;
}

/** Answer as the client sends it: option indexes for choice questions, a number string for numerical. */
export type SubmittedAnswer = { indexes: number[] } | { value: string };

export interface QuestionAttemptDoc {
  id: string;
  userId: string;
  questionId: string;
  topicId: string;
  chapterId: string;
  subjectId: SubjectId;
  difficulty: Difficulty;
  context: "practice" | "topic" | "assessment";
  assessmentAttemptId: string | null;
  answer: SubmittedAnswer;
  correct: boolean;
  timeTakenSec: number;
  attemptNumber: number;
  createdAt: unknown;
}

export interface TopicMasteryDoc {
  id: string;
  userId: string;
  topicId: string;
  chapterId: string;
  subjectId: SubjectId;
  classLevel: ClassLevel;
  attempts: number;
  correct: number;
  accuracy: number;
  distinctQuestionIds: string[];
  recent: { correct: boolean; difficulty: Difficulty; at: number }[];
  assessmentAttempts: number;
  assessmentCorrect: number;
  timeSpentSec: number;
  mastery: number;
  strength: Strength;
  lastPracticedAt: unknown;
}

export interface LessonProgressDoc {
  lessonId: string;
  topicId: string;
  chapterId: string;
  subjectId: SubjectId;
  status: "started" | "completed";
  startedAt: unknown;
  completedAt: unknown;
}

export interface ChapterProgressDoc {
  id: string;
  userId: string;
  chapterId: string;
  subjectId: SubjectId;
  classLevel: ClassLevel;
  lessonsTotal: number;
  lessonsCompleted: number;
  completed: boolean;
  completedAt: unknown;
}

export interface LearningSessionDoc {
  id: string;
  userId: string;
  topicId: string | null;
  kind: SessionKind;
  minutes: number;
  date: string;
  createdAt: unknown;
}

export interface StreakDoc {
  uid: string;
  current: number;
  longest: number;
  lastQualifiedDate: string | null;
  protectionTokens: number;
  milestonesAwarded: number[];
  updatedAt: unknown;
}

export interface DailyActivityDoc {
  uid: string;
  date: string;
  minutes: number;
  questions: number;
  correct: number;
  lessons: number;
  assessments: number;
  revisions: number;
  xp: number;
  coins: number;
  topicIds: string[];
  qualified: boolean;
  updatedAt: unknown;
}

export interface LedgerTransactionDoc {
  id: string;
  userId: string;
  amount: number;
  reason: string;
  refId: string;
  createdAt: unknown;
}

export interface RewardDoc {
  id: string;
  name: string;
  description: string;
  icon: string;
  coinPrice: number;
  stock: number;
  available: boolean;
  oncePerUser: boolean;
  eligibility: { minStreak: number; minChaptersCompleted: number; minQuestionsSolved: number };
  kind: "physical" | "digital";
  order: number;
}

export interface RedemptionDoc {
  id: string;
  userId: string;
  rewardId: string;
  rewardName: string;
  coinsSpent: number;
  type: "store" | "goodie" | "ninety_day";
  status: "pending" | "approved" | "fulfilled" | "rejected";
  createdAt: unknown;
}

export interface SpinOutcome {
  label: string;
  weight: number;
  xp: number;
  coins: number;
  streakProtection: number;
  badgeId: string | null;
}

export interface SpinStateDoc {
  uid: string;
  nextSpinAt: unknown;
  lastResult: string | null;
  totalSpins: number;
}

export interface SpinHistoryDoc {
  id: string;
  userId: string;
  result: string;
  xp: number;
  coins: number;
  createdAt: unknown;
}

export interface AssessmentDoc {
  id: string;
  kind: AssessmentKind;
  title: string;
  description: string;
  questionCounts: Record<"1" | "2" | "3", number>;
  timeLimitSec: number;
  examTag: ExamTag | null;
  subjectIds: SubjectId[];
  order: number;
}

export interface AssessmentAttemptDoc {
  id: string;
  userId: string;
  assessmentId: string;
  kind: AssessmentKind;
  periodKey: string | null;
  scopeId: string | null;
  questionIds: string[];
  answers: Record<string, SubmittedAnswer>;
  finalized: boolean;
  score: number | null;
  total: number | null;
  timeTakenSec: number | null;
  timeLimitSec: number;
  results: Record<string, { correctIndexes: number[]; numericAnswer: number | null; explanation: string; correct: boolean }> | null;
  topicSummary: Record<string, { attempts: number; correct: number }> | null;
  createdAt: unknown;
  finalizedAt: unknown;
}

export interface BadgeDoc {
  id: string;
  name: string;
  description: string;
  criteria: string;
  icon: string;
}

export interface AiConversationDoc {
  id: string;
  userId: string;
  title: string;
  topicId: string | null;
  chapterId: string | null;
  subjectId: SubjectId | null;
  questionId: string | null;
  messageCount: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AiMessageDoc {
  id: string;
  conversationId: string;
  userId: string;
  role: "user" | "assistant";
  mode: AiMode;
  text: string;
  source: AiSource | null;
  createdAt: unknown;
}

export interface NotificationDoc {
  id: string;
  type: keyof NotificationPrefs | "system";
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: unknown;
}

export interface StudyPlanAllocation {
  learning: number;
  practice: number;
  revision: number;
  assessment: number;
  ai: number;
  breaks: number;
}

export interface StudyPlanDoc {
  uid: string;
  minutesPerDay: number;
  examDate: string | null;
  subjects: SubjectId[];
  allocation: StudyPlanAllocation;
  focusTopicIds: string[];
  updatedAt: unknown;
}

export interface BuddyPreferencesDoc {
  uid: string;
  open: boolean;
  subjects: SubjectId[];
  schedule: "morning" | "afternoon" | "evening" | "night" | "flexible";
  genderPreference: "any" | "same";
  gender: "female" | "male" | "other" | "unspecified";
  updatedAt: unknown;
}

export interface BuddyRequestDoc {
  id: string;
  fromUid: string;
  toUid: string;
  message: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: unknown;
  respondedAt: unknown;
}

export interface BuddyPairDoc {
  id: string;
  members: string[];
  classLevel: ClassLevel;
  status: "active" | "ended";
  endedBy: string | null;
  createdAt: unknown;
  endedAt: unknown;
}

export interface SharedSessionState {
  status: "idle" | "running" | "paused" | "stopped";
  startedAt: unknown;
  resumedAt: unknown;
  accumulatedSec: number;
  participants: Record<string, { joinedAt: unknown; seconds: number; present: boolean }>;
  startedBy: string | null;
  updatedAt: unknown;
}

export interface BuddySessionDoc extends SharedSessionState {
  id: string;
  pairId: string;
  members: string[];
  finalizedAt: unknown;
}

export type ChallengeKind = "study_minutes" | "questions" | "chapter" | "assessment";

export const CHALLENGE_KIND_LABELS: Record<ChallengeKind, string> = { study_minutes: "Study minutes", questions: "Questions solved", chapter: "Chapters completed", assessment: "Assessments completed" };

export interface ChallengeProgress {
  [uid: string]: number;
}

export interface BuddyChallengeDoc {
  id: string;
  pairId: string;
  members: string[];
  kind: ChallengeKind;
  target: number;
  title: string;
  progress: ChallengeProgress;
  completed: boolean;
  rewardedUids: string[];
  startsAt: unknown;
  endsAt: unknown;
  createdBy: string;
  createdAt: unknown;
}

export type GroupRole = "owner" | "admin" | "member";
export type GroupFocus = "class" | "jee" | "neet" | "subject" | "chapter" | "project" | "goal";

export interface GroupDoc {
  id: string;
  name: string;
  nameLower: string;
  description: string;
  cover: string;
  privacy: "public" | "private";
  focus: GroupFocus;
  classLevel: ClassLevel | null;
  path: LearningPath | null;
  subjectId: SubjectId | null;
  chapterId: string | null;
  studyGoal: string;
  rules: string;
  maxMembers: number;
  memberCount: number;
  ownerUid: string;
  status: "active" | "archived";
  createdAt: unknown;
  updatedAt: unknown;
}

export interface GroupMemberDoc {
  id: string;
  groupId: string;
  uid: string;
  role: GroupRole;
  anonUsername: string;
  avatar: string;
  joinedAt: unknown;
}

export interface GroupJoinRequestDoc {
  id: string;
  groupId: string;
  uid: string;
  message: string;
  status: "pending" | "approved" | "rejected";
  createdAt: unknown;
  decidedBy: string | null;
  decidedAt: unknown;
}

export interface GroupInvitationDoc {
  id: string;
  groupId: string;
  groupName: string;
  fromUid: string;
  toUid: string;
  status: "pending" | "accepted" | "declined";
  createdAt: unknown;
  respondedAt: unknown;
}

export interface GroupInviteCodeDoc {
  id: string;
  code: string;
  groupId: string;
  createdBy: string;
  expiresAt: unknown;
  maxUses: number;
  uses: number;
  revoked: boolean;
  createdAt: unknown;
}

export interface GroupPostDoc {
  id: string;
  groupId: string;
  authorUid: string;
  authorName: string;
  kind: "post" | "question" | "announcement";
  title: string;
  body: string;
  reactions: Record<string, number>;
  helpfulCount: number;
  replyCount: number;
  hidden: boolean;
  createdAt: unknown;
}

export interface GroupReplyDoc {
  id: string;
  groupId: string;
  postId: string;
  authorUid: string;
  authorName: string;
  body: string;
  helpfulCount: number;
  hidden: boolean;
  createdAt: unknown;
}

export interface GroupReportDoc {
  id: string;
  groupId: string;
  reporterUid: string;
  targetType: "post" | "reply" | "member";
  targetId: string;
  reason: ReportReason;
  details: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: unknown;
}

export interface GroupSessionDoc extends SharedSessionState {
  id: string;
  groupId: string;
  finalizedAt: unknown;
}

export interface GroupChallengeDoc {
  id: string;
  groupId: string;
  kind: ChallengeKind;
  target: number;
  title: string;
  progress: ChallengeProgress;
  totalProgress: number;
  completed: boolean;
  rewardedUids: string[];
  startsAt: unknown;
  endsAt: unknown;
  createdBy: string;
  createdAt: unknown;
}

export type ProjectStatus = "not_started" | "in_progress" | "completed";

export interface ProjectDoc {
  id: string;
  userId: string;
  name: string;
  description: string;
  goal: string;
  startDate: string | null;
  deadline: string | null;
  status: ProjectStatus;
  notes: string;
  resources: { title: string; url: string }[];
  taskCount: number;
  completedTaskCount: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface ProjectTaskDoc {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  order: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export type ReportReason = "spam" | "abuse" | "irrelevant" | "inappropriate" | "harassment" | "contact_sharing" | "other";

export interface ReportDoc {
  id: string;
  reporterId: string;
  targetType: "user" | "buddy" | "group" | "group_post" | "group_reply";
  targetId: string;
  groupId: string | null;
  reason: ReportReason;
  details: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: unknown;
}

export interface BlockDoc {
  blockedUid: string;
  createdAt: unknown;
}

export interface GoodieCriteria {
  chapters: number;
  questions: number;
  streak: number;
}

export interface NinetyDayCriteria {
  activeDays: number;
  streak: number;
  studyHours: number;
  questions: number;
  chapters: number;
}

export interface RewardConfig {
  lessonXp: number;
  questionXpByDifficulty: Record<"1" | "2" | "3", number>;
  questionCoinsByDifficulty: Record<"1" | "2" | "3", number>;
  assessmentXpPerQuestion: number;
  assessmentCoinsPerCorrect: number;
  chapterCompleteXp: number;
  chapterCompleteCoins: number;
  challengeXp: number;
  challengeCoins: number;
  revisionXp: number;
  studyMinuteXp: number;
  streakDayMinutes: number;
  streakDayQuestions: number;
  spinCooldownHours: number;
  spinOutcomes: SpinOutcome[];
  aiDailyLimit: number;
  streakMilestones: number[];
  goodieCriteria: GoodieCriteria;
  ninetyDayCriteria: NinetyDayCriteria;
}
