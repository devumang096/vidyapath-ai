import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, deleteDoc, doc, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebase";
import { newId } from "../lib/format";
import { useAction, useLiveQuery } from "../hooks/useFirestore";
import { AsyncState, InlineError, Modal, PageHeader, ProgressBar, Tag } from "../components/ui";
import type { ProjectDoc, ProjectStatus, ProjectTaskDoc } from "../lib/types";

const STATUS_LABELS: Record<ProjectStatus, string> = { not_started: "Not Started", in_progress: "In Progress", completed: "Completed" };

function deriveStatus(taskCount: number, completedTaskCount: number, current: ProjectStatus): ProjectStatus {
  if (current === "completed") return "completed";
  if (taskCount > 0 && completedTaskCount === taskCount) return "completed";
  return completedTaskCount > 0 ? "in_progress" : current === "in_progress" ? "in_progress" : "not_started";
}

/**
 * Student projects: owner-writable documents validated by Firestore rules (no server round trip needed
 * because nothing here carries value). Progress = completed tasks / tasks, recalculated on every task change.
 */
export default function ProjectsPage() {
  const { projectId } = useParams();
  return projectId ? <ProjectDetail projectId={projectId} /> : <ProjectList />;
}

function ProjectList() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const projects = useLiveQuery<ProjectDoc>(() => (uid ? query(collection(db, "projects"), where("userId", "==", uid), orderBy("updatedAt", "desc")) : null), [uid]);
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Projects" subtitle="Plan school and personal projects with tasks, deadlines, notes and resources." action={<button type="button" className="btn-primary" onClick={() => setOpen(true)}>New project</button>} />
      <AsyncState loading={projects.loading} error={projects.error} empty={projects.data.length === 0} emptyTitle="Start your first project." emptyBody="Give it a name, a goal and a deadline, then break it into tasks." emptyAction={<button type="button" className="btn-primary" onClick={() => setOpen(true)}>Create a project</button>}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.data.map((project) => (
            <li key={project.id}>
              <Link to={`/projects/${project.id}`} className="card block h-full hover:border-brand-500">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{project.name}</p>
                  <Tag tone={project.status === "completed" ? "success" : project.status === "in_progress" ? "brand" : "neutral"}>{STATUS_LABELS[project.status]}</Tag>
                </div>
                {project.description && <p className="mt-1 text-sm text-ink-700">{project.description}</p>}
                <div className="mt-3"><ProgressBar value={project.taskCount ? (project.completedTaskCount / project.taskCount) * 100 : 0} label={`${project.completedTaskCount} of ${project.taskCount} tasks`} tone={project.status === "completed" ? "success" : "brand"} /></div>
                {project.deadline && <p className="mt-2 text-xs text-ink-500">Deadline {project.deadline}</p>}
              </Link>
            </li>
          ))}
        </ul>
      </AsyncState>
      <ProjectForm open={open} onClose={() => setOpen(false)} uid={uid} />
    </div>
  );
}

function ProjectForm({ open, onClose, uid, existing }: { open: boolean; onClose: () => void; uid: string; existing?: ProjectDoc }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: existing?.name ?? "", description: existing?.description ?? "", goal: existing?.goal ?? "", startDate: existing?.startDate ?? "", deadline: existing?.deadline ?? "" });
  const save = useAction(async () => {
    if (form.name.trim().length < 1) throw new Error("Give the project a name.");
    const id = existing?.id ?? newId().slice(0, 20);
    const base = { name: form.name.trim(), description: form.description.trim(), goal: form.goal.trim(), startDate: form.startDate || null, deadline: form.deadline || null, updatedAt: serverTimestamp() };
    if (existing) await updateDoc(doc(db, "projects", id), base);
    else await setDoc(doc(db, "projects", id), { id, userId: uid, ...base, status: "not_started", notes: "", resources: [], taskCount: 0, completedTaskCount: 0, createdAt: serverTimestamp() });
    onClose();
    if (!existing) navigate(`/projects/${id}`);
  });
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void save.run();
  }
  return (
    <Modal open={open} title={existing ? "Edit project" : "New project"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3 text-sm">
        <label className="block"><span className="label">Name</span><input className="input" maxLength={120} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="block"><span className="label">Description</span><textarea className="input" rows={2} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label className="block"><span className="label">Goal</span><input className="input" maxLength={500} value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Start date</span><input className="input" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
          <label className="block"><span className="label">Deadline</span><input className="input" type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label>
        </div>
        <InlineError message={save.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary" disabled={save.busy}>{save.busy ? "Saving..." : "Save"}</button></div>
      </form>
    </Modal>
  );
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const navigate = useNavigate();
  const projects = useLiveQuery<ProjectDoc>(() => (uid ? query(collection(db, "projects"), where("userId", "==", uid), where("id", "==", projectId)) : null), [uid, projectId]);
  const tasks = useLiveQuery<ProjectTaskDoc>(() => (uid ? query(collection(db, "projectTasks"), where("userId", "==", uid), where("projectId", "==", projectId), orderBy("order", "asc")) : null), [uid, projectId]);
  const project = projects.data[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [resource, setResource] = useState({ title: "", url: "" });

  async function syncCounts(next: ProjectTaskDoc[], statusOverride?: ProjectStatus) {
    if (!project) return;
    const completedTaskCount = next.filter((task) => task.done).length;
    await updateDoc(doc(db, "projects", project.id), { taskCount: next.length, completedTaskCount, status: statusOverride ?? deriveStatus(next.length, completedTaskCount, project.status), updatedAt: serverTimestamp() });
  }
  const addTask = useAction(async () => {
    if (!project || taskTitle.trim().length < 1) throw new Error("Enter a task title.");
    const id = newId().slice(0, 20);
    const task: ProjectTaskDoc = { id, projectId: project.id, userId: uid, title: taskTitle.trim(), done: false, dueDate: taskDue || null, order: tasks.data.length, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await setDoc(doc(db, "projectTasks", id), task);
    await syncCounts([...tasks.data, task]);
    setTaskTitle("");
    setTaskDue("");
  });
  const toggleTask = useAction(async (task: ProjectTaskDoc) => {
    await updateDoc(doc(db, "projectTasks", task.id), { done: !task.done, updatedAt: serverTimestamp() });
    await syncCounts(tasks.data.map((item) => (item.id === task.id ? { ...item, done: !task.done } : item)));
  });
  const removeTask = useAction(async (task: ProjectTaskDoc) => {
    await deleteDoc(doc(db, "projectTasks", task.id));
    await syncCounts(tasks.data.filter((item) => item.id !== task.id));
  });
  const saveNotes = useAction(async () => {
    if (!project || notes === null) return;
    await updateDoc(doc(db, "projects", project.id), { notes: notes.slice(0, 5000), updatedAt: serverTimestamp() });
    setNotes(null);
  });
  const addResource = useAction(async () => {
    if (!project || !resource.title.trim()) throw new Error("Give the resource a title.");
    await updateDoc(doc(db, "projects", project.id), { resources: [...project.resources, { title: resource.title.trim(), url: resource.url.trim() }].slice(0, 30), updatedAt: serverTimestamp() });
    setResource({ title: "", url: "" });
  });
  const setStatus = useAction(async (status: ProjectStatus) => {
    if (!project) return;
    await updateDoc(doc(db, "projects", project.id), { status, updatedAt: serverTimestamp() });
  });
  const remove = useAction(async () => {
    if (!project) return;
    for (const task of tasks.data) await deleteDoc(doc(db, "projectTasks", task.id));
    await deleteDoc(doc(db, "projects", project.id));
    navigate("/projects");
  });

  return (
    <div className="mx-auto max-w-4xl">
      <AsyncState loading={projects.loading} error={projects.error} empty={!projects.loading && !project} emptyTitle="Project not found" emptyBody="It may have been deleted." emptyAction={<Link to="/projects" className="btn-secondary">Back to projects</Link>}>
        {project && (
          <>
            <PageHeader title={project.name} subtitle={project.goal || project.description} crumbs={[{ label: "Projects", to: "/projects" }]} action={<div className="flex gap-2"><button type="button" className="btn-secondary" onClick={() => setEditing(true)}>Edit</button><button type="button" className="btn-danger" disabled={remove.busy} onClick={() => { if (window.confirm("Delete this project and its tasks?")) void remove.run(); }}>Delete</button></div>} />
            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-ink-500">Status</span>
                  <select className="input w-40" value={project.status} onChange={(event) => void setStatus.run(event.target.value as ProjectStatus)}>{(Object.keys(STATUS_LABELS) as ProjectStatus[]).map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select>
                </div>
                <p className="text-sm text-ink-500">{project.startDate ? `Started ${project.startDate}` : "No start date"}{project.deadline ? ` · Deadline ${project.deadline}` : ""}</p>
              </div>
              <div className="mt-3"><ProgressBar value={project.taskCount ? (project.completedTaskCount / project.taskCount) * 100 : 0} label={`${project.completedTaskCount} of ${project.taskCount} tasks complete`} tone={project.status === "completed" ? "success" : "brand"} /></div>
            </div>

            <section className="card mt-4">
              <h2 className="text-lg font-semibold">Tasks</h2>
              <AsyncState loading={tasks.loading} error={tasks.error} skeletonLines={2}>
                <ul className="mt-2 divide-y divide-ink-200">
                  {tasks.data.length === 0 && <li className="py-2 text-sm text-ink-500">No tasks yet. Add the first step below.</li>}
                  {tasks.data.map((task) => (
                    <li key={task.id} className="flex items-center gap-3 py-2 text-sm">
                      <input type="checkbox" checked={task.done} onChange={() => void toggleTask.run(task)} aria-label={`Mark ${task.title} ${task.done ? "not done" : "done"}`} />
                      <span className={`flex-1 ${task.done ? "line-through text-ink-500" : ""}`}>{task.title}</span>
                      {task.dueDate && <span className="text-xs text-ink-500">{task.dueDate}</span>}
                      <button type="button" className="btn-ghost py-1 text-xs" onClick={() => void removeTask.run(task)} aria-label={`Delete ${task.title}`}>Remove</button>
                    </li>
                  ))}
                </ul>
              </AsyncState>
              <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void addTask.run(); }}>
                <input className="input flex-1" placeholder="New task" maxLength={200} value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} aria-label="New task title" />
                <input className="input w-40" type="date" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} aria-label="Task due date" />
                <button type="submit" className="btn-primary" disabled={addTask.busy}>Add task</button>
              </form>
              <InlineError message={addTask.error ?? toggleTask.error ?? removeTask.error} />
            </section>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <section className="card">
                <h2 className="text-lg font-semibold">Notes</h2>
                <textarea className="input mt-2" rows={6} maxLength={5000} value={notes ?? project.notes} onChange={(event) => setNotes(event.target.value)} aria-label="Project notes" />
                {notes !== null && notes !== project.notes && <button type="button" className="btn-primary mt-2" disabled={saveNotes.busy} onClick={() => void saveNotes.run()}>Save notes</button>}
                <InlineError message={saveNotes.error} />
              </section>
              <section className="card">
                <h2 className="text-lg font-semibold">Resources</h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {project.resources.length === 0 && <li className="text-ink-500">No resources yet.</li>}
                  {project.resources.map((item, index) => (
                    <li key={`${item.title}-${index}`}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{item.title}</a> : item.title}</li>
                  ))}
                </ul>
                <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void addResource.run(); }}>
                  <input className="input" placeholder="Title" maxLength={120} value={resource.title} onChange={(event) => setResource({ ...resource, title: event.target.value })} aria-label="Resource title" />
                  <input className="input" placeholder="Link (optional)" type="url" value={resource.url} onChange={(event) => setResource({ ...resource, url: event.target.value })} aria-label="Resource link" />
                  <button type="submit" className="btn-secondary" disabled={addResource.busy}>Add resource</button>
                </form>
                <InlineError message={addResource.error} />
              </section>
            </div>
            {editing && <ProjectForm open onClose={() => setEditing(false)} uid={uid} existing={project} />}
          </>
        )}
      </AsyncState>
    </div>
  );
}
