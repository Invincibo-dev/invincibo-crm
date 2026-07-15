import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api, { collectionData } from "../lib/api";
import { clearToken } from "../lib/auth";

const defaultDateTime = () => {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const FollowUps = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const leadFromQuery = new URLSearchParams(location.search).get("lead") || "";
  const [me, setMe] = useState(null);
  const [leads, setLeads] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [reviewFollowups, setReviewFollowups] = useState([]);
  const [reviewNotes, setReviewNotes] = useState({});
  const [reviewingId, setReviewingId] = useState(null);
  const [form, setForm] = useState({
    lead_id: leadFromQuery,
    scheduled_date: defaultDateTime(),
    message: "",
    sequence_step: 0
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const handleUnauthorized = useCallback(() => {
    clearToken();
    navigate("/login", { replace: true });
  }, [navigate]);

  const loadData = useCallback(async () => {
    setError("");
    const [meRes, leadsRes, followupsRes] = await Promise.all([
      api.get("/auth/me"),
      api.get("/leads", { params: { page: 1, limit: 250 } }),
      api.get("/followups/pending", { params: { page: 1, limit: 250 } })
    ]);
    setMe(meRes.data);
    setLeads(collectionData(leadsRes.data));
    setFollowups(collectionData(followupsRes.data));
    if (meRes.data?.role === "admin") {
      const reviewRes = await api.get("/followups/review", { params: { page: 1, limit: 100 } });
      setReviewFollowups(collectionData(reviewRes.data));
    } else {
      setReviewFollowups([]);
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      try {
        await loadData();
      } catch (err) {
        if (err.response?.status === 401) {
          handleUnauthorized();
          return;
        }
        setError(err.response?.data?.message || "Erreur lors du chargement des relances.");
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, [handleUnauthorized, loadData]);

  const filteredFollowups = useMemo(() => {
    if (statusFilter === "all") return followups;
    return followups.filter((item) => item.lead?.status === statusFilter);
  }, [followups, statusFilter]);

  const selectedLead = leads.find((lead) => String(lead.id) === String(form.lead_id));

  const onChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const createFollowup = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api.post("/followups", {
        lead_id: Number(form.lead_id),
        scheduled_date: new Date(form.scheduled_date).toISOString(),
        message: form.message,
        sequence_step: Number(form.sequence_step) || 0
      });
      setForm((prev) => ({
        ...prev,
        scheduled_date: defaultDateTime(),
        message: "",
        sequence_step: 0
      }));
      setSuccess("Relance creee.");
      await loadData();
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err.response?.data?.message || "Creation de relance impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const processDueFollowups = async () => {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post("/followups/process");
      const result = response.data?.result || {};
      setSuccess(
        `Traitement termine: ${result.accepted || 0} acceptee(s), ${result.failed || 0} echec(s), ${result.skipped || 0} ignoree(s).`
      );
      await loadData();
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(
        err.response?.data?.message ||
          "Traitement impossible. Verifie les droits admin et la configuration WhatsApp."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const runRecoveryDryRun = async () => {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post("/followups/recovery/run", { dry_run: true, limit: 100 });
      const result = response.data?.result || {};
      setSuccess(
        `Analyse sans modification: ${result.scanned || 0} inspectee(s), ${result.needs_review || 0} a verifier, ${result.returned_to_pending || 0} retour(s) proposes.`
      );
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Analyse des relances bloquees impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitReview = async (item, decision) => {
    const note = String(reviewNotes[item.id] || "").trim();
    if (!note) {
      setError("Une note est obligatoire pour toute decision manuelle.");
      return;
    }
    if (!window.confirm("Confirmer cette decision ? Aucun message ne sera envoye.")) return;

    setReviewingId(item.id);
    setError("");
    setSuccess("");
    try {
      await api.patch(`/followups/${item.id}/review`, { decision, note });
      setSuccess("Decision de revision enregistree sans envoi WhatsApp.");
      setReviewNotes((previous) => ({ ...previous, [item.id]: "" }));
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Revision impossible.");
    } finally {
      setReviewingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-slate-600">Chargement des relances...</p>
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
              Relances
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Messages planifies et traitement WhatsApp des relances dues.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/dashboard")}
            >
              Dashboard
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/contacts")}
            >
              Contacts
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/groups")}
            >
              Groupes
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/activation")}
            >
              Activation
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/support")}
            >
              Support
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

        {me?.role === "admin" && (
          <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">À vérifier</h2>
                <p className="text-sm text-slate-600">
                  Relances ambiguës à décider manuellement. Aucun message n’est envoyé ici.
                </p>
              </div>
              <button
                className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 disabled:opacity-60"
                disabled={submitting}
                onClick={runRecoveryDryRun}
              >
                Analyser les blocages (dry-run)
              </button>
            </div>

            {reviewFollowups.length === 0 ? (
              <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-500">
                Aucune relance à vérifier.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {reviewFollowups.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-amber-200 bg-white p-4"
                  >
                    <div className="grid gap-2 text-sm md:grid-cols-3">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {item.lead?.name || "Contact inconnu"}
                        </div>
                        <div className="text-slate-500">{item.lead?.phone || "-"}</div>
                      </div>
                      <div className="text-slate-600">
                        <div>Motif : {item.review_reason || "non renseigné"}</div>
                        <div>WAMID : {item.provider_message_id || "absent"}</div>
                        <div>Meta : {item.meta_status || "inconnu"}</div>
                      </div>
                      <div className="text-slate-600">
                        <div>Consentement : {item.consent?.allowed ? "valide" : "bloqué"}</div>
                        <div>Tentatives : {item.attempt_count}</div>
                        <div>
                          Activité :{" "}
                          {new Date(item.updated_at || item.scheduled_date).toLocaleString("fr-FR")}
                        </div>
                        <div>Conseil : {item.system_recommendation}</div>
                      </div>
                    </div>
                    <textarea
                      className="mt-3 min-h-20 w-full rounded-xl border border-slate-300 px-3 py-2"
                      placeholder="Note obligatoire"
                      value={reviewNotes[item.id] || ""}
                      onChange={(event) =>
                        setReviewNotes((previous) => ({
                          ...previous,
                          [item.id]: event.target.value
                        }))
                      }
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-60"
                        disabled={reviewingId === item.id}
                        onClick={() => submitReview(item, "mark_completed")}
                      >
                        Marquer terminé
                      </button>
                      <button
                        className="rounded-lg bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-60"
                        disabled={reviewingId === item.id}
                        onClick={() => submitReview(item, "mark_failed")}
                      >
                        Marquer échoué
                      </button>
                      <button
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
                        disabled={reviewingId === item.id}
                        onClick={() => submitReview(item, "cancel")}
                      >
                        Annuler
                      </button>
                      {item.return_to_pending_allowed && (
                        <button
                          className="rounded-lg border border-blue-300 px-3 py-2 text-sm text-blue-800 disabled:opacity-60"
                          disabled={reviewingId === item.id}
                          onClick={() => submitReview(item, "return_to_pending")}
                        >
                          Remettre en attente
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <form
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            onSubmit={createFollowup}
          >
            <h2 className="text-lg font-semibold text-slate-900">Planifier une relance</h2>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                value={form.lead_id}
                onChange={onChange("lead_id")}
                required
              >
                <option value="">Choisir un contact</option>
                {leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name} - {lead.phone}
                  </option>
                ))}
              </select>
              {selectedLead && (
                <p className="text-sm text-slate-500">
                  Statut: {selectedLead.status} - Score: {selectedLead.score}
                </p>
              )}
              <input
                className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                type="datetime-local"
                value={form.scheduled_date}
                onChange={onChange("scheduled_date")}
                required
              />
              <textarea
                className="min-h-32 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                placeholder="Message de relance"
                value={form.message}
                onChange={onChange("message")}
                required
              />
              <button
                className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={submitting}
                type="submit"
              >
                Planifier
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Bulk messages</h2>
            <p className="mt-2 text-sm text-slate-600">
              Cette action traite uniquement les relances deja planifiees et dues. Elle evite les
              envois libres non controles.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-2xl font-bold text-slate-900">{followups.length}</div>
                <div className="text-xs font-medium uppercase text-slate-500">En attente</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-2xl font-bold text-slate-900">
                  {followups.filter((item) => new Date(item.scheduled_date) <= new Date()).length}
                </div>
                <div className="text-xs font-medium uppercase text-slate-500">Dues</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-2xl font-bold text-slate-900">{me?.role || "-"}</div>
                <div className="text-xs font-medium uppercase text-slate-500">Role</div>
              </div>
            </div>
            <button
              className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={submitting || me?.role !== "admin"}
              onClick={processDueFollowups}
            >
              Envoyer les relances dues
            </button>
            {me?.role !== "admin" && (
              <p className="mt-2 text-sm text-slate-500">Action reservee aux admins.</p>
            )}
          </div>
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-slate-500"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">Tous les statuts lead</option>
            <option value="new">Nouveau</option>
            <option value="contacted">Contacte</option>
            <option value="client">Client</option>
            <option value="no_response">Sans reponse</option>
          </select>
          <p className="text-sm text-slate-500">{filteredFollowups.length} relance(s)</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Message</th>
                  <th className="px-4 py-3">Statut lead</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredFollowups.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-500" colSpan="4">
                      Aucune relance en attente.
                    </td>
                  </tr>
                ) : (
                  filteredFollowups.map((item) => (
                    <tr key={item.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {item.lead?.name || "Contact inconnu"}
                        </div>
                        <div className="text-xs text-slate-500">{item.lead?.phone || "-"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {new Date(item.scheduled_date).toLocaleString("fr-FR")}
                      </td>
                      <td className="max-w-xl px-4 py-3 text-slate-600">{item.message}</td>
                      <td className="px-4 py-3 text-slate-600">{item.lead?.status || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FollowUps;
