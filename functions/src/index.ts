import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "asia-south1", maxInstances: 10 });

export { startLesson, completeLessonCallable as completeLesson, submitAnswerCallable as submitAnswer, recordStudySession } from "./callables/learning.js";
export { spinWheel, redeemReward } from "./callables/rewards.js";
export { startAssessment, submitAssessment } from "./callables/assessments.js";
export { createGroup, updateGroup, requestJoinGroup, respondJoinRequest, createGroupInviteCode, revokeGroupInviteCode, joinGroupWithCode, inviteToGroup, respondGroupInvitation, leaveGroup, removeGroupMember, setGroupRole, createGroupPost, createGroupReply, reactToGroupPost, markGroupHelpful, moderateGroupContent, reportInGroup, groupSessionAction, createGroupChallenge, refreshGroupChallenge } from "./callables/groups.js";
export { findBuddyCandidates, sendBuddyRequest, respondBuddyRequest, cancelBuddyRequest, unmatchBuddy, buddyRoomAction, createBuddyChallenge, refreshBuddyChallenge } from "./callables/buddy.js";
export { askAi } from "./callables/askAi.js";
export { deleteAccount } from "./callables/account.js";
export { syncPublicProfile } from "./callables/profiles.js";
