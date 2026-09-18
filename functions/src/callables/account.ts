import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { auth, db, requireUid } from "../lib/admin.js";

/** Collections whose documents carry a userId field and belong to exactly one student. */
const OWNED_BY_USER_ID = [
  "questionAttempts", "topicMastery", "chapterProgress", "lessonProgress", "learningSessions", "assessmentAttempts",
  "xpTransactions", "coinTransactions", "spinHistory", "redemptions", "aiConversations", "aiMessages", "projects", "projectTasks", "reports"
];
const OWNED_BY_UID_FIELD = ["dailyActivity", "aiUsage"];
const KEYED_BY_UID = ["users", "publicProfiles", "streaks", "spinState", "studyPlans", "buddyPreferences"];
const SUBCOLLECTIONS = ["notifications/{uid}/items", "userBadges/{uid}/badges", "blocks/{uid}/users"];

async function deleteQuery(query: FirebaseFirestore.Query): Promise<void> {
  for (;;) {
    const snap = await query.limit(300).get();
    if (snap.empty) return;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    if (snap.size < 300) return;
  }
}

/**
 * Account deletion: removes every student-owned document, then the Auth user. Buddy pairs and
 * group memberships are ended so partners see an honest "left" state instead of a ghost member.
 */
export const deleteAccount = onCall({ timeoutSeconds: 300 }, async (request) => {
  const uid = requireUid(request);
  logger.info("Deleting account", { uid });
  for (const name of OWNED_BY_USER_ID) await deleteQuery(db.collection(name).where("userId", "==", uid));
  for (const name of OWNED_BY_UID_FIELD) await deleteQuery(db.collection(name).where("uid", "==", uid));
  for (const path of SUBCOLLECTIONS) await deleteQuery(db.collection(path.replace("{uid}", uid)));
  await deleteQuery(db.collection("buddyRequests").where("fromUid", "==", uid));
  await deleteQuery(db.collection("buddyRequests").where("toUid", "==", uid));
  await deleteQuery(db.collection("groupMembers").where("uid", "==", uid));
  await deleteQuery(db.collection("groupJoinRequests").where("uid", "==", uid));
  await deleteQuery(db.collection("groupInvitations").where("toUid", "==", uid));
  const pairs = await db.collection("buddies").where("members", "array-contains", uid).where("status", "==", "active").get();
  for (const pair of pairs.docs) await pair.ref.set({ status: "ended", endedBy: uid, endedAt: new Date() }, { merge: true });
  const batch = db.batch();
  for (const name of KEYED_BY_UID) batch.delete(db.doc(`${name}/${uid}`));
  await batch.commit();
  await auth.deleteUser(uid);
  return { deleted: true };
});
