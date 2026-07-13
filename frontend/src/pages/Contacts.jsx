import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { collectionData } from "../lib/api";
import { clearToken } from "../lib/auth";

const emptyForm = {
  name: "",
  phone: "",
  email: "",
  source: "local",
  gender: "unknown"
};

const statusLabels = {
  new: "Nouveau",
  contacted: "Contacte",
  client: "Client",
  no_response: "Sans reponse"
};

const headerAliases = {
  name: ["name", "nom", "fullname", "full_name", "contact"],
  phone: ["phone", "telephone", "tel", "mobile", "whatsapp", "numero", "number"],
  email: ["email", "mail", "e-mail"]
};

const normalizeHeader = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

const splitDelimitedLine = (line, delimiter) => {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
};

const detectDelimiter = (line) => {
  const candidates = [",", ";", "\t"];
  return candidates
    .map((delimiter) => ({ delimiter, count: splitDelimitedLine(line, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
};

const mapHeaderIndexes = (headers) => {
  const normalized = headers.map(normalizeHeader);
  const indexes = {};

  Object.entries(headerAliases).forEach(([field, aliases]) => {
    indexes[field] = normalized.findIndex((header) => aliases.includes(header));
  });

  return indexes;
};

const hasKnownHeader = (headers) => {
  const indexes = mapHeaderIndexes(headers);
  return indexes.name >= 0 || indexes.phone >= 0;
};

const rowFromColumns = (columns, indexes = null) => {
  const get = (field, fallbackIndex) => {
    const index = indexes?.[field];
    return columns[index >= 0 ? index : fallbackIndex] || "";
  };

  return {
    name: get("name", 0),
    phone: get("phone", 1),
    email: get("email", 2),
    source: "import"
  };
};

const parseContacts = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return [];

  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .map((row) => ({
          name: row.name || row.nom || row.full_name || "",
          phone: row.phone || row.telephone || row.mobile || row.whatsapp || "",
          email: row.email || "",
          source: "import"
        }))
        .filter((row) => row.name && row.phone);
    } catch (_error) {
      return [];
    }
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const firstColumns = splitDelimitedLine(lines[0], delimiter);
  const withHeader = hasKnownHeader(firstColumns);
  const indexes = withHeader ? mapHeaderIndexes(firstColumns) : null;
  const dataLines = withHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => rowFromColumns(splitDelimitedLine(line, delimiter), indexes))
    .filter((row) => row.name && row.phone);
};

const Contacts = () => {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [leads, setLeads] = useState([]);
  const [tags, setTags] = useState([]);
  const [leadTags, setLeadTags] = useState({});
  const [tagForm, setTagForm] = useState("");
  const [tagSelection, setTagSelection] = useState({});
  const [form, setForm] = useState(emptyForm);
  const [importText, setImportText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [query, setQuery] = useState("");

  const handleUnauthorized = useCallback(() => {
    clearToken();
    navigate("/login", { replace: true });
  }, [navigate]);

  const loadData = useCallback(async () => {
    setError("");
    const [meRes, leadsRes, tagsRes] = await Promise.all([
      api.get("/auth/me"),
      api.get("/leads", { params: { page: 1, limit: 250 } }),
      api.get("/tags")
    ]);
    setMe(meRes.data);
    const leadRows = collectionData(leadsRes.data);
    setLeads(leadRows);
    setTags(Array.isArray(tagsRes.data) ? tagsRes.data : []);
    const tagPairs = await Promise.all(
      leadRows.map(async (lead) => {
        try {
          const response = await api.get(`/leads/${lead.id}/tags`);
          return [lead.id, response.data || []];
        } catch (_error) {
          return [lead.id, []];
        }
      })
    );
    setLeadTags(Object.fromEntries(tagPairs));
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
        setError(err.response?.data?.message || "Erreur lors du chargement des contacts.");
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, [handleUnauthorized, loadData]);

  const filteredLeads = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return leads;
    return leads.filter((lead) =>
      [lead.name, lead.phone, lead.email, lead.source, lead.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [leads, query]);

  const onChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const createContact = async (payload) => {
    return api.post("/leads", payload);
  };

  const submitOne = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await createContact(form);
      setForm(emptyForm);
      setSuccess("Contact cree. La sequence de relance a ete preparee.");
      await loadData();
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err.response?.data?.message || "Creation impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  const importContacts = async () => {
    const rows = parseContacts(importText);
    if (rows.length === 0) {
      setError("Importe un fichier ou colle au moins une ligne: nom, telephone, email, source.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");
    let created = 0;
    const failed = [];

    for (const row of rows) {
      try {
        await createContact(row);
        created += 1;
      } catch (err) {
        failed.push(`${row.name} (${err.response?.data?.message || "erreur"})`);
      }
    }

    await loadData();
    setSubmitting(false);
    setImportText("");
    setSuccess(
      `${created} contact(s) importe(s).${failed.length ? ` Echecs: ${failed.join(", ")}` : ""}`
    );
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "tsv", "txt", "json"].includes(extension)) {
      setError("Format non supporte pour l'instant. Utilise CSV, TSV, TXT ou JSON.");
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      setImportText(text);
      const rows = parseContacts(text);
      setSuccess(`${file.name} charge: ${rows.length} contact(s) valide(s) detecte(s).`);
      setError("");
    } catch (_error) {
      setError("Lecture du fichier impossible.");
    } finally {
      event.target.value = "";
    }
  };

  const updateStatus = async (lead, status) => {
    setError("");
    try {
      await api.put(`/leads/${lead.id}/status`, { status });
      await loadData();
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err.response?.data?.message || "Statut impossible a modifier.");
    }
  };

  const cancelSequence = async (lead) => {
    setError("");
    try {
      await api.put(`/leads/${lead.id}/cancel-sequence`);
      setSuccess("Sequence de relance annulee pour ce contact.");
      await loadData();
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err.response?.data?.message || "Annulation impossible.");
    }
  };

  const deleteLead = async (lead) => {
    setError("");
    try {
      await api.delete(`/leads/${lead.id}`);
      setSuccess("Contact supprime.");
      await loadData();
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err.response?.data?.message || "Suppression impossible.");
    }
  };

  const createTag = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      await api.post("/tags", { name: tagForm });
      setTagForm("");
      setSuccess("Tag cree.");
      await loadData();
    } catch (err) {
      if (err.response?.status === 401) return handleUnauthorized();
      setError(err.response?.data?.message || "Creation du tag impossible. Action reservee admin.");
    }
  };

  const addTag = async (lead) => {
    const tagId = tagSelection[lead.id];
    if (!tagId) return;
    setError("");
    setSuccess("");
    try {
      await api.post(`/leads/${lead.id}/tags`, { tag_id: Number(tagId) });
      setTagSelection((prev) => ({ ...prev, [lead.id]: "" }));
      setSuccess("Tag ajoute au contact.");
      await loadData();
    } catch (err) {
      if (err.response?.status === 401) return handleUnauthorized();
      setError(err.response?.data?.message || "Ajout du tag impossible.");
    }
  };

  const removeTag = async (lead, tag) => {
    setError("");
    setSuccess("");
    try {
      await api.delete(`/leads/${lead.id}/tags/${tag.id}`);
      setSuccess("Tag retire du contact.");
      await loadData();
    } catch (err) {
      if (err.response?.status === 401) return handleUnauthorized();
      setError(err.response?.data?.message || "Retrait du tag impossible.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-slate-600">Chargement des contacts...</p>
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
              Contacts
            </h1>
            <p className="mt-1 text-sm text-slate-500">Import, suivi et relance des leads CRM.</p>
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
              onClick={() => navigate("/followups")}
            >
              Relances
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

        <form
          className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          onSubmit={createTag}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm font-medium text-slate-600">
              Nouveau tag
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                placeholder="Ex: prospects interesses"
                value={tagForm}
                onChange={(event) => setTagForm(event.target.value)}
              />
            </label>
            <button
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={submitting || !tagForm.trim()}
            >
              Creer tag
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.length === 0 ? (
              <span className="text-sm text-slate-500">Aucun tag.</span>
            ) : (
              tags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
                >
                  {tag.name}
                </span>
              ))
            )}
          </div>
        </form>

        <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <form
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            onSubmit={submitOne}
          >
            <h2 className="text-lg font-semibold text-slate-900">Ajouter un contact</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                placeholder="Nom complet"
                value={form.name}
                onChange={onChange("name")}
                required
              />
              <input
                className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                placeholder="Telephone"
                value={form.phone}
                onChange={onChange("phone")}
                required
              />
              <input
                className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={onChange("email")}
              />
              <input
                className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                placeholder="Source"
                value={form.source}
                onChange={onChange("source")}
              />
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                value={form.gender}
                onChange={onChange("gender")}
              >
                <option value="unknown">Genre inconnu</option>
                <option value="female">Femme</option>
                <option value="male">Homme</option>
              </select>
              <button
                className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={submitting}
                type="submit"
              >
                Creer
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Importer des contacts</h2>
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
              <input
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
                type="file"
                accept=".csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json,text/plain"
                onChange={importFile}
              />
              <p className="mt-2 text-xs text-slate-500">
                Formats acceptes: CSV, TSV, TXT, JSON. Colonnes reconnues: name/nom,
                phone/telephone, email.
              </p>
            </div>
            <textarea
              className="mt-4 min-h-32 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              placeholder={
                "CSV avec ou sans en-tete:\nnom,telephone,email\nMarie Noel,+50912345678,marie@email.com"
              }
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                {parseContacts(importText).length} ligne(s) valide(s)
              </p>
              <button
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={submitting}
                onClick={importContacts}
              >
                Importer
              </button>
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <input
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-slate-500 sm:max-w-sm"
            placeholder="Rechercher nom, telephone, email..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <p className="text-sm text-slate-500">{filteredLeads.length} contact(s)</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Telephone</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Tags</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLeads.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-500" colSpan="7">
                      Aucun contact.
                    </td>
                  </tr>
                ) : (
                  filteredLeads.map((lead) => (
                    <tr key={lead.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{lead.name}</div>
                        <div className="text-xs text-slate-500">{lead.email || "email absent"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{lead.phone}</td>
                      <td className="px-4 py-3 text-slate-600">{lead.source || "-"}</td>
                      <td className="px-4 py-3 font-semibold text-slate-700">{lead.score}</td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {(leadTags[lead.id] || []).map((tag) => (
                            <button
                              key={tag.id}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => removeTag(lead, tag)}
                            >
                              {tag.name}
                            </button>
                          ))}
                        </div>
                        <div className="mt-2 flex gap-1">
                          <select
                            className="max-w-36 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                            value={tagSelection[lead.id] || ""}
                            onChange={(event) =>
                              setTagSelection((prev) => ({
                                ...prev,
                                [lead.id]: event.target.value
                              }))
                            }
                          >
                            <option value="">Tag</option>
                            {tags.map((tag) => (
                              <option key={tag.id} value={tag.id}>
                                {tag.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() => addTag(lead)}
                          >
                            Ajouter
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1"
                          value={lead.status}
                          onChange={(event) => updateStatus(lead, event.target.value)}
                        >
                          {Object.entries(statusLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() => navigate(`/followups?lead=${lead.id}`)}
                          >
                            Relance
                          </button>
                          <button
                            className="rounded-lg border border-amber-300 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                            onClick={() => cancelSequence(lead)}
                          >
                            Stop sequence
                          </button>
                          {me?.role === "admin" && (
                            <button
                              className="rounded-lg border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                              onClick={() => deleteLead(lead)}
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      </td>
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

export default Contacts;
