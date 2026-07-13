import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";

const conversionData = [
  { month: "Jan", leads: 40, clients: 5 },
  { month: "Feb", leads: 60, clients: 12 },
  { month: "Mar", leads: 50, clients: 10 },
  { month: "Apr", leads: 80, clients: 20 }
];

const ConversionChart = () => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="mb-3 text-base font-semibold text-slate-800 sm:mb-4 sm:text-lg">
        Evolution Conversion
      </h3>
      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={conversionData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" stroke="#64748b" tick={{ fontSize: 12 }} />
            <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
            <Tooltip />
            <Line type="monotone" dataKey="leads" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} />
            <Line
              type="monotone"
              dataKey="clients"
              stroke="#ea580c"
              strokeWidth={3}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ConversionChart;
