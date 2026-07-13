import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const TagBarChart = ({ data = [] }) => {
  const rows = Array.isArray(data) ? data : [];
  const normalized = rows.map((item) => ({
    tag: item.tag || item.name || "Sans tag",
    total: Number(item.total) || 0
  }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="mb-3 text-base font-semibold text-slate-800 sm:mb-4 sm:text-lg">
        Leads par Offre
      </h3>
      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={normalized} margin={{ top: 8, right: 8, left: -16, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="tag"
              stroke="#64748b"
              tick={{ fontSize: 11 }}
              angle={-15}
              textAnchor="end"
              height={56}
            />
            <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="total" fill="#2563eb" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default TagBarChart;
