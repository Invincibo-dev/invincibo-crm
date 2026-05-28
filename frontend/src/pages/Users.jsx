import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { clearToken } from "../lib/auth";

const Users = () => {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "agent"
  });

  const logout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const handleUnauthorized = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const fetchUsers = async () => {
    const usersRes = await api.get("/auth/users");
    setUsers(usersRes.data || []);
  };

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError("");
      try {
        const meRes = await api.get("/auth/me");
        setMe(meRes.data);
        if (meRes.data.role !== "admin") {
          setError("Acces refuse: cette page est reservee aux admins.");
          return;
        }
        await fetchUsers();
      } catch (err) {
        if (err.response?.status === 401) {
          handleUnauthorized();
          return;
        }
        setError(err.response?.data?.message || "Erreur de chargement des utilisateurs.");
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, []);

  const onChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      await api.post("/auth/register", {
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role
      });

      setSuccess("Agent cree avec succes.");
      setForm({ name: "", email: "", password: "", role: "agent" });
      await fetchUsers();
    } catch (err) {
      if (err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err.response?.data?.message || "Erreur lors de la creation de l'utilisateur.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-6xl rounded-2xl bg-white p-5 shadow-sm sm:p-6">
          <p className="text-slate-600">Chargement des utilisateurs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Gestion Utilisateurs</h1>
            <p className="mt-1 text-sm text-slate-500">Creation d'agents et suivi des comptes.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/dashboard")}
            >
              Retour dashboard
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/contacts")}
            >
              Contacts
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/followups")}
            >
              Relances
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/activation")}
            >
              Activation
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/groups")}
            >
              Groupes
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => navigate("/support")}
            >
              Support
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={logout}
            >
              Deconnexion
            </button>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          Connecte en tant que: <strong>{me?.name}</strong> ({me?.role})
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {me?.role === "admin" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h2 className="text-lg font-semibold text-slate-800">Creer un agent</h2>
              <form className="mt-4 space-y-3" onSubmit={onSubmit}>
                <input
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  placeholder="Nom complet"
                  value={form.name}
                  onChange={onChange("name")}
                  required
                />
                <input
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={onChange("email")}
                  required
                />
                <input
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  type="password"
                  placeholder="Mot de passe (min 8)"
                  value={form.password}
                  onChange={onChange("password")}
                  required
                  minLength={8}
                />
                <select
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  value={form.role}
                  onChange={onChange("role")}
                >
                  <option value="agent">agent</option>
                  <option value="admin">admin</option>
                </select>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={submitting}
                >
                  {submitting ? "Creation..." : "Creer utilisateur"}
                </button>
                {success && <p className="text-sm text-emerald-700">{success}</p>}
              </form>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h2 className="text-lg font-semibold text-slate-800">Utilisateurs</h2>
              <div className="mt-4 max-h-[420px] overflow-auto">
                <table className="min-w-[520px] w-full text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-2">Nom</th>
                      <th className="py-2">Email</th>
                      <th className="py-2">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-t border-slate-100 text-slate-700">
                        <td className="py-2">{u.name}</td>
                        <td className="py-2">{u.email}</td>
                        <td className="py-2">{u.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Users;
