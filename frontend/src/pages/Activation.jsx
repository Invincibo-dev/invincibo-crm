import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { collectionData } from "../lib/api";
import { clearToken } from "../lib/auth";

const statusLabels = {
  paid_training: "Formation payee",
  onboarding: "Onboarding",
  step1: "Etape 1",
  active: "Actif",
  inactive: "Inactif",
  blocked: "Bloque",
  at_risk: "A risque"
};

const actionOptions = [
  { value: "onboarding_start", label: "Demarrer onboarding" },
  { value: "step1_complete", label: "Etape 1 completee" },
  { value: "server_activated", label: "Serveur active" }
];

const emptyStudent = { name: "", phone: "", status: "paid_training" };

const Activation = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState(emptyStudent);
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleUnauthorized = useCallback(() => {
    clearToken();
    navigate("/login", { replace: true });
  }, [navigate]);

  const loadData = useCallback(async () => {
    const params = {
      page: 1,
      limit: 250,
      ...(selectedStatus !== "all" ? { status: selectedStatus } : {})
    };
    const [summaryRes, studentsRes] = await Promise.all([
      api.get("/activation/dashboard/summary"),
      api.get("/activation/students", { params })
    ]);
    setSummary(summaryRes.data);
    setStudents(collectionData(studentsRes.data));
  }, [selectedStatus]);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError("");
      try {
        await loadData();
      } catch (err) {
        if (err.response?.status === 401) {
          handleUnauthorized();
          return;
        }
        setError(err.response?.data?.message || "Erreur lors du chargement activation.");
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, [handleUnauthorized, loadData]);

  const counts = useMemo(() => {
    return Object.keys(statusLabels).map((status) => ({
      status,
      label: statusLabels[status],
      value: summary?.[status] || 0
    }));
  }, [summary]);

  const createStudent = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api.post("/activation/students", form);
      setForm(emptyStudent);
      setSuccess("Eleve cree.");
      await loadData();
    } catch (err) {
      if (err.response?.status === 401) return handleUnauthorized();
      setError(err.response?.data?.message || "Creation impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateProgress = async (student, action) => {
    setError("");
    setSuccess("");
    try {
      await api.patch(`/activation/students/${student.id}/status`, { status: action });
      setSuccess("Progression mise a jour.");
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Progression impossible.");
    }
  };

  const openActions = async (student) => {
    setSelectedStudent(student);
    setError("");
    try {
      const response = await api.get(`/activation/students/${student.id}/actions`);
      setActions(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError(err.response?.data?.message || "Actions introuvables.");
    }
  };

  const triggerRecovery = async (student) => {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api.post(`/activation/students/${student.id}/recovery`);
      setSuccess("Recovery lancee pour cet eleve.");
      await loadData();
      await openActions(student);
    } catch (err) {
      setError(err.response?.data?.message || "Recovery impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const checkAtRisk = async () => {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api.post("/activation/at-risk/check");
      setSuccess("Verification a risque terminee.");
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Verification impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const recoverBatch = async () => {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api.post("/activation/at-risk/recover");
      setSuccess("Recovery batch terminee.");
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Recovery batch impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-slate-600">Chargement activation...</p>
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
              Activation
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Suivi onboarding, risques et recovery WhatsApp.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/dashboard")}
            >
              Dashboard
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/support")}
            >
              Support
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/groups")}
            >
              Groupes
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
          </div>
        )}

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {counts.map((item) => (
            <div
              key={item.status}
              className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="text-2xl font-bold text-slate-900">{item.value}</div>
              <div className="text-xs font-semibold uppercase text-slate-500">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <form
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            onSubmit={createStudent}
          >
            <h2 className="font-semibold text-slate-900">Ajouter eleve</h2>
            <input
              className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2"
              placeholder="Nom"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <input
              className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2"
              placeholder="Telephone"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
            <select
              className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2"
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={submitting}
            >
              Creer
            </button>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
            <h2 className="font-semibold text-slate-900">Automation</h2>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                disabled={submitting}
                onClick={checkAtRisk}
              >
                Verifier a risque
              </button>
              <button
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={submitting}
                onClick={recoverBatch}
              >
                Recovery at-risk
              </button>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Eleves a surveiller</p>
              <p className="mt-1 text-sm text-slate-600">
                {summary?.at_risk_students?.length || 0} eleve(s) sans action recente.
              </p>
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2"
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value)}
          >
            <option value="all">Tous les statuts</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="text-sm text-slate-500">{students.length} eleve(s)</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Eleve</th>
                  <th className="px-4 py-3">Telephone</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Derniere action</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-500" colSpan="5">
                      Aucun eleve.
                    </td>
                  </tr>
                ) : (
                  students.map((student) => (
                    <tr key={student.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">{student.name}</td>
                      <td className="px-4 py-3 text-slate-600">{student.phone}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {statusLabels[student.status] || student.status}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {student.last_action_at
                          ? new Date(student.last_action_at).toLocaleString("fr-FR")
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {actionOptions.map((action) => (
                            <button
                              key={action.value}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                              onClick={() => updateProgress(student, action.value)}
                            >
                              {action.label}
                            </button>
                          ))}
                          <button
                            className="rounded-lg border border-sky-300 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50"
                            onClick={() => openActions(student)}
                          >
                            Historique
                          </button>
                          <button
                            className="rounded-lg border border-amber-300 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                            onClick={() => triggerRecovery(student)}
                          >
                            Recovery
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedStudent && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-slate-900">Historique - {selectedStudent.name}</h2>
            <div className="mt-3 space-y-2">
              {actions.length === 0 ? (
                <p className="text-sm text-slate-500">Aucune action.</p>
              ) : (
                actions.map((action) => (
                  <div key={action.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                    <div className="font-medium text-slate-900">{action.type}</div>
                    <div className="text-slate-600">{action.content}</div>
                    <div className="text-xs text-slate-500">
                      {new Date(action.created_at).toLocaleString("fr-FR")}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Activation;
