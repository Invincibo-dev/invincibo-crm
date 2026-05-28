import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { clearToken } from "../lib/auth";

const emptyGroupForm = { name: "", description: "", category: "" };
const emptyMessageForm = {
  message_template: "Bonjou {{name}}, mwen vle raple w etap ou poko fini an."
};

const Groups = () => {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [leads, setLeads] = useState([]);
  const [students, setStudents] = useState([]);
  const [groupForm, setGroupForm] = useState(emptyGroupForm);
  const [memberForm, setMemberForm] = useState({ contact_type: "lead", contact_id: "" });
  const [memberDetails, setMemberDetails] = useState({ problem_reason: "", notes: "" });
  const [csvText, setCsvText] = useState("");
  const [importSummary, setImportSummary] = useState(null);
  const [editingMember, setEditingMember] = useState(null);
  const [messageForm, setMessageForm] = useState(emptyMessageForm);
  const [preview, setPreview] = useState(null);
  const [sendSummary, setSendSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleUnauthorized = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const loadGroups = async () => {
    const response = await api.get("/groups");
    setGroups(response.data || []);
  };

  const loadGroup = async (id) => {
    if (!id) return;
    const response = await api.get(`/groups/${id}`);
    setSelectedGroup(response.data);
  };

  const loadData = async () => {
    const [groupsRes, leadsRes, studentsRes] = await Promise.all([
      api.get("/groups"),
      api.get("/leads"),
      api.get("/activation/students")
    ]);
    setGroups(groupsRes.data || []);
    setLeads(leadsRes.data || []);
    setStudents(studentsRes.data || []);
  };

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
        setError(err.response?.data?.message || "Erreur lors du chargement des groupes.");
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  const contactsForType = useMemo(() => {
    return memberForm.contact_type === "lead" ? leads : students;
  }, [memberForm.contact_type, leads, students]);

  const createGroup = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post("/groups", groupForm);
      setGroupForm(emptyGroupForm);
      setSuccess("Groupe cree.");
      await loadGroups();
      await loadGroup(response.data.id);
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err.response?.data?.message || "Creation du groupe impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const openGroup = async (group) => {
    setError("");
    setSuccess("");
    setPreview(null);
    setSendSummary(null);
    try {
      await loadGroup(group.id);
    } catch (err) {
      setError(err.response?.data?.message || "Groupe introuvable.");
    }
  };

  const addMember = async (event) => {
    event.preventDefault();
    if (!selectedGroup?.id) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api.post(`/groups/${selectedGroup.id}/members`, {
        contact_type: memberForm.contact_type,
        contact_id: Number(memberForm.contact_id),
        problem_reason: memberDetails.problem_reason,
        notes: memberDetails.notes
      });
      setMemberForm((prev) => ({ ...prev, contact_id: "" }));
      setMemberDetails({ problem_reason: "", notes: "" });
      setSuccess("Contact ajoute au groupe.");
      await loadGroup(selectedGroup.id);
      await loadGroups();
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err.response?.data?.message || "Ajout impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const removeMember = async (member) => {
    setError("");
    setSuccess("");
    try {
      await api.delete(`/groups/${selectedGroup.id}/members/${member.id}`);
      setSuccess("Contact retire du groupe.");
      await loadGroup(selectedGroup.id);
      await loadGroups();
    } catch (err) {
      setError(err.response?.data?.message || "Retrait impossible.");
    }
  };

  const importCsv = async () => {
    if (!selectedGroup?.id) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(`/groups/${selectedGroup.id}/import-csv`, { csv: csvText });
      setImportSummary(response.data);
      setCsvText("");
      setSuccess(`Import termine: ${response.data.added_to_group} ajoute(s), ${response.data.duplicates_ignored} doublon(s), ${response.data.invalid} invalide(s).`);
      await loadData();
      await loadGroup(selectedGroup.id);
    } catch (err) {
      setError(err.response?.data?.message || "Import impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const importCsvFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "tsv", "txt"].includes(extension)) {
      setError("Format supporte: CSV, TSV ou TXT.");
      event.target.value = "";
      return;
    }
    try {
      setCsvText(await file.text());
      setImportSummary(null);
      setSuccess(`${file.name} charge. Verifie puis lance l'import.`);
    } catch (_error) {
      setError("Lecture du fichier impossible.");
    } finally {
      event.target.value = "";
    }
  };

  const startEditMember = (member) => {
    setEditingMember({
      id: member.id,
      problem_reason: member.problem_reason || "",
      notes: member.notes || ""
    });
  };

  const saveMember = async () => {
    if (!selectedGroup?.id || !editingMember?.id) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api.patch(`/groups/${selectedGroup.id}/members/${editingMember.id}`, {
        problem_reason: editingMember.problem_reason,
        notes: editingMember.notes
      });
      setEditingMember(null);
      setSuccess("Probleme et notes modifies.");
      await loadGroup(selectedGroup.id);
    } catch (err) {
      setError(err.response?.data?.message || "Modification impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const dryRun = async () => {
    if (!selectedGroup?.id) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    setSendSummary(null);
    try {
      const response = await api.post(`/groups/${selectedGroup.id}/send-message`, {
        message_template: messageForm.message_template,
        dry_run: true
      });
      setPreview(response.data);
      setSuccess("Apercu genere. Verifie les messages avant envoi.");
    } catch (err) {
      setError(err.response?.data?.message || "Apercu impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedGroup?.id || !preview?.preview_token) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(`/groups/${selectedGroup.id}/send-message`, {
        message_template: messageForm.message_template,
        dry_run: false,
        preview_token: preview.preview_token
      });
      setSendSummary(response.data);
      setPreview(null);
      setSuccess("Envoi groupe termine.");
      await loadGroup(selectedGroup.id);
    } catch (err) {
      setError(err.response?.data?.message || "Envoi impossible. Lance d'abord un apercu.");
    } finally {
      setSubmitting(false);
    }
  };

  const previewStillMatches = preview && preview.recipients && preview.total_targets >= 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-slate-600">Chargement des groupes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Groupes</h1>
            <p className="mt-1 text-sm text-slate-500">Segments internes pour relances controlees.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100" onClick={() => navigate("/dashboard")}>Dashboard</button>
            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100" onClick={() => navigate("/contacts")}>Contacts</button>
            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100" onClick={() => navigate("/followups")}>Relances</button>
            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100" onClick={() => navigate("/activation")}>Activation</button>
          </div>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div>}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="space-y-4">
            <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" onSubmit={createGroup}>
              <h2 className="text-lg font-semibold text-slate-900">Creer groupe</h2>
              <input className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500" placeholder="Nom du groupe" value={groupForm.name} onChange={(event) => setGroupForm((prev) => ({ ...prev, name: event.target.value }))} required />
              <input className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500" placeholder="Categorie" value={groupForm.category} onChange={(event) => setGroupForm((prev) => ({ ...prev, category: event.target.value }))} />
              <textarea className="mt-3 min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500" placeholder="Fonction / description" value={groupForm.description} onChange={(event) => setGroupForm((prev) => ({ ...prev, description: event.target.value }))} />
              <button className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60" disabled={submitting}>Creer</button>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Liste</h2>
              <div className="mt-3 space-y-2">
                {groups.length === 0 ? (
                  <p className="text-sm text-slate-500">Aucun groupe.</p>
                ) : (
                  groups.map((group) => (
                    <button key={group.id} className={`w-full rounded-xl border px-3 py-2 text-left text-sm hover:bg-slate-50 ${selectedGroup?.id === group.id ? "border-slate-900" : "border-slate-200"}`} onClick={() => openGroup(group)}>
                      <span className="block font-semibold text-slate-900">{group.name}</span>
                      <span className="text-xs text-slate-500">{group.members_count || 0} membre(s)</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="xl:col-span-2">
            {!selectedGroup ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Selectionne un groupe.</div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-xl font-semibold text-slate-900">{selectedGroup.name}</h2>
                  <p className="mt-1 text-sm font-medium text-slate-600">{selectedGroup.category || "Sans categorie"}</p>
                  <p className="mt-1 text-sm text-slate-500">{selectedGroup.description || "Aucune description."}</p>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" onSubmit={addMember}>
                    <h3 className="font-semibold text-slate-900">Ajouter contact existant</h3>
                    <select className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2" value={memberForm.contact_type} onChange={(event) => setMemberForm({ contact_type: event.target.value, contact_id: "" })}>
                      <option value="lead">Lead</option>
                      <option value="student">Eleve</option>
                    </select>
                    <select className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2" value={memberForm.contact_id} onChange={(event) => setMemberForm((prev) => ({ ...prev, contact_id: event.target.value }))} required>
                      <option value="">Choisir</option>
                      {contactsForType.map((contact) => (
                        <option key={contact.id} value={contact.id}>{contact.name} - {contact.phone}</option>
                      ))}
                    </select>
                    <input className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Probleme / raison" value={memberDetails.problem_reason} onChange={(event) => setMemberDetails((prev) => ({ ...prev, problem_reason: event.target.value }))} />
                    <textarea className="mt-3 min-h-20 w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Notes" value={memberDetails.notes} onChange={(event) => setMemberDetails((prev) => ({ ...prev, notes: event.target.value }))} />
                    <button className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60" disabled={submitting}>Ajouter</button>
                  </form>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h3 className="font-semibold text-slate-900">Importer CSV</h3>
                    <input className="mt-3 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values" onChange={importCsvFile} />
                    <textarea className="mt-3 min-h-28 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder={"name,phone,email,problem_reason,notes\nMarie Noel,+50912345678,marie@email.com,Client non paye,A rappeler"} value={csvText} onChange={(event) => {
                      setCsvText(event.target.value);
                      setImportSummary(null);
                    }} />
                    <button className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60" disabled={submitting} onClick={importCsv}>Importer dans le groupe</button>
                    {importSummary && (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        Total: {importSummary.total_rows} - Crees: {importSummary.created} - Existants: {importSummary.existing} - Ajoutes: {importSummary.added_to_group} - Doublons: {importSummary.duplicates_ignored} - Invalides: {importSummary.invalid}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="font-semibold text-slate-900">Membres</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Nom</th>
                          <th className="px-3 py-2">Telephone</th>
                          <th className="px-3 py-2">Email</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Probleme</th>
                          <th className="px-3 py-2">Notes</th>
                          <th className="px-3 py-2">Ajout</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(selectedGroup.members || []).length === 0 ? (
                          <tr><td className="px-3 py-6 text-center text-slate-500" colSpan="8">Aucun membre.</td></tr>
                        ) : (
                          selectedGroup.members.map((member) => (
                            <tr key={member.id} className="align-top">
                              <td className="px-3 py-2 font-medium text-slate-900">{member.contact?.name || "Contact supprime"}</td>
                              <td className="px-3 py-2 text-slate-600">{member.contact?.phone || "-"}</td>
                              <td className="px-3 py-2 text-slate-600">{member.contact?.email || "-"}</td>
                              <td className="px-3 py-2 text-slate-600">{member.contact_type}</td>
                              <td className="px-3 py-2 text-slate-600">{member.problem_reason || "-"}</td>
                              <td className="px-3 py-2 text-slate-600">{member.notes || "-"}</td>
                              <td className="px-3 py-2 text-slate-600">{new Date(member.created_at).toLocaleDateString("fr-FR")}</td>
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap gap-2">
                                  <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100" onClick={() => startEditMember(member)}>Modifier</button>
                                  <button className="rounded-lg border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50" onClick={() => removeMember(member)}>Retirer</button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {editingMember && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <h4 className="font-semibold text-slate-900">Modifier probleme / notes</h4>
                      <input className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Probleme / raison" value={editingMember.problem_reason} onChange={(event) => setEditingMember((prev) => ({ ...prev, problem_reason: event.target.value }))} />
                      <textarea className="mt-3 min-h-20 w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Notes" value={editingMember.notes} onChange={(event) => setEditingMember((prev) => ({ ...prev, notes: event.target.value }))} />
                      <div className="mt-3 flex gap-2">
                        <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60" disabled={submitting} onClick={saveMember}>Enregistrer</button>
                        <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100" onClick={() => setEditingMember(null)}>Annuler</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="font-semibold text-slate-900">Relance groupe</h3>
                  <textarea className="mt-3 min-h-28 w-full rounded-xl border border-slate-300 px-3 py-2" value={messageForm.message_template} onChange={(event) => {
                    setMessageForm({ message_template: event.target.value });
                    setPreview(null);
                  }} />
                  <p className="mt-2 text-xs text-slate-500">Variables: {"{{name}}"}, {"{{phone}}"}, {"{{groupName}}"}. Apercu obligatoire avant envoi.</p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60" disabled={submitting} onClick={dryRun}>Apercu / dry run</button>
                    <button className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60" disabled={submitting || !previewStillMatches} onClick={sendMessage}>Envoyer apres apercu</button>
                  </div>

                  {preview && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">Apercu: {preview.total_targets} destinataire(s)</div>
                      <div className="mt-2 max-h-64 space-y-2 overflow-auto">
                        {preview.recipients.map((item) => (
                          <div key={item.member_id} className="rounded-lg bg-white p-2 text-sm">
                            <div className="font-medium text-slate-800">{item.name} - {item.phone}</div>
                            <div className="text-slate-600">{item.message}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {sendSummary && (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      Total: {sendSummary.total_targets} - Envoyes: {sendSummary.sent} - Cooldown: {sendSummary.skipped_cooldown} - Erreurs: {sendSummary.errors}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Groups;
