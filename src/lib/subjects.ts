import type { ClassLevel, Goal, LearningPath, SubjectCategory, SubjectId } from "./types";

/**
 * The only academic subjects EduOrbit knows. Every filter, form, route guard, seed
 * validator and Firestore rule derives from this list; nothing else may add a subject.
 */
export const SUBJECT_IDS: readonly SubjectId[] = ["physics", "chemistry", "mathematics", "biology"];

export const SUBJECT_NAMES: Record<SubjectId, string> = {
  physics: "Physics",
  chemistry: "Chemistry",
  mathematics: "Mathematics",
  biology: "Biology"
};

export const SUBJECTS_BY_PATH: Record<LearningPath, readonly SubjectId[]> = {
  school: ["physics", "chemistry", "mathematics", "biology"],
  jee: ["physics", "chemistry", "mathematics"],
  neet: ["physics", "chemistry", "biology"]
};

export const CATEGORY_NAMES: Record<Exclude<SubjectCategory, null>, string> = {
  physical_chemistry: "Physical Chemistry",
  organic_chemistry: "Organic Chemistry",
  inorganic_chemistry: "Inorganic Chemistry",
  botany: "Botany",
  zoology: "Zoology"
};

export const CLASS_LEVELS: readonly ClassLevel[] = [9, 10, 11, 12];

export function isSubjectId(value: unknown): value is SubjectId {
  return typeof value === "string" && (SUBJECT_IDS as readonly string[]).includes(value);
}

export function isClassLevel(value: unknown): value is ClassLevel {
  return typeof value === "number" && (CLASS_LEVELS as readonly number[]).includes(value);
}

export function parseClassLevel(raw: string | undefined): ClassLevel | null {
  const value = Number(raw);
  return isClassLevel(value) ? value : null;
}

/** Learning paths a goal enrols the student in. */
export function pathsForGoal(goal: Goal): LearningPath[] {
  switch (goal) {
    case "school":
      return ["school"];
    case "jee":
      return ["jee"];
    case "neet":
      return ["neet"];
    case "school_jee":
      return ["school", "jee"];
    case "school_neet":
      return ["school", "neet"];
  }
}

/** Subjects the student can pick given their goal (union over their paths). */
export function subjectsForGoal(goal: Goal): SubjectId[] {
  const allowed = new Set<SubjectId>();
  for (const path of pathsForGoal(goal)) for (const subject of SUBJECTS_BY_PATH[path]) allowed.add(subject);
  return SUBJECT_IDS.filter((subject) => allowed.has(subject));
}
