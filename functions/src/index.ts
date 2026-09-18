import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "asia-south1", maxInstances: 10 });

export { startLesson, completeLessonCallable as completeLesson, submitAnswerCallable as submitAnswer, recordStudySession } from "./callables/learning.js";
export { spinWheel, redeemReward } from "./callables/rewards.js";
export { askAi } from "./callables/askAi.js";
export { deleteAccount } from "./callables/account.js";
export { syncPublicProfile } from "./callables/profiles.js";
