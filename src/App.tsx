import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { AppShell } from "./components/AppShell";
import { PublicLayout } from "./components/PublicLayout";
import { Spinner } from "./components/ui";
import { demoMode, firebaseConfigured } from "./lib/firebase";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const StaticPage = lazy(() => import("./pages/StaticPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const LearnPage = lazy(() => import("./pages/LearnPage"));
const ChapterPage = lazy(() => import("./pages/ChapterPage"));
const TopicPage = lazy(() => import("./pages/TopicPage"));
const PracticePage = lazy(() => import("./pages/PracticePage"));
const AssessmentsPage = lazy(() => import("./pages/AssessmentsPage"));
const ExamPage = lazy(() => import("./pages/ExamPage"));
const OrbitAiPage = lazy(() => import("./pages/OrbitAiPage"));
const BuddyPage = lazy(() => import("./pages/BuddyPage"));
const GroupsPage = lazy(() => import("./pages/GroupsPage"));
const ProgressPage = lazy(() => import("./pages/ProgressPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const RewardsPage = lazy(() => import("./pages/RewardsPage"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

function FullPageSpinner() {
  return <div className="flex min-h-screen items-center justify-center"><Spinner label="Loading EduOrbit..." /></div>;
}

/** Protected area: signed in, profile present, onboarding done. The requested URL is restored after login. */
function RequireAuth() {
  const { user, profile, loading, profileError } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (profileError) return <div className="p-6"><div className="card text-danger-500" role="alert">{profileError}</div></div>;
  if (!profile) return <Navigate to="/signup" replace state={{ completeProfile: true }} />;
  if (!profile.onboardingComplete && location.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;
  if (profile.onboardingComplete && location.pathname === "/onboarding") return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function RequireAdmin() {
  const { isAdmin, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

/** Login and signup send an already signed-in student straight to the dashboard. */
function PublicOnly() {
  const { user, profile, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (user && profile) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="card max-w-md text-center" role="alert">
            <p className="font-semibold">Something went wrong.</p>
            <p className="mt-1 text-sm text-ink-500">The page hit an unexpected error. Reloading usually fixes it.</p>
            <button type="button" className="btn-primary mt-4" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  if (!firebaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card max-w-lg">
          <p className="font-semibold">Firebase is not configured.</p>
          <p className="mt-2 text-sm text-ink-700">Copy <code>.env.example</code> to <code>.env</code>, fill in your Firebase web app values, then restart the dev server. See README.md, section "Firebase setup".</p>
        </div>
      </div>
    );
  }
  return (
    <ErrorBoundary>
      {demoMode && <p className="fixed bottom-16 right-3 z-50 rounded-full bg-ink-900 px-3 py-1 text-xs text-white shadow lg:bottom-3">Demo mode: data stays in this browser</p>}
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/about" element={<StaticPage page="about" />} />
            <Route path="/safety" element={<StaticPage page="safety" />} />
            <Route path="/guidelines" element={<StaticPage page="guidelines" />} />
            <Route path="/privacy" element={<StaticPage page="privacy" />} />
            <Route path="/terms" element={<StaticPage page="terms" />} />
            <Route path="/cookies" element={<StaticPage page="cookies" />} />
            <Route path="/account-deletion" element={<StaticPage page="accountDeletion" />} />
            <Route path="/contact" element={<StaticPage page="contact" />} />
            <Route path="/help" element={<StaticPage page="help" />} />
          </Route>
          <Route element={<PublicOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Route>
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/register" element={<Navigate to="/signup" replace />} />
          <Route element={<RequireAuth />}>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/learn" element={<LearnPage />} />
              <Route path="/learn/:classLevel" element={<LearnPage />} />
              <Route path="/learn/:classLevel/:subjectId" element={<LearnPage />} />
              <Route path="/learn/:classLevel/:subjectId/:chapterSlug" element={<ChapterPage />} />
              <Route path="/learn/:classLevel/:subjectId/:chapterSlug/:topicSlug" element={<TopicPage />} />
              <Route path="/practice" element={<PracticePage />} />
              <Route path="/assessments" element={<AssessmentsPage />} />
              <Route path="/jee" element={<ExamPage examTag="jee" />} />
              <Route path="/jee/:subjectId" element={<ExamPage examTag="jee" />} />
              <Route path="/jee/:subjectId/:chapterId" element={<ChapterPage examTag="jee" />} />
              <Route path="/neet" element={<ExamPage examTag="neet" />} />
              <Route path="/neet/:subjectId" element={<ExamPage examTag="neet" />} />
              <Route path="/neet/:subjectId/:chapterId" element={<ChapterPage examTag="neet" />} />
              <Route path="/orbitai" element={<OrbitAiPage />} />
              <Route path="/buddy" element={<BuddyPage />} />
              <Route path="/buddy/room" element={<BuddyPage room />} />
              <Route path="/groups" element={<GroupsPage />} />
              <Route path="/groups/create" element={<GroupsPage view="create" />} />
              <Route path="/groups/:groupId" element={<GroupsPage view="detail" />} />
              <Route path="/groups/:groupId/discussion" element={<GroupsPage view="discussion" />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/rewards" element={<RewardsPage />} />
              <Route path="/rewards/:rewardId" element={<RewardsPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:projectId" element={<ProjectsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route element={<RequireAdmin />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
