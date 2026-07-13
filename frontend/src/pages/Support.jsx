import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { collectionData } from "../lib/api";
import { clearToken } from "../lib/auth";

const typeLabels = {
  onboarding_issue: "Onboarding",
  payment_issue: "Paiement",
  server_activation_issue: "Activation serveur",
  motivation_issue: "Motivation",
  technical_issue: "Technique"
};

const priorityLabels = {
  urgent: "Urgent",
  normal: "Normal",
  low: "Faible"
};

const statusLabels = {
  pending: "En attente",
  in_progress: "En cours",
  resolved: "Resolue"
};

const priorityClasses = {
  urgent: "border-red-200 bg-red-50 text-red-700",
  normal: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-slate-200 bg-slate-100 text-slate-600"
};

const statusClasses = {
  pending: "border-slate-200 bg-white text-slate-700",
  in_progress: "border-sky-200 bg-sky-50 text-sky-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700"
};

const formatDate = (value) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
};

const Support = () => {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    priority: "all",
    status: "all",
    type: "all"
  });

  const handleUnauthorized = useCallback(() => {
    clearToken();
    navigate("/login", { replace: true });
  }, [navigate]);

  const loadTasks = useCallback(async () => {
    setError("");
    const response = await api.get("/activation/tasks", { params: { page: 1, limit: 250 } });
    setTasks(collectionData(response.data));
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [meRes] = await Promise.all([api.get("/auth/me"), loadTasks()]);
      setMe(meRes.data);
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err.response?.data?.message || "Erreur lors du chargement des taches support.");
    } finally {
      setLoading(false);
    }
  }, [handleUnauthorized, loadTasks]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filters.priority !== "all" && task.priority !== filters.priority) return false;
      if (filters.status !== "all" && task.status !== filters.status) return false;
      if (filters.type !== "all" && task.type !== filters.type) return false;
      return true;
    });
  }, [filters, tasks]);

  const setFilter = (field) => (event) => {
    setFilters((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const refreshAfterAction = async (handler) => {
    setActionId(handler.id);
    setError("");
    try {
      await handler.run();
      await loadTasks();
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err.response?.data?.message || "Action impossible pour le moment.");
    } finally {
      setActionId(null);
    }
  };

  const assignToMe = (task) => {
    if (!me?.id) return;
    refreshAfterAction({
      id: `assign-${task.id}`,
      run: () =>
        api.patch(`/activation/tasks/${task.id}/assign`, {
          assigned_to: me.id,
          notes: `Assignee a ${me.name || me.email}`
        })
    });
  };

  const resolveTask = (task) => {
    refreshAfterAction({
      id: `resolve-${task.id}`,
      run: () =>
        api.patch(`/activation/tasks/${task.id}/resolve`, {
          notes: `Resolue par ${me?.name || me?.email || "support"}`
        })
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-slate-600">Chargement des taches support...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Support
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Taches ouvertes pour debloquer les eleves.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/dashboard")}
            >
              Retour dashboard
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/contacts")}
            >
              Contacts
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/followups")}
            >
              Relances
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/groups")}
            >
              Groupes
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/activation")}
            >
              Activation
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={loadTasks}
            >
              Rafraichir
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3">
          <label className="text-sm font-medium text-slate-600">
            Priorite
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-700 outline-none focus:border-slate-500"
              value={filters.priority}
              onChange={setFilter("priority")}
            >
              <option value="all">Toutes</option>
              <option value="urgent">Urgent</option>
              <option value="normal">Normal</option>
              <option value="low">Faible</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-600">
            Statut
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-700 outline-none focus:border-slate-500"
              value={filters.status}
              onChange={setFilter("status")}
            >
              <option value="all">Tous</option>
              <option value="pending">En attente</option>
              <option value="in_progress">En cours</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-600">
            Type
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-700 outline-none focus:border-slate-500"
              value={filters.type}
              onChange={setFilter("type")}
            >
              <option value="all">Tous</option>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {filteredTasks.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
            Aucune tache ouverte pour ces filtres.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {filteredTasks.map((task) => (
              <div
                key={task.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {typeLabels[task.type] || task.type}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {task.student?.name || "Etudiant inconnu"} -{" "}
                      {task.student?.phone || "telephone inconnu"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityClasses[task.priority] || priorityClasses.normal}`}
                    >
                      {priorityLabels[task.priority] || task.priority}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses[task.status] || statusClasses.pending}`}
                    >
                      {statusLabels[task.status] || task.status}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 text-sm text-slate-600">
                  <p>
                    <span className="font-medium text-slate-700">Creee:</span>{" "}
                    {formatDate(task.created_at)}
                  </p>
                  <p>
                    <span className="font-medium text-slate-700">Assignee:</span>{" "}
                    {task.assignee?.name || task.assignee?.email || "Non assignee"}
                  </p>
                  <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-slate-700">
                    {task.notes || "Aucune note."}
                  </p>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => assignToMe(task)}
                    disabled={!me?.id || actionId === `assign-${task.id}`}
                  >
                    {actionId === `assign-${task.id}` ? "Assignation..." : "Assigner a moi"}
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => resolveTask(task)}
                    disabled={actionId === `resolve-${task.id}`}
                  >
                    {actionId === `resolve-${task.id}` ? "Resolution..." : "Resoudre"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Support;
