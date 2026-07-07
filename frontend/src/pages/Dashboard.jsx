import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { clearToken } from "../lib/auth";
import StatCard from "../components/StatCard";
import ConversionChart from "../components/ConversionChart";
import TagBarChart from "../components/TagBarChart";

const emptyStats = {
  total_leads: 0,
  total_clients: 0,
  conversion_rate: 0,
  hot_leads: 0,
  cold_leads: 0,
  messages_sent: 0,
  followups_pending: 0,
  leads_by_tag: []
};

const normalizeStats = (data) => {
  const source = data && typeof data === "object" ? data : {};
  return {
    ...emptyStats,
    ...source,
    total_leads: Number(source.total_leads) || 0,
    total_clients: Number(source.total_clients) || 0,
    conversion_rate: Number(source.conversion_rate) || 0,
    hot_leads: Number(source.hot_leads) || 0,
    cold_leads: Number(source.cold_leads) || 0,
    messages_sent: Number(source.messages_sent) || 0,
    followups_pending: Number(source.followups_pending) || 0,
    leads_by_tag: Array.isArray(source.leads_by_tag) ? source.leads_by_tag : []
  };
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [stats, setStats] = useState(emptyStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");

  const fetchStats = async (tag) => {
    setLoading(true);
    setError("");

    try {
      const params = tag && tag !== "all" ? { tag } : {};
      const response = await api.get("/dashboard/stats", { params });
      setStats(normalizeStats(response.data));
    } catch (err) {
      if (err.response?.status === 401) {
        clearToken();
        navigate("/login", { replace: true });
        return;
      }
      setError(err.response?.data?.message || "Erreur lors du chargement du dashboard.");
    } finally {
      setLoading(false);
    }
  };

  const fetchMe = async () => {
    try {
      const response = await api.get("/auth/me");
      setMe(response.data);
    } catch (err) {
      if (err.response?.status === 401) {
        clearToken();
        navigate("/login", { replace: true });
      }
    }
  };

  useEffect(() => {
    fetchStats(selectedTag);
  }, [selectedTag]);

  useEffect(() => {
    fetchMe();
  }, []);

  const tagOptions = useMemo(() => {
    const names = (stats.leads_by_tag || []).map((item) => item.tag || item.name).filter(Boolean);
    return ["all", ...new Set(names)];
  }, [stats.leads_by_tag]);

  const logout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl animate-pulse rounded-2xl bg-white p-5 shadow-sm sm:p-6">
          <p className="text-slate-600">Chargement du dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700 sm:p-6">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">CRM Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Vue globale de performance commerciale</p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-72">
            <label className="block text-sm font-medium text-slate-600">Filtrer par tag</label>
            <select
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-700 outline-none ring-0 focus:border-slate-400"
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
            >
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag === "all" ? "Tous les tags" : tag}
                </option>
              ))}
            </select>
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
              onClick={() => navigate("/activation")}
            >
              Activation
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
              onClick={() => navigate("/support")}
            >
              Support
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={logout}
            >
              Deconnexion
            </button>
            {me?.role === "admin" && (
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => navigate("/users")}
              >
                Gerer utilisateurs
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard title="Total Leads" value={stats.total_leads} color="text-sky-700" />
          <StatCard title="Clients" value={stats.total_clients} color="text-emerald-700" />
          <StatCard title="Conversion %" value={`${Number(stats.conversion_rate || 0).toFixed(2)}%`} color="text-violet-700" />
          <StatCard title="Leads Chauds" value={stats.hot_leads} color="text-orange-700" />
          <StatCard title="Messages Envoyes" value={stats.messages_sent} color="text-indigo-700" />
          <StatCard title="Relances en attente" value={stats.followups_pending} color="text-rose-700" />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:mt-6 sm:gap-4 xl:grid-cols-2">
          <ConversionChart />
          <TagBarChart data={stats.leads_by_tag} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
